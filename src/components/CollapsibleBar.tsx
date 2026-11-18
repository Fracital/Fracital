import { ChevronDownIcon } from "@heroicons/react/24/solid";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useHolyAttr } from "../libs/holy-attr";
import { portalTarget } from "../libs/cloak";
import { HolyText } from "./common/HolyText";

/**
 * Bars the user can collapse (the site's top bar, the game player's bar). In "hover" mode a bar is either kept
 * open (pinned) or auto-hides and slides back when the pointer comes within the user's chosen distance of its
 * edge. In "button" mode it only opens and closes by button. Each bar remembers its own choices.
 */
export type BarMode = "hover" | "button";

export const THRESHOLD_MIN = 4;
export const THRESHOLD_MAX = 120;
const THRESHOLD_DEFAULT = 24;

const read = (key: string) => {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
};
const write = (key: string, value: string) => {
	try {
		localStorage.setItem(key, value);
	} catch {
		// Private mode: the choice just isn't remembered.
	}
};
const usePersisted = <T,>(key: string, parse: (raw: string | null) => T, serialize: (value: T) => string) => {
	const [value, setValue] = useState<T>(() => parse(read(key)));
	const set = (next: T) => {
		setValue(next);
		write(key, serialize(next));
	};
	return [value, set] as const;
};

export interface CollapsibleBar {
	mode: BarMode;
	setMode: (mode: BarMode) => void;
	threshold: number;
	setThreshold: (px: number) => void;
	/** Hover mode: kept open. */
	pinned: boolean;
	setPinned: (pinned: boolean) => void;
	/** Button mode: open. */
	open: boolean;
	setOpen: (open: boolean) => void;
	/** Hover mode, not pinned: the pointer brought the bar back for now. */
	revealed: boolean;
	setRevealed: (revealed: boolean) => void;
	/** Keeps the bar shown until the returned release is called: a menu, dropdown or panel of the bar is open. */
	hold: () => () => void;
	/** Something holds the bar (see hold). */
	held: boolean;
	/** Hover mode, not pinned. */
	autoHide: boolean;
	/** An auto-hidden bar is showing (revealed by the pointer, or held). */
	shown: boolean;
	/** The bar takes its own space (otherwise it's hidden, or slides over the content when revealed). */
	inFlow: boolean;
}

/** `key` names the bar in storage, e.g. "gamesBar" or "shellBar". */
export const useCollapsibleBar = (key: string): CollapsibleBar => {
	const [mode, setMode] = usePersisted<BarMode>(
		`${key}Mode`,
		raw => (raw === "button" ? "button" : "hover"),
		v => v,
	);
	const [threshold, setThreshold] = usePersisted<number>(
		`${key}Threshold`,
		raw => {
			const n = Number(raw);
			return raw && Number.isFinite(n) ? Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, n)) : THRESHOLD_DEFAULT;
		},
		String,
	);
	const [pinned, setPinned] = usePersisted<boolean>(
		`${key}Pinned`,
		raw => raw !== "0",
		v => (v ? "1" : "0"),
	);
	const [open, setOpen] = usePersisted<boolean>(
		`${key}Open`,
		raw => raw !== "0",
		v => (v ? "1" : "0"),
	);
	const [revealed, setRevealed] = useState(false);
	// Counted, so two things holding the bar at once (a menu inside an open dropdown) don't release each other.
	const [holds, setHolds] = useState(0);
	const hold = useCallback(() => {
		setHolds(n => n + 1);
		let released = false;
		return () => {
			if (released) return;
			released = true;
			setHolds(n => n - 1);
		};
	}, []);
	const held = holds > 0;
	const autoHide = mode === "hover" && !pinned;
	return { mode, setMode, threshold, setThreshold, pinned, setPinned, open, setOpen, revealed, setRevealed, hold, held, autoHide, shown: autoHide && (revealed || held), inFlow: mode === "hover" ? pinned : open };
};

/** The bar a component sits in, so the menus and dropdowns it opens (often outside the bar's box) can hold it open. */
export const BarHoldContext = createContext<CollapsibleBar["hold"] | null>(null);

/**
 * Keeps the bar this component is inside showing while `active` (the menu or dropdown it opened is open). Outside a
 * bar it does nothing. React context reaches through portals, so a menu drawn elsewhere still finds its bar.
 */
