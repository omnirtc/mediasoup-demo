#!/usr/bin/env node

process.title = 'mediasoup-demo-server';
process.env.DEBUG = process.env.DEBUG || 'mediasoup-demo* mediasoup:INFO* mediasoup:WARN* mediasoup:ERROR*';

const config = require('./config');

/* eslint-disable no-console */
console.log('- process.env.DEBUG:', process.env.DEBUG);
console.log('- config.mediasoup.logLevel:', config.mediasoup.logLevel);
console.log('- config.mediasoup.logTags:', config.mediasoup.logTags);
/* eslint-enable no-console */

const fs = require('fs');
const http = require('http');
const https = require('https');
const url = require('url');
const express = require('express');
const compression = require('compression');
const bodyParser = require('body-parser');
const protooServer = require('protoo-server');
const mediasoup = require('mediasoup');
//const readline = require('readline');
//const colors = require('colors/safe');
//const repl = require('repl');
const Logger = require('./lib/Logger');
const Room = require('./lib/Room');
const homer = require('./lib/homer');

const logger = new Logger();

// Map of Room instances indexed by roomId.
const rooms = new Map();

// mediasoup server.
const mediaServer = mediasoup.Server(
	{
		numWorkers: config.mediasoup.numWorkers || null,
		logLevel: config.mediasoup.logLevel,
		logTags: config.mediasoup.logTags,
		rtcIPv4: config.mediasoup.rtcIPv4,
		rtcIPv6: config.mediasoup.rtcIPv6,
		rtcAnnouncedIPv4: config.mediasoup.rtcAnnouncedIPv4,
		rtcAnnouncedIPv6: config.mediasoup.rtcAnnouncedIPv6,
		rtcMinPort: config.mediasoup.rtcMinPort,
		rtcMaxPort: config.mediasoup.rtcMaxPort
	});

// Do Homer stuff.
if (process.env.MEDIASOUP_HOMER_OUTPUT)
	homer(mediaServer);

global.SERVER = mediaServer;

mediaServer.on('close', () => {
	logger.error('mediaServer "close" event, closing server in 2 seconds...');

	setTimeout(() => {
		process.exit(1);
	}, 2000);
});

mediaServer.on('newroom', (room) => {
	global.ROOM = room;

	room.on('newpeer', (peer) => {
		global.PEER = peer;

		if (peer.consumers.length > 0)
			global.CONSUMER = peer.consumers[peer.consumers.length - 1];

		peer.on('newtransport', (transport) => {
			global.TRANSPORT = transport;
		});

		peer.on('newproducer', (producer) => {
			global.PRODUCER = producer;
		});

		peer.on('newconsumer', (consumer) => {
			global.CONSUMER = consumer;
		});
	});
});


const standalone = '' === config.webroot || '/' === config.webroot;

