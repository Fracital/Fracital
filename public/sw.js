importScripts("/vendor/ctl.sw.js");

// Buffer request bodies before handing them to the routing layer, which otherwise transfers `request.body` to the page:
// - Firefox doesn't implement Request.body, so every POST would be forwarded with an empty body.
// - In Chromium, the transferred stream of sendBeacon/keepalive requests never finishes. Those requests then hang
//   forever, fill the transport's per-host connection limit and stall every later request to the same site.
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

// A worker that has only just started knows no controller: the page's controller registers with it by message, after a
// worker of a new build took the page over (every deploy: this file differs with each build) or when the browser starts
// the worker again after stopping it idle. A request for a proxied URL that came first was let through to the server,
// which has no such path: the page got its 404, or a proxied document ran without the scripts that contain it. Such a
// request waits for its controller instead.
const ENGINE_PREFIX = "/~/sj/"; // the controller's default prefix (App.tsx passes none)
const CONTROLLER_WAIT_MS = 5000;
const controllerFor = async e => {
	const until = Date.now() + CONTROLLER_WAIT_MS;
	while (!$scramjetController.shouldRoute(e)) {
		if (Date.now() > until) return false;
		await new Promise(resolve => setTimeout(resolve, 20));
	}
	return true;
};
const route = e => withBufferedBody(e).then(event => $scramjetController.route(event));

self.addEventListener("fetch", e => {
	if ($scramjetController.shouldRoute(e)) {
		e.respondWith(route(e));
	} else if (new URL(e.request.url).pathname.startsWith(ENGINE_PREFIX)) {
		// No controller within the wait: the page that made the URL is gone, and the server answers as it did.
		e.respondWith(controllerFor(e).then(found => (found ? route(e) : fetch(e.request))));
	}
});
