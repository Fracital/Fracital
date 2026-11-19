import { type Frame, ManagedPlugin } from "@mercuryworkshop/scramjet-controller";

/**
 * Keeps a page's address when it calls history.pushState or replaceState without a URL (or with null), as the
 * spec says: the engine (2.0.67-alpha.2) turns the missing argument into the text "undefined" and rewrites it as a
 * relative path, so DuckDuckGo, Brave Search and other apps that store state this way ended up at
 * "https://site/undefined". Installed on every document the frame loads, before the page's own scripts run.
 */
export class HistoryUrlPlugin extends ManagedPlugin {
	constructor() {
		super("hu", []);
	}

	install(frame: Frame) {
		super.install(frame);
		this.tap(frame.hooks.init.post, (context: { window: Window; client: { url: URL } }) => {
			// The frame's own History.prototype (not this window's).
			const proto = Object.getPrototypeOf(context.window.history) as History;
			for (const name of ["pushState", "replaceState"] as const) {
				// The engine's own wrapper, which rewrites the URL for the proxy; it runs after this one.
				const wrapped = proto[name];
				if (typeof wrapped !== "function") continue;
				Object.defineProperty(proto, name, {
					configurable: true,
					writable: true,
					value: function (this: History, state: unknown, title: string, url?: string | URL | null) {
						return wrapped.call(this, state, title, url === undefined || url === null ? context.client.url.href : url);
					},
				});
			}
		});
	}
}