function run() {

	const expressApp = express();

	// pre process all request
	expressApp.all('*', async (req, res, next) => {
		// if request is https or request from reverse proxy (nginx ...)
		logger.debug("ssssssssssssssssssssssssssss, ", req.url)
		if (standalone)
		{
			if (! req.secure || req.headers['x-forwarded-for']) // http or reverse proxy
			{
				const url = req.headers['x-forwarded-for'] ? '' : req.url;
				const redirectUrl = `https://${req.hostname}:${config.signalingPort}${url}`;
				logger.debug('standalone reqeust redirect .... url:%s', redirectUrl);
				res.redirect(`${redirectUrl}`);
			}
			else
			{
				logger.debug('standalne https reqeust go next .... path:%s, url:%s', req.path, req.url);
				return next();
			}
		}
		else
		{
			if (req.headers['x-forwarded-for'])
			{
				logger.debug('proxy http reqeust go next .... url:%s', req.url);
				return next();
			}
			else
			{
				const redirectUrl = `http://${req.hostname}${config.webroot}${req.url}`;
				logger.debug('proxy reqeust redirect .... url:%s', redirectUrl);
				res.redirect(`${redirectUrl}`);
			}
		}
	});

	const router = express.Router();

	expressApp.use(compression());

	expressApp.use(bodyParser.json());

	expressApp.use(config.webroot, router);

	// Serve all files in the public folder as static files.
	router.use(express.static(`${__dirname}/public`));
	router.use((req, res) => res.sendFile(`${__dirname}/public/index.html`));

	/**
	* For every API request, verify that the roomId in the path matches and
	* existing room.
	*/
	router.param('roomId', (req, res, next, roomId) => {
		// The room must exist for all API requests.
		if (!rooms.has(roomId)) {
			const error = new Error(`room with id "${roomId}" not found`);

			error.status = 404;
			throw error;
		}

		req.room = rooms.get(roomId);

		next();
	});

	let listeningIp = standalone ? '0.0.0.0' : '127.0.0.1';
	let httpsServer = undefined;
	let httpServer = undefined;

	if (standalone)
	{
		// HTTPS server for the protoo WebSocket server.
		const tls =
		{
			cert: fs.readFileSync(config.https.tls.cert),
			key: fs.readFileSync(config.https.tls.key)
		};

		httpsServer = https.createServer(tls, expressApp);

		httpsServer.listen(config.signalingPort, listeningIp, () => {
			logger.info(`running an HTTPS server on ${listeningIp}:${config.signalingPort} ...`);
		});
	}

	httpServer = http.createServer(expressApp);

	httpServer.listen(config.listeningPort, '0.0.0.0', () => {
		logger.info(`running an HTTP server on 0.0.0.0:${config.listeningPort} ...`);
	})

	// Protoo WebSocket server.
	const webSocketServer = new protooServer.WebSocketServer(standalone ? httpsServer : httpServer,
	{
		maxReceivedFrameSize: 960000, // 960 KBytes.
		maxReceivedMessageSize: 960000,
		fragmentOutgoingMessages: true,
		fragmentationThreshold: 960000
	});

	// Handle connections from clients.
	webSocketServer.on('connectionrequest', (info, accept, reject) => {
		// The client indicates the roomId and peerId in the URL query.
		const u = url.parse(info.request.url, true);
		const roomId = u.query['roomId'];
		const peerName = u.query['peerName'];
		const forceH264 = u.query['forceH264'] === 'true';

		if (!roomId || !peerName) {
			logger.warn('connection request without roomId and/or peerName');

			reject(400, 'Connection request without roomId and/or peerName');

			return;
		}

		logger.info(
			'connection request [roomId:%s, peerName:%s, address:%s, origin:%s]',
			roomId, peerName, info.socket.remoteAddress, info.origin);

		let room;

		// If an unknown roomId, create a new Room.
		if (!rooms.has(roomId)) {
			logger.info('creating a new Room [roomId:%s]', roomId);

			try {
				room = new Room(roomId, mediaServer, { forceH264 });

				global.APP_ROOM = room;
			}
			catch (error) {
				logger.error('error creating a new Room: %o', error);

				reject(error);

				return;
			}

			const logStatusTimer = setInterval(() => {
				room.logStatus();
			}, 30000);

			rooms.set(roomId, room);

			room.on('close', () => {
				rooms.delete(roomId);
				clearInterval(logStatusTimer);
			});
		}
		else {
			room = rooms.get(roomId);
		}

		const transport = accept();

		room.handleConnection(peerName, transport);
	});
}

run();