export const useHoldBar = (active: boolean) => {
	const hold = useContext(BarHoldContext);
	useEffect(() => (active && hold ? hold() : undefined), [active, hold]);
};

interface HoverRevealOptions {
	enabled: boolean;
	threshold: number;
	/** Where pointer moves are heard: the bar's area, or the whole document. */
	target: () => HTMLElement | Document | null;
	/** Same-origin iframes under here also report pointer moves (their events never reach this document). */
	frames: () => ParentNode | null;
	/** Viewport y of the edge the bar hides behind. */
	edge: () => number;
	/** The revealed bar. The pointer leaving it, or moving below it, hides the bar after HIDE_DELAY_MS. */
	bar: () => HTMLElement | null;
	/** Keeps the bar up for now, wherever the pointer is (typing in it). */
	hold?: () => boolean;
	/** The pointer brought the bar out; while it's out, where the pointer is gets checked every HOVER_CHECK_MS. */
	revealed: boolean;
	/** One of the bar's menus or dropdowns is open (CollapsibleBar.held): it stays out, wherever the pointer goes. */
	held: boolean;
	setRevealed: (revealed: boolean) => void;
}

/** How long a revealed bar stays after the pointer leaves it, so brushing past its edge doesn't drop it. */
const HIDE_DELAY_MS = 800;
/** How often a revealed bar checks that the pointer is still on it, for the moves no event tells us about. */
const HOVER_CHECK_MS = 100;

/** A touchscreen (no pointer that hovers): an auto-hidden bar can't come back by hovering, so it offers a handle to tap. */
export const useNoHover = () => {
	const query = "(hover: none)";
	const [noHover, setNoHover] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
	useEffect(() => {
		const media = window.matchMedia(query);
		const onChange = () => setNoHover(media.matches);
		media.addEventListener("change", onChange);
		return () => media.removeEventListener("change", onChange);
	}, []);
	return noHover;
};

/**
 * Reveals an auto-hidden bar while the pointer is within `threshold` px of its edge, or over the bar, and hides it
 * HIDE_DELAY_MS after the pointer leaves the bar. Leaving is heard on the bar itself, so it counts even when the
 * pointer goes into a frame that never reports where it is (cross-origin, or a page busy loading). A tap (which moves
 * no pointer first) counts the same: on the edge it reveals the bar, below the bar it hides it again.
 */
