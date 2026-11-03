const toBlob = async (body: BodyInit, contentType: string | undefined) => new Response(body, { headers: contentType ? { "content-type": contentType } : {} }).blob();

let transportInit: Promise<void> | undefined;

// Remote resources (favicons, lyrics APIs) usually lack CORS headers, so fetch them through the proxy transport instead of directly.
export const fetchRemote = async (src: string): Promise<Blob> => {
	const url = new URL(src);
	if (url.origin !== window.location.origin) {
		try {
			await window.scramjetReady;
			const transport = window.scramjetController?.transport;
			if (transport) {
				// The transport is only initialized lazily once a proxied page uses it.
				if (!transport.ready) {
					transportInit ??= Promise.resolve(transport.init()).catch(error => {
						transportInit = undefined;
						throw error;
					});
					await transportInit;
				}
				const resp = await transport.request(url, "GET", null, [], undefined);
				if (resp.status >= 400) throw new Error(`Request failed with ${resp.status}`);
				const contentType = resp.headers.find(([name]) => name.toLowerCase() === "content-type")?.[1];
				return await toBlob(resp.body as BodyInit, contentType);
			}
		} catch (error) {
			console.warn("Proxy fetch failed, falling back to direct fetch:", src, error);
		}
	}
	const response = await fetch(src);
	if (!response.ok) throw new Error(`Request failed with ${response.status}`);
	return response.blob();
};

export const fetchJson = async <T>(url: string): Promise<T> => JSON.parse(await (await fetchRemote(url)).text()) as T;

export const handleImg = (src: string | React.ReactNode | null | undefined, callback: (result: string | undefined) => void): void => {
	if (typeof src !== "string") {
		callback(undefined);
		return;
	}
	if (src.startsWith("http://") || src.startsWith("https://")) {
		fetchRemote(src)
			.then(blob => callback(URL.createObjectURL(blob)))
			.catch(() => callback(undefined));
		return;
	}
	callback(src);
};
