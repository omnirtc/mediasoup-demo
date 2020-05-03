export function getProtooUrl({ roomId, peerId, forceH264, forceVP9 })
{
	const host = window.location.host;
	const path = window.location.pathname;
	let url = `wss://${host}${path}?roomId=${roomId}&peerId=${peerId}`;

	if (forceH264)
		url = `${url}&forceH264=true`;
	else if (forceVP9)
		url = `${url}&forceVP9=true`;

	return url;
}
