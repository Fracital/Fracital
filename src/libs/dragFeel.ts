/** How pointer drags feel across the app (the music queue, the tab view's groups). */

/** How far a mouse moves before a press becomes a drag, and how long a finger holds before one does. */
export const DRAG_DISTANCE = 5;
export const TOUCH_HOLD_MS = 280;
/** Within this distance of a scroller's top or bottom edge, it scrolls while something is held. */
export const EDGE = 48;
export const EASE = "cubic-bezier(.2, .8, .2, 1)";

/** How fast to scroll a held drag at `y` past or near `box`'s top/bottom edge: faster the further out. */
export const edgeScrollSpeed = (y: number, box: DOMRect) => (y < box.top + EDGE ? -Math.min(22, (box.top + EDGE - y) / 3 + 2) : y > box.bottom - EDGE ? Math.min(22, (y - box.bottom + EDGE) / 3 + 2) : 0);

/** The nearest ancestor that actually scrolls. */
export const scrollParent = (el: HTMLElement | null) => {
	let box = el?.parentElement ?? null;
	while (box && !(/(auto|scroll)/.test(getComputedStyle(box).overflowY) && box.scrollHeight > box.clientHeight)) box = box.parentElement;
	return box;
};

interface PressToDragOptions {
	/** The list to scroll while the pointer is held near (or past) its top or bottom edge. */
	scroller: () => HTMLElement | null;
	/** The press became a drag (moved far enough, or a finger held still). */
	onBegin: () => void;
	/** The pointer moved, or the list scrolled under it, mid-drag. */
	onMove: (x: number, y: number) => void;
	/** The drag ended: released, or cancelled (Escape, pointer cancel). Only called once a drag began. */
	onEnd: (x: number, y: number, cancelled: boolean) => void;
	/** The press is over, drag or not. */
	onRelease?: () => void;
}

/**
 * Turns a pointer press into a drag the way the music queue does: a mouse drags once it moves a few pixels, a finger
 * once it holds still (moving first is a scroll); the list scrolls near its edges; Escape cancels (without reaching
 * other Escape handlers); the page doesn't scroll under a dragging finger. Returns a function that stops it.
 */
export const pressToDrag = (press: { pointerId: number; pointerType: string; clientX: number; clientY: number }, opts: PressToDragOptions) => {
	const touch = press.pointerType === "touch";
	let x = press.clientX;
	let y = press.clientY;
	let active = false;
	let timer = 0;
	let raf = 0;

	const tick = () => {
		const s = opts.scroller();
		if (s) {
			const before = s.scrollTop;
			s.scrollTop += edgeScrollSpeed(y, s.getBoundingClientRect());
			if (s.scrollTop !== before) opts.onMove(x, y);
		}
		raf = requestAnimationFrame(tick);
	};
	const begin = () => {
		active = true;
		document.getSelection()?.removeAllRanges();
		raf = requestAnimationFrame(tick);
		opts.onBegin();
		opts.onMove(x, y);
	};
	const stop = () => {
		window.clearTimeout(timer);
		cancelAnimationFrame(raf);
		window.removeEventListener("pointermove", move);
		window.removeEventListener("pointerup", up);
		window.removeEventListener("pointercancel", cancel);
		window.removeEventListener("keydown", key, { capture: true });
		window.removeEventListener("touchmove", blockScroll);
	};
	const end = (cancelled: boolean) => {
		stop();
		opts.onRelease?.();
		if (active) opts.onEnd(x, y, cancelled);
	};
	const move = (ev: PointerEvent) => {
		if (ev.pointerId !== press.pointerId) return;
		x = ev.clientX;
		y = ev.clientY;
		if (!active) {
			const dist = Math.hypot(ev.clientX - press.clientX, ev.clientY - press.clientY);
			if (touch) {
				if (dist > 8) end(true);
				return;
			}
			if (dist < DRAG_DISTANCE) return;
			begin();
			return;
		}
		opts.onMove(x, y);
	};
	const up = (ev: PointerEvent) => ev.pointerId === press.pointerId && end(false);
	const cancel = (ev: PointerEvent) => ev.pointerId === press.pointerId && end(true);
	const key = (ev: KeyboardEvent) => {
		if (ev.key !== "Escape" || !active) return;
		ev.stopImmediatePropagation();
		end(true);
	};
	const blockScroll = (ev: TouchEvent) => active && ev.cancelable && ev.preventDefault();

	window.addEventListener("pointermove", move);
	window.addEventListener("pointerup", up);
	window.addEventListener("pointercancel", cancel);
	window.addEventListener("keydown", key, { capture: true });
	window.addEventListener("touchmove", blockScroll, { passive: false });
	if (touch)
		timer = window.setTimeout(() => {
			begin();
			navigator.vibrate?.(10);
		}, TOUCH_HOLD_MS);
	return stop;
};