export const useHoverReveal = ({ enabled, threshold, target, frames, edge, bar, hold, revealed, held, setRevealed }: HoverRevealOptions) => {
	const opts = useRef({ target, frames, edge, bar, hold, held, setRevealed });
	useEffect(() => {
		opts.current = { target, frames, edge, bar, hold, held, setRevealed };
	});
	/** Set by the listening effect below: looks where the pointer is now and keeps or lets go of the bar. */
	const check = useRef<(() => void) | null>(null);

	// Events alone can miss the pointer going away (into a cross-origin or busy frame, a fast flick, a page that
	// swallows its events), so while the bar is out it keeps looking until it has gone.
	useEffect(() => {
		if (!enabled || !revealed) return;
		const timer = window.setInterval(() => check.current?.(), HOVER_CHECK_MS);
		return () => window.clearInterval(timer);
	}, [enabled, revealed]);

	useEffect(() => {
		const el = opts.current.target();
		if (!enabled || !el) return;
		// The last place an event put the pointer, and whether it has since left the window. A finger (no hover) is
		// left to taps.
		let lastY = Number.NaN;
		let outside = false;
		let touch = false;
		const inZone = (y: number) => {
			const offset = y - opts.current.edge();
			return offset >= 0 && offset <= threshold;
		};
		let hideTimer = 0;
		const stay = () => {
			window.clearTimeout(hideTimer);
			hideTimer = 0;
		};
		const hideSoon = () => {
			if (hideTimer) return;
			hideTimer = window.setTimeout(() => {
				hideTimer = 0;
				// Still typing in it, or one of its menus is open: look again later rather than on the next move, which a
				// frame may never report. Not letting go meanwhile means closing a menu with the pointer on the bar keeps it.
				if (opts.current.held || opts.current.hold?.()) hideSoon();
				else opts.current.setRevealed(false);
			}, HIDE_DELAY_MS);
		};
		const at = (e: PointerEvent, y: number) => {
			const { edge, bar, setRevealed } = opts.current;
			lastY = y;
			outside = false;
			touch = e.pointerType === "touch";
			if (inZone(y)) {
				stay();
				setRevealed(true);
			} else if (y > Math.max(bar()?.getBoundingClientRect().bottom ?? 0, edge() + threshold) + 8) hideSoon();
		};
		const onMove = (e: Event) => at(e as PointerEvent, (e as PointerEvent).clientY);
		const onLeave = (e: Event) => {
			// A finger "leaves" after every tap (it stops existing when lifted), which would hide the bar it just revealed.
			if ((e as PointerEvent).pointerType === "touch") return;
			// On the document, pointerout fires between any two elements; only a null target means the pointer left the window.
			if (!(el instanceof Document) || !(e as PointerEvent).relatedTarget) {
				outside = true;
				hideSoon();
			}
		};
		/**
		 * Whether the pointer has moved since `lastY` without an event saying so. What it's on now (:hover, which the
		 * browser keeps current without events) has to reach that height; inside a cross-origin frame it can't be told.
		 */
		const lastYStale = () => {
			let scope: ParentNode | null = opts.current.frames();
			let top = 0;
			while (scope) {
				const hovered = scope.querySelectorAll(":hover");
				const on = hovered[hovered.length - 1];
				if (!on) return true;
				const rect = on.getBoundingClientRect();
				// By tag: a frame inside a frame is from that page's realm, not an HTMLIFrameElement of this one.
				if (on.tagName !== "IFRAME") return lastY < top + rect.top - 1 || lastY > top + rect.bottom + 1;
				top += rect.top;
				try {
					scope = (on as HTMLIFrameElement).contentDocument;
				} catch {
					scope = null;
				}
			}
			return true;
		};
		check.current = () => {
			if (touch) return;
			// On the bar, or still at the edge that brought it out.
			if (opts.current.bar()?.matches(":hover") || (!outside && inZone(lastY) && !lastYStale())) stay();
			else hideSoon();
		};
		const barEl = opts.current.bar();
		const onBarLeave = (e: Event) => (e as PointerEvent).pointerType !== "touch" && hideSoon();

		// Frames are watched per document, not per window: a frame's window object stays the same when it navigates,
		// but the listeners on it go with the old page. Listeners left on a page that's gone stop doing anything once
		// this effect ends (removing them would mean holding on to every old page).
		let live = true;
		const watched = new WeakSet<Document>();
		/** Hears pointer moves in a same-origin frame and the frames inside it; `top` is the frame's y in this window. Gives false when it can't. */
		const watch = (frame: HTMLIFrameElement, top: () => number): boolean => {
			let doc: Document | null = null;
			try {
				doc = frame.contentDocument;
			} catch {
				// Cross-origin.
			}
			if (!doc) return false;
			if (!watched.has(doc)) {
				watched.add(doc);
				const handler = (e: PointerEvent) => live && at(e, top() + e.clientY);
				doc.addEventListener("pointermove", handler, true);
				doc.addEventListener("pointerdown", handler, true);
			}
			for (const inner of doc.querySelectorAll("iframe")) watch(inner, () => top() + inner.getBoundingClientRect().top);
			return true;
		};
		const attachFrames = () => {
			const scope = opts.current.frames();
			if (!scope) return;
			for (const frame of scope.querySelectorAll("iframe")) watch(frame, () => frame.getBoundingClientRect().top);
		};
		// The pointer went into a frame: watch it now, since it may have just navigated.
		const onOver = (e: Event) => {
			const frame = e.composedPath()[0];
			if (frame instanceof HTMLIFrameElement) watch(frame, () => frame.getBoundingClientRect().top);
		};

		el.addEventListener("pointermove", onMove);
		el.addEventListener("pointerdown", onMove);
		el.addEventListener("pointerover", onOver);
		el.addEventListener(el instanceof Document ? "pointerout" : "pointerleave", onLeave);
		barEl?.addEventListener("pointerenter", stay);
		barEl?.addEventListener("pointerleave", onBarLeave);
		attachFrames();
		const timer = window.setInterval(attachFrames, 1000);
		return () => {
			live = false;
			check.current = null;
			stay();
			el.removeEventListener("pointermove", onMove);
			el.removeEventListener("pointerdown", onMove);
			el.removeEventListener("pointerover", onOver);
			el.removeEventListener(el instanceof Document ? "pointerout" : "pointerleave", onLeave);
			barEl?.removeEventListener("pointerenter", stay);
			barEl?.removeEventListener("pointerleave", onBarLeave);
			window.clearInterval(timer);
		};
	}, [enabled, threshold]);
};