/*
// Listen for keyboard input.

let cmd;
let terminal;

 openCommandConsole();

function openCommandConsole() {
	stdinLog('[opening Readline Command Console...]');

	closeCommandConsole();
	closeTerminal();

	cmd = readline.createInterface(
		{
			input: process.stdin,
			output: process.stdout
		});

	cmd.on('SIGINT', () => {
		process.exit();
	});

	readStdin();

	function readStdin() {
		cmd.question('cmd> ', (answer) => {
			switch (answer) {
				case '':
					{
						readStdin();
						break;
					}

				case 'h':
				case 'help':
					{
						stdinLog('');
						stdinLog('available commands:');
						stdinLog('- h,  help          : show this message');
						stdinLog('- sd, serverdump    : execute server.dump()');
						stdinLog('- rd, roomdump      : execute room.dump() for the latest created mediasoup Room');
						stdinLog('- pd, peerdump      : execute peer.dump() for the latest created mediasoup Peer');
						stdinLog('- td, transportdump : execute transport.dump() for the latest created mediasoup Transport');
						stdinLog('- prd, producerdump : execute producer.dump() for the latest created mediasoup Producer');
						stdinLog('- cd, consumerdump : execute consumer.dump() for the latest created mediasoup Consumer');
						stdinLog('- t,  terminal      : open REPL Terminal');
						stdinLog('');
						readStdin();

						break;
					}

				case 'sd':
				case 'serverdump':
					{
						mediaServer.dump()
							.then((data) => {
								stdinLog(`server.dump() succeeded:\n${JSON.stringify(data, null, '  ')}`);
								readStdin();
							})
							.catch((error) => {
								stdinError(`mediaServer.dump() failed: ${error}`);
								readStdin();
							});

						break;
					}

				case 'rd':
				case 'roomdump':
					{
						if (!global.ROOM) {
							readStdin();
							break;
						}

						global.ROOM.dump()
							.then((data) => {
								stdinLog(`room.dump() succeeded:\n${JSON.stringify(data, null, '  ')}`);
								readStdin();
							})
							.catch((error) => {
								stdinError(`room.dump() failed: ${error}`);
								readStdin();
							});

						break;
					}

				case 'pd':
				case 'peerdump':
					{
						if (!global.PEER) {
							readStdin();
							break;
						}

						global.PEER.dump()
							.then((data) => {
								stdinLog(`peer.dump() succeeded:\n${JSON.stringify(data, null, '  ')}`);
								readStdin();
							})
							.catch((error) => {
								stdinError(`peer.dump() failed: ${error}`);
								readStdin();
							});

						break;
					}

				case 'td':
				case 'transportdump':
					{
						if (!global.TRANSPORT) {
							readStdin();
							break;
						}

						global.TRANSPORT.dump()
							.then((data) => {
								stdinLog(`transport.dump() succeeded:\n${JSON.stringify(data, null, '  ')}`);
								readStdin();
							})
							.catch((error) => {
								stdinError(`transport.dump() failed: ${error}`);
								readStdin();
							});

						break;
					}

				case 'prd':
				case 'producerdump':
					{
						if (!global.PRODUCER) {
							readStdin();
							break;
						}

						global.PRODUCER.dump()
							.then((data) => {
								stdinLog(`producer.dump() succeeded:\n${JSON.stringify(data, null, '  ')}`);
								readStdin();
							})
							.catch((error) => {
								stdinError(`producer.dump() failed: ${error}`);
								readStdin();
							});

						break;
					}

				case 'cd':
				case 'consumerdump':
					{
						if (!global.CONSUMER) {
							readStdin();
							break;
						}

						global.CONSUMER.dump()
							.then((data) => {
								stdinLog(`consumer.dump() succeeded:\n${JSON.stringify(data, null, '  ')}`);
								readStdin();
							})
							.catch((error) => {
								stdinError(`consumer.dump() failed: ${error}`);
								readStdin();
							});

						break;
					}

				case 't':
				case 'terminal':
					{
						openTerminal();

						break;
					}

				default:
					{
						stdinError(`unknown command: ${answer}`);
						stdinLog('press \'h\' or \'help\' to get the list of available commands');

						readStdin();
					}
			}
		});
	}
}

function openTerminal() {
	stdinLog('[opening REPL Terminal...]');

	closeCommandConsole();
	closeTerminal();

	terminal = repl.start(
		{
			prompt: 'terminal> ',
			useColors: true,
			useGlobal: true,
			ignoreUndefined: false
		});

	terminal.on('exit', () => openCommandConsole());
}

function closeCommandConsole() {
	if (cmd) {
		cmd.close();
		cmd = undefined;
	}
}

function closeTerminal() {
	if (terminal) {
		terminal.removeAllListeners('exit');
		terminal.close();
		terminal = undefined;
	}
}

function stdinLog(msg) {
	// eslint-disable-next-line no-console
	console.log(colors.green(msg));
}

function stdinError(msg) {
	// eslint-disable-next-line no-console
	console.error(colors.red.bold('ERROR: ') + colors.red(msg));
}
*/