import { ChevronDownIcon } from "@heroicons/react/24/solid";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useHolyAttr } from "../libs/holy-attr";
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
	/** Something on the bar (its settings) needs it to stay shown. */
	setHeld: (held: boolean) => void;
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
	const [held, setHeld] = useState(false);
	const autoHide = mode === "hover" && !pinned;
	return { mode, setMode, threshold, setThreshold, pinned, setPinned, open, setOpen, revealed, setRevealed, setHeld, autoHide, shown: autoHide && (revealed || held), inFlow: mode === "hover" ? pinned : open };
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
	/** Viewport y of the revealed bar's bottom; moving below it hides the bar again. */
	barBottom: () => number;
	setRevealed: (revealed: boolean) => void;
}

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
 * Reveals an auto-hidden bar while the pointer is within `threshold` px of its edge, or over the bar. A tap (which
 * moves no pointer first) counts the same: on the edge it reveals the bar, below the bar it hides it again.
 */
export const useHoverReveal = ({ enabled, threshold, target, frames, edge, barBottom, setRevealed }: HoverRevealOptions) => {
	const opts = useRef({ target, frames, edge, barBottom, setRevealed });
	useEffect(() => {
		opts.current = { target, frames, edge, barBottom, setRevealed };
	});

	useEffect(() => {
		const el = opts.current.target();
		if (!enabled || !el) return;
		const at = (y: number) => {
			const { edge, barBottom, setRevealed } = opts.current;
			const offset = y - edge();
			if (offset >= 0 && offset <= threshold) setRevealed(true);
			else if (y > Math.max(barBottom(), edge() + threshold) + 8) setRevealed(false);
		};
		const onMove = (e: Event) => at((e as PointerEvent).clientY);
		const onLeave = (e: Event) => {
			// A finger "leaves" after every tap (it stops existing when lifted), which would hide the bar it just revealed.
			if ((e as PointerEvent).pointerType === "touch") return;
			// On the document, pointerout fires between any two elements; only a null target means the pointer left the window.
			if (!(el instanceof Document) || !(e as PointerEvent).relatedTarget) opts.current.setRevealed(false);
		};
		el.addEventListener("pointermove", onMove);
		el.addEventListener("pointerdown", onMove);
		el.addEventListener(el instanceof Document ? "pointerout" : "pointerleave", onLeave);

		const watched = new WeakSet<Window>();
		const cleanups: (() => void)[] = [];
		const attachFrames = () => {
			const scope = opts.current.frames();
			if (!scope) return;
			for (const frame of scope.querySelectorAll("iframe")) {
				try {
					const win = frame.contentWindow;
					if (!win || watched.has(win)) continue;
					watched.add(win);
					const handler = (e: PointerEvent) => at(frame.getBoundingClientRect().top + e.clientY);
					win.addEventListener("pointermove", handler);
					win.addEventListener("pointerdown", handler);
					cleanups.push(() => {
						win.removeEventListener("pointermove", handler);
						win.removeEventListener("pointerdown", handler);
					});
				} catch {
					// Cross-origin frame: only the area outside it can reveal the bar.
				}
			}
		};
		attachFrames();
		const timer = window.setInterval(attachFrames, 1000);
		return () => {
			el.removeEventListener("pointermove", onMove);
			el.removeEventListener("pointerdown", onMove);
			el.removeEventListener(el instanceof Document ? "pointerout" : "pointerleave", onLeave);
			window.clearInterval(timer);
			for (const cleanup of cleanups) {
				try {
					cleanup();
				} catch {
					// The frame's document is already gone.
				}
			}
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
	const { setHeld } = bar;
	useEffect(() => {
		setHeld(open);
		return () => setHeld(false);
	}, [open, setHeld]);

	const surface = dark ? "bg-[#1e1e1ef0] border border-[#ffffff1a]" : "bg-[#fafafaf0] border border-[#00000014]";
	const option = (on: boolean) => `flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer duration-150 ${on ? "bg-(--accent) text-white" : dark ? "bg-[#ffffff10] hover:bg-[#ffffff1c]" : "bg-[#00000010] hover:bg-[#0000001c]"}`;

	return (
		<div ref={ref} className="relative flex">
			{trigger(() => setOpen(v => !v), open)}
			{open && (
				<div role="dialog" className={`absolute right-0 top-full z-50 mt-2 flex w-64 flex-col gap-3 rounded-xl p-3 text-(--text-primary) shadow-[0_10px_40px_#00000060] backdrop-blur-xl ${surface}`}>
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
						</>
					) : (
						<p className="text-xs leading-snug text-(--text-tertiary)">
							<HolyText text="The bar only opens and closes with its button." />
						</p>
					)}
				</div>
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