/** The bar's settings: behaviour and hover distance. `trigger` renders the button that opens it. */
export const BarSettingsMenu = ({ bar, dark, title, trigger }: { bar: CollapsibleBar; dark: boolean; title: string; trigger: (toggle: () => void, open: boolean) => ReactNode }) => {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const onDown = (e: PointerEvent) => {
			if (ref.current && !e.composedPath().includes(ref.current)) setOpen(false);
		};
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
		document.addEventListener("pointerdown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("pointerdown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	// Keep an auto-hidden bar showing while its settings are open.
	const { hold } = bar;
	useEffect(() => (open ? hold() : undefined), [open, hold]);

	return (
		<div ref={ref} className="relative flex">
			{trigger(() => setOpen(v => !v), open)}
			{open && <BarSettingsPanel bar={bar} dark={dark} title={title} className="absolute right-0 top-full z-50 mt-2" />}
		</div>
	);
};

/** The settings card itself, with a live preview of the hover zone along the top of the window. */
export const BarSettingsPanel = ({ bar, dark, title, className = "" }: { bar: CollapsibleBar; dark: boolean; title: string; className?: string }) => {
	const surface = dark ? "bg-[#1e1e1ef0] border border-[#ffffff1a]" : "bg-[#fafafaf0] border border-[#00000014]";
	const option = (on: boolean) => `flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer duration-150 ${on ? "bg-(--accent) text-white" : dark ? "bg-[#ffffff10] hover:bg-[#ffffff1c]" : "bg-[#00000010] hover:bg-[#0000001c]"}`;

	return (
		<div role="dialog" className={`flex w-64 flex-col gap-3 rounded-xl p-3 text-(--text-primary) shadow-[0_10px_40px_#00000060] backdrop-blur-xl ${surface} ${className}`}>
			<span className="text-sm font-semibold">
				<HolyText text={title} />
			</span>
			<div className="flex gap-1.5">
				<button className={option(bar.mode === "hover")} onClick={() => bar.setMode("hover")}>
					<HolyText text="Show on hover" />
				</button>
				<button className={option(bar.mode === "button")} onClick={() => bar.setMode("button")}>
					<HolyText text="Open/close button" />
				</button>
			</div>
			{bar.mode === "hover" ? (
				<>
					<label className="flex flex-col gap-1.5">
						<span className="flex justify-between text-xs text-(--text-secondary)">
							<HolyText text="Hover zone" />
							<span className="font-mono tabular-nums">{bar.threshold}px</span>
						</span>
						<input type="range" min={THRESHOLD_MIN} max={THRESHOLD_MAX} step={2} value={bar.threshold} onChange={e => bar.setThreshold(Number(e.target.value))} className="w-full accent-(--accent)" />
					</label>
					<p className="text-xs leading-snug text-(--text-tertiary)">
						<HolyText text="When the bar isn't kept open, it hides and comes back when the pointer is this close to the top." />
					</p>
					{createPortal(
						<div className="fixed inset-x-0 top-0 z-[9999] pointer-events-none transition-all duration-150 ease-out" style={{ height: bar.threshold }}>
							<div className="size-full bg-(--accent) opacity-15 rounded-b-lg" />
							<div className="absolute inset-x-0 bottom-0 h-px bg-(--accent) opacity-40" />
						</div>,
						portalTarget(),
					)}
				</>
			) : (
				<p className="text-xs leading-snug text-(--text-tertiary)">
					<HolyText text="The bar only opens and closes with its button." />
				</p>
			)}
		</div>
	);
};

/** The small tab left at the top while a bar is closed in button mode. */
export const BarOpenHandle = ({ dark, onOpen, className = "" }: { dark: boolean; onOpen: () => void; className?: string }) => {
	const { ref, placeholder } = useHolyAttr({ title: "Open the bar", "aria-label": "Open the bar" });
	return (
		<button ref={ref} {...placeholder} onClick={onOpen} className={`absolute left-1/2 top-0 z-40 -translate-x-1/2 flex items-center justify-center px-4 py-0.5 rounded-b-lg opacity-50 hover:opacity-100 cursor-pointer duration-150 ${dark ? "bg-[#000000a0] text-white" : "bg-[#ffffffc0] text-black"} ${className}`}>
			<ChevronDownIcon className="size-4" />
		</button>
	);
};
