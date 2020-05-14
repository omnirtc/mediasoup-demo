export function getProtooUrl({ roomId, peerId })
{
	const host = window.location.host;
	const path = window.location.pathname;
	let url = `wss://${host}${path}?roomId=${roomId}&peerId=${peerId}`;
	return `wss://${hostname}:${protooPort}/?roomId=${roomId}&peerId=${peerId}`;
}
