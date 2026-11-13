import { type Frame, ManagedPlugin } from "@mercuryworkshop/scramjet-controller";
import { applyPageStyles, requestVerdict, runPageScripts, verdictResponse } from "./runtime";

/**
 * Runs extensions in a proxied frame on the default engine. Every request the frame's pages make passes the
 * `intercept` hook first (with the real URL, the page that made it and what it's for), so a blocked one never goes
 * out. Every page (nested frames included) runs the extensions' scripts and gets their CSS as it starts, before
 * its own scripts run or it draws anything.
 */
export class ExtensionsPlugin extends ManagedPlugin {
	constructor() {
		super("fx", []);
	}

	install(frame: Frame) {
		super.install(frame);
		this.tap(frame.hooks.fetch.intercept, (context: { parsed: { url: URL; clientUrl?: URL; destination: string } }, props: { response?: unknown }) => {
			const { url, clientUrl, destination } = context.parsed;
			const verdict = requestVerdict({ url: url.href, pageUrl: clientUrl?.href, destination });
			if (!verdict) return;
			const { headers, ...response } = verdictResponse(verdict);
			// The controller reads the headers back with toRawHeaders().
			props.response = { ...response, headers: { toRawHeaders: () => headers } };
		});
		this.tap(frame.hooks.init.post, (context: { window: Window; client: { url: URL } }) => {
			const doc = context.window.document;
			const pageUrl = String(context.client.url);
			// The extensions' scripts run first, before any of the page's own. At its very start a page may not have an
			// <html> yet: then both go in as soon as it does.
			runPageScripts(doc, pageUrl);
			if (!applyPageStyles(doc, pageUrl))
				doc.addEventListener(
					"readystatechange",
					() => {
						runPageScripts(doc, pageUrl);
						applyPageStyles(doc, pageUrl);
					},
					{ once: true },
				);
		});
	}
}
