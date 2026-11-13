import type { ComponentType } from "react";

/*
 * Fracital's extensions: built-in features that run inside proxied pages (never in the app itself), switched on and
 * set up from about:extensions. Each one is an `Extension`; the engines reach them only through `runtime.ts`.
 */

/** A request a proxied page makes, as an extension sees it: real (unproxied) URLs. */
export interface ExtensionRequest {
	url: string;
	/** The page that made it, when the engine knows. */
	pageUrl?: string;
	/** What it's for, in the browser's terms (fetch's `Request.destination`: "script", "image", "iframe"…; "" for fetch/XHR). */
	destination?: string;
}

/**
 * What an extension decides about a request: block it (the page sees it fail, as with any ad blocker), or answer it
 * with a harmless stand-in (an empty script, `{}`, a blank video…) for pages that break when it simply fails.
 * `body` is base64 when `contentType` ends in ";base64".
 */
export type RequestVerdict = { action: "block" } | { action: "redirect"; body: string; contentType: string };

/** Class names, ids and link URLs newly seen on a page. */
export interface PageFeatures {
	classes: string[];
	ids: string[];
	hrefs: string[];
}

/** An extension's saved settings: on/off, the sites it's paused on, and its own options. */
export interface ExtensionSettings {
	enabled: boolean;
	/** Hostnames where it's paused (with their subdomains). */
	allow: string[];
}

/** How an extension is doing, for its card. */
export type ExtensionStatus = { state: "off" } | { state: "loading" } | { state: "ready"; detail?: string } | { state: "error"; detail: string };

export interface Extension<S extends ExtensionSettings = ExtensionSettings> {
	id: string;
	name: string;
	description: string;
	icon: ComponentType<{ className?: string }>;
	defaults: S;
	/** Gets ready to run (loads what it needs) when it's switched on, and again whenever its settings change. */
	start?(settings: S, report: (status: ExtensionStatus) => void): Promise<void> | void;
	/** It was switched off: drop whatever it holds. */
	stop?(): void;
	/** What to do with a request a proxied page makes; null lets it through. */
	filterRequest?(request: ExtensionRequest, settings: S): RequestVerdict | null;
	/** CSS to add to a proxied page (at its start where the engine allows, else once it loads). */
	pageStyles?(pageUrl: string, settings: S): string;
	/** Scripts to run in a proxied page before its own (fixes like removing a video player's ads). */
	pageScripts?(pageUrl: string, settings: S): string[];
	/** More CSS for what's on the page: called with class names, ids and links as they appear (each only once). */
	domStyles?(pageUrl: string, found: PageFeatures, settings: S): string;
}
