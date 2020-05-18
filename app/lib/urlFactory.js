export function getProtooUrl(peerName, roomId, forceH264)
{
	const host = window.location.host;
	const path = window.location.pathname;
	let url = `wss://${host}${path}?roomId=${roomId}&peerName=${peerName}`;

	if (forceH264)
		url = `${url}&forceH264=true`;

	return url;
}
