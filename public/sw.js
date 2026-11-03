importScripts("/controller/controller.sw.js");

// Buffer request bodies before handing them to the controller, which otherwise transfers `request.body` to the page:
// - Firefox doesn't implement Request.body, so every POST would be forwarded with an empty body.
// - In Chromium, the transferred stream of sendBeacon/keepalive requests (e.g. Google's gen_204 pings) never finishes.
//   Those requests then hang forever, fill libcurl's per-host connection limit and stall every later request to the
//   same site, which is why clicking Google results stopped navigating.
const withBufferedBody = async e => {
	const request = e.request;
	if (request.method === "GET" || request.method === "HEAD") return e;
	const buffer = await request.arrayBuffer();
	const body = buffer.byteLength ? buffer : null;
	return {
		clientId: e.clientId,
		resultingClientId: e.resultingClientId,
		request: new Proxy(request, {
			get(target, prop) {
				if (prop === "body") return body;
				const value = Reflect.get(target, prop, target);
				return typeof value === "function" ? value.bind(target) : value;
			},
		}),
	};
};

self.addEventListener("fetch", e => {
	if ($scramjetController.shouldRoute(e)) {
		e.respondWith(withBufferedBody(e).then(event => $scramjetController.route(event)));
	}
});
