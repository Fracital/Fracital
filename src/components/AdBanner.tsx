import { useEffect, useRef, useState } from "react";
import { getMe } from "../libs/auth";

/**
 * Adsterra banners, run directly in the page. invoke.js reads the global window.atOptions
 * when it executes and inserts the ad next to its own <script> tag, so the tag is injected
 * into the banner's container. Every unit shares that one global, so loads are queued and
 * run one at a time. Hidden for premium accounts.
 */

declare global {
	interface Window {
		atOptions?: { key: string; format: string; height: number; width: number; params: Record<string, unknown> };
	}
}

export const AD_UNITS = {
	/** New tab page. */
	newtab: { key: "6c1a75f91a19fdf2a7d7e1a89f1c01f7", width: 300, height: 250 },
	/** Left side panel skyscraper. */
	side: { key: "fe947f7abf51a66ed8afa76cb5589d69", width: 160, height: 600 },
	/** Left side panel half skyscraper, fills leftover space under the skyscrapers. */
	sideShort: { key: "59b9a7e60886b54d281e449ab1d6e633", width: 160, height: 300 },
} as const;

type Unit = (typeof AD_UNITS)[keyof typeof AD_UNITS];

let queue: Promise<void> = Promise.resolve();

/** Loads one ad into `container`, after any earlier ad load has finished. */
function loadAd(container: HTMLElement, unit: Unit): Promise<void> {
	queue = queue.then(
		() =>
			new Promise<void>(resolve => {
				if (!container.isConnected) return resolve();
				container.replaceChildren();
				window.atOptions = { key: unit.key, format: "iframe", height: unit.height, width: unit.width, params: {} };
				const script = document.createElement("script");
				script.src = `https://www.highrevenueformat.com/${unit.key}/invoke.js`;
				const done = () => resolve();
				script.onload = done;
				script.onerror = done;
				window.setTimeout(done, 8000); // never let one slow ad block the others
				container.appendChild(script);
			}),
	);
	return queue;
}

/** Whether ads should show: false for premium accounts (re-checked on account changes). */
export function useShowAds(): boolean | undefined {
	const [show, setShow] = useState<boolean | undefined>(undefined);
	useEffect(() => {
		const check = () => void getMe().then(me => setShow(!me?.premium));
		check();
		window.addEventListener("account-upd", check);
		return () => window.removeEventListener("account-upd", check);
	}, []);
	return show;
}

interface AdBannerProps {
	unit?: Unit;
	className?: string;
	/** Reload the ad every random [min, max] minutes. */
	refreshMinutes?: [number, number];
}

export const AdBanner = ({ unit = AD_UNITS.newtab, className = "", refreshMinutes }: AdBannerProps) => {
	const ref = useRef<HTMLDivElement>(null);
	const show = useShowAds();

	useEffect(() => {
		const container = ref.current;
		if (!container || !show) return;
		let timer = 0;
		let alive = true;
		const run = () => {
			void loadAd(container, unit);
			if (refreshMinutes) {
				const [min, max] = refreshMinutes;
				const ms = (min + Math.random() * (max - min)) * 60_000;
				timer = window.setTimeout(() => alive && run(), ms);
			}
		};
		run();
		return () => {
			alive = false;
			window.clearTimeout(timer);
			container.replaceChildren();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [show, unit.key]);

	if (!show) return null;
	return <div ref={ref} className={`flex items-center justify-center shrink-0 overflow-hidden ${className}`} style={{ width: unit.width, height: unit.height }} />;
};
