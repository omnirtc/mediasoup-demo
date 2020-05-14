export function getProtooUrl({ roomId, peerId })
{
	const host = window.location.host;
	const path = window.location.pathname;

	return `wss://${host}${path}?roomId=${roomId}&peerId=${peerId}`;
}
