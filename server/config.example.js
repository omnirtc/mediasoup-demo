module.exports =
{
	// Listening hostname for `gulp live|open`.
	domain: 'localhost',

	listeningPort : process.env.PROTOO_LISTENING_PORT || 5080,

	signalingPort  : process.env.PROTOO_SIGNALING_PORT || 5443,

	// web root
	// '', '/' = standalone
	webroot : '/',

	// Signaling settings (protoo WebSocket server and HTTP API server).
	https  :
	{
		// NOTE: Set your own valid certificate files.
		tls        :
		{
			cert : process.env.HTTPS_CERT_FULLCHAIN || `${__dirname}/certs/fullchain.pem`,
			key  : process.env.HTTPS_CERT_PRIVKEY || `${__dirname}/certs/privkey.pem`
		}
	},

	mediasoup:
	{
		// mediasoup Server settings.
		// log level valid values are 'debug', 'warn', 'error'
		logLevel: 'warn',
		logTags:
			[
				'info',
				'ice',
				'dtls',
				'rtp',
				'srtp',
				'rtcp',
				// 'rbe',
				// 'rtx'
			],
		numWorkers: null, // Use number of CPUs.
		rtcIPv4: true,
		rtcIPv6: true,
		rtcAnnouncedIPv4: null,
		rtcAnnouncedIPv6: null,
		rtcMinPort: 40000,
		rtcMaxPort: 49999,
		// mediasoup Room codecs.
		mediaCodecs:
			[
				{
					kind: 'audio',
					name: 'opus',
					mimeType: 'audio/opus',
					clockRate: 48000,
					channels: 2,
					parameters:
					{
						useinbandfec: 1
					}
				},
				{
					kind: 'video',
					name: 'VP8',
					mimeType: 'video/VP8',
					clockRate: 90000,
					parameters:
					{
						'x-google-start-bitrate': 1500
					}
				},
				{
					kind: 'video',
					name: 'h264',
					mimeType: 'video/h264',
					clockRate: 90000,
					parameters:
					{
						'packetization-mode': 1,
						'profile-level-id': '42e01f',
						'level-asymmetry-allowed': 1
					}
				}
			],
		// mediasoup per Peer max sending bitrate (in bps).
		maxBitrate: 500000
	}
};
