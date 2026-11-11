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
	/** The box at the bottom of the tab list (TabsAd). */
	box: { key: "6c1a75f91a19fdf2a7d7e1a89f1c01f7", width: 300, height: 250 },
	/** Left side panel skyscraper. */
	side: { key: "fe947f7abf51a66ed8afa76cb5589d69", width: 160, height: 600 },
	/** Left side panel half skyscraper, fills leftover space under the skyscrapers. */
	sideShort: { key: "59b9a7e60886b54d281e449ab1d6e633", width: 160, height: 300 },
} as const;

type Unit = (typeof AD_UNITS)[keyof typeof AD_UNITS];

/** How long after the page loads Adsterra may start, so its scripts never compete with the app's boot. */
const START_DELAY_MS = 3000;

// The first ad waits for the page to load, the delay, the app to finish booting, and an idle moment.
let queue: Promise<void> = new Promise<void>(resolve => {
	const start = () =>
		window.setTimeout(async () => {
			await window.appReady?.catch(() => undefined);
			if (window.requestIdleCallback) window.requestIdleCallback(() => resolve(), { timeout: 3000 });
			else resolve();
		}, START_DELAY_MS);
	if (document.readyState === "complete") start();
	else window.addEventListener("load", start, { once: true });
});

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

// Last known premium state in this browser, so ads start loading with the app instead of after the
// account request (which waits for the app to boot); premium accounts are hidden from the first frame.
const PREMIUM_KEY = "fr:premium";
export const isKnownPremium = () => {
	try {
		return localStorage.getItem(PREMIUM_KEY) === "1";
	} catch {
		return false;
	}
};

/** Whether ads should show: false for premium accounts (re-checked on account changes). */
export function useShowAds(): boolean | undefined {
	const [show, setShow] = useState<boolean | undefined>(() => !isKnownPremium());
	useEffect(() => {
		const check = () =>
			void getMe().then(me => {
				try {
					if (me?.premium) localStorage.setItem(PREMIUM_KEY, "1");
					else localStorage.removeItem(PREMIUM_KEY);
				} catch {
					// Storage blocked: the account check still decides.
				}
				setShow(!me?.premium);
			});
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

export const AdBanner = ({ unit = AD_UNITS.box, className = "", refreshMinutes }: AdBannerProps) => {
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

/** How long a RevIQ slot may stay empty before its Adsterra stand-in takes its place. */
const REV_FILL_MS = 8000;

/**
 * A RevIQ slot: its tag fills each `data-ad` div by name. With a `fallback`, an Adsterra unit takes the
 * slot's place when RevIQ has nothing for it: GPT reports the slot empty, or nothing has rendered by
 * REV_FILL_MS, or (with `maxWidth`) what it sent is wider than the space. The RevIQ div goes away then,
 * so a late fill can't show both. Hidden for premium accounts.
 */
export const RevSlot = ({ name, className = "", fallback, maxWidth }: { name: string; className?: string; fallback?: Unit; maxWidth?: number }) => {
	const show = useShowAds();
	const ref = useRef<HTMLDivElement>(null);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		const el = ref.current;
		if (!el || !show || !fallback || failed) return;
		const frames = () => [...el.querySelectorAll("iframe")].filter(frame => frame.offsetWidth > 0 && frame.offsetHeight > 0);
		const tooWide = () => !!maxWidth && frames().some(frame => frame.offsetWidth > maxWidth);
		const gt = window.googletag;
		// The GPT slot behind this div, so a replaced one is destroyed instead of refreshing unseen.
		let gptSlot: Parameters<NonNullable<typeof gt>["destroySlots"]>[0][number] | null = null;
		const fail = () => {
			gt?.cmd.push(() => {
				const slots = gptSlot
					? [gptSlot]
					: gt
							.pubads()
							.getSlots()
							.filter(slot => {
								const target = document.getElementById(slot.getSlotElementId());
								return !!target && (target === el || el.contains(target));
							});
				if (slots.length) gt.destroySlots(slots);
			});
			setFailed(true);
		};
		const onRender = (e: { slot: Parameters<NonNullable<typeof gt>["destroySlots"]>[0][number] & { getSlotElementId: () => string }; isEmpty?: boolean; size?: number[] | string | null }) => {
			const target = document.getElementById(e.slot.getSlotElementId());
			if (!target || (target !== el && !el.contains(target))) return;
			gptSlot = e.slot;
			const width = Array.isArray(e.size) ? e.size[0] : 0;
			if (e.isEmpty || (maxWidth && width > maxWidth)) fail();
		};
		gt?.cmd.push(() => gt.pubads().addEventListener("slotRenderEnded", onRender));
		const timer = window.setTimeout(() => {
			if (!frames().length || tooWide()) fail();
		}, REV_FILL_MS);
		// An ad too wide for the space, as soon as it lands.
		const watch = new MutationObserver(() => {
			if (tooWide()) fail();
		});
		watch.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ["width", "style"] });
		return () => {
			window.clearTimeout(timer);
			watch.disconnect();
			gt?.cmd.push(() => gt.pubads().removeEventListener("slotRenderEnded", onRender));
		};
	}, [show, fallback, failed, maxWidth]);

	if (!show) return null;
	// Keyed apart from the RevIQ div so React drops that one whole, with what RevIQ put inside it.
	if (failed && fallback)
		return (
			<div key="fallback" className={`flex justify-center ${className}`}>
				<AdBanner unit={fallback} refreshMinutes={[5, 10]} className="rounded-lg" />
			</div>
		);
	return <div key="rev" ref={ref} data-ad={name} className={className} />;
};

/**
 * One box ad at the bottom of the tab list, shown only while the tabs leave room for it: as tabs fill the
 * list it goes away, so it never pushes a tab out of view. Scaled down to the list's width.
 */
/** Kept small: at most 240×200 of the 300×250 unit. */
const MAX_TABS_AD_SCALE = 0.8;

export const TabsAd = ({ enabled }: { enabled: boolean }) => {
	const unit = AD_UNITS.box;
	const ref = useRef<HTMLDivElement>(null);
	const show = useShowAds();
	const [scale, setScale] = useState<number | null>(null);

	useEffect(() => {
		const el = ref.current;
		const list = el?.parentElement;
		if (!el || !list || !enabled || !show) {
			setScale(null);
			return;
		}
		const measure = () => {
			const fit = Math.min(MAX_TABS_AD_SCALE, (list.clientWidth - 16) / unit.width);
			// Where the tabs end; the list is the offset parent, so scrolling doesn't move this.
			let tabsEnd = 0;
			for (const child of list.children) {
				if (child !== el) tabsEnd = Math.max(tabsEnd, (child as HTMLElement).offsetTop + (child as HTMLElement).offsetHeight);
			}
			const room = list.clientHeight - tabsEnd - 16;
			setScale(fit >= 0.65 && room >= unit.height * fit ? fit : null);
		};
		measure();
		const resize = new ResizeObserver(measure);
		resize.observe(list);
		// Tabs and groups opening, closing and collapsing.
		const mutation = new MutationObserver(measure);
		mutation.observe(list, { childList: true, subtree: true });
		return () => {
			resize.disconnect();
			mutation.disconnect();
		};
	}, [enabled, show, unit]);

	return (
		<div ref={ref} className={scale ? "flex justify-center shrink-0 mt-auto" : "hidden"}>
			{scale && (
				<div className="overflow-hidden rounded-lg" style={{ width: unit.width * scale, height: unit.height * scale }}>
					<div style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}>
						<AdBanner unit={unit} refreshMinutes={[5, 10]} />
					</div>
				</div>
			)}
		</div>
	);
};
