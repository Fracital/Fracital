import { BackspaceIcon, BarsArrowUpIcon, ChevronDoubleDownIcon, ChevronDoubleUpIcon, ChevronDownIcon, ChevronUpIcon, EllipsisHorizontalIcon, HeartIcon, MusicalNoteIcon, PauseIcon, PlusIcon, RadioIcon, SpeakerWaveIcon, UserIcon } from "@heroicons/react/24/solid";
import { CheckCircleIcon, HeartIcon as HeartOutlineIcon, MinusCircleIcon, PlusCircleIcon } from "@heroicons/react/24/outline";
import { type CSSProperties, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { HolyText } from "./common/HolyText";
import { PlayCount } from "./PlayCount";
import { usePlaylistMenu } from "./PlaylistMenu";
import { RadioStatus } from "./RadioStatus";
import { ensurePlaylistsLoaded, isDisliked, isLiked, toggleDislike, toggleLike, trackFromPlayer, usePlaylistStore } from "../libs/playlists";
import { clearQueue, startRadio } from "../libs/radio";
import { ensureSavedLoaded, useSavedStore } from "../libs/savedLibrary";
import { openArtistByName, openTrackAlbum, openTrackArtist, trackArtists } from "../libs/trackLinks";
import { useMusicStore, usePlaybackStore } from "../store";
import { reducedMotion, scrollBehavior } from "../libs/motion";
import type { Track } from "../types";

type RowState = "played" | "current" | "next";

const artistText = (t: Track) => trackArtists(t).join(", ");
/** Untagged local files have nothing to link to. */
const linkable = (t: Track) => !!t.title && !!artistText(t) && !/^unknown/i.test(artistText(t));

function useQueueSongMenu() {
	const playlistMenu = usePlaylistMenu();
	return (track: Track, state: RowState): MenuItem[] => {
		const song = trackFromPlayer(track);
		const music = useMusicStore.getState();
		const saved = useSavedStore.getState().tracks.some(t => t.id === song.id);
		const feedback = usePlaylistStore.getState();
		const liked = isLiked(feedback, track.title, song.artist);
		const disliked = isDisliked(feedback, track.title, song.artist);
		const items: MenuItem[] = [
			{ title: <HolyText text="Play next" />, icon: <BarsArrowUpIcon className="size-5" />, onClick: () => music.queueNext([track]) },
			{ title: <HolyText text="Add to queue" />, icon: <PlusIcon className="size-5" />, onClick: () => music.addTrack(track) },
			{ title: <HolyText text={saved ? "Remove from library" : "Add to library"} />, icon: saved ? <CheckCircleIcon className="size-5 text-[#3d91ff]" /> : <PlusCircleIcon className="size-5" />, onClick: () => useSavedStore.getState().toggleTrack(song) },
			{ title: <HolyText text={liked ? "Remove from Liked Songs" : "Like song"} />, icon: liked ? <HeartIcon className="size-5 text-[#ff3b5c]" /> : <HeartOutlineIcon className="size-5" />, onClick: () => toggleLike(song) },
			playlistMenu(song),
			{ title: <HolyText text={disliked ? "Recommend again" : "Don't recommend"} />, icon: <MinusCircleIcon className="size-5" />, onClick: () => toggleDislike(song) },
		];
		if (linkable(track)) {
			items.push(
				{ title: <HolyText text="Start radio" />, icon: <RadioIcon className="size-5" />, onClick: () => void startRadio(trackArtists(track)[0], track.title) },
				{ title: <HolyText text="Go to album" />, icon: <MusicalNoteIcon className="size-5" />, onClick: () => openTrackAlbum(track) },
				{ title: <HolyText text="Go to artist" />, icon: <UserIcon className="size-5" />, onClick: () => openTrackArtist(track, trackArtists(track)[0]) },
			);
		}
		if (state === "next") {
			// Moving without dragging (also how keyboard and touch users reorder).
			const queue = music.queue;
			const i = queue.findIndex(t => t.id === track.id);
			const move = (targetIndex: number, before: boolean) => () => useMusicStore.getState().reorderQueue(track.id, queue[targetIndex].id, before);
			if (i > 0) items.push({ title: <HolyText text="Move to top" />, icon: <ChevronDoubleUpIcon className="size-5" />, onClick: move(0, true) }, { title: <HolyText text="Move up" />, icon: <ChevronUpIcon className="size-5" />, onClick: move(i - 1, true) });
			if (i >= 0 && i < queue.length - 1) items.push({ title: <HolyText text="Move down" />, icon: <ChevronDownIcon className="size-5" />, onClick: move(i + 1, false) }, { title: <HolyText text="Move to end" />, icon: <ChevronDoubleDownIcon className="size-5" />, onClick: move(queue.length - 1, false) });
		}
		if (state !== "current") items.push({ title: <HolyText text="Remove from queue" />, icon: <BackspaceIcon className="size-5" />, onClick: () => music.removeTrack(track.id) });
		return items;
	};
}

/** How far a mouse moves before a press becomes a drag, and how long a finger holds before one does. */
const DRAG_DISTANCE = 5;
const TOUCH_HOLD_MS = 280;
const SETTLE_MS = 160;
/** Within this distance of the list's top or bottom edge, the list scrolls while a song is held. */
const EDGE = 48;
const EASE = "cubic-bezier(.2, .8, .2, 1)";
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The list as shown, read live: played since the list started, the playing song, then what's next. */
const listIds = () => {
	const { playedHistory, historyStart, currentTrack, queue } = useMusicStore.getState();
	return [...playedHistory.slice(historyStart), ...(currentTrack ? [currentTrack] : []), ...queue].map(t => t.id);
};

/** The nearest ancestor that actually scrolls. */
const scrollParent = (el: HTMLElement | null) => {
	let box = el?.parentElement ?? null;
	while (box && !(/(auto|scroll)/.test(getComputedStyle(box).overflowY) && box.scrollHeight > box.clientHeight)) box = box.parentElement;
	return box;
};

/** A press on a song in the list, which becomes a drag once the pointer moves (or a finger holds). */
interface Hold {
	id: string;
	pointerId: number;
	y: number;
	/** Where in the row it was grabbed, so the row stays under the pointer the same way. */
	grab: number;
	active: boolean;
	timer: number;
	raf: number;
	scroller: HTMLElement | null;
	cleanup: () => void;
}

interface DragView {
	id: string;
	from: number;
	to: number;
	/** The held song's offset from its own place in the list. */
	offset: number;
	/** How far the songs between its old and new place slide to make room. */
	shift: number;
	settling: boolean;
}

interface QueueListProps {
	dark: boolean;
	/** "panel": the big player's queue; "compact": the side panel's. */
	variant: "panel" | "compact";
}

/**
 * The queue: songs played since this list started, the playing one, and what's next. Any song can
 * be dragged (touch holds first); above the list makes it first, below makes it last. Songs above
 * the playing one count as played, songs below it come next.
 */
export const QueueList = ({ dark, variant }: QueueListProps) => {
	const queue = useMusicStore(s => s.queue);
	const current = useMusicStore(s => s.currentTrack);
	const history = useMusicStore(s => s.playedHistory);
	const historyStart = useMusicStore(s => s.historyStart);
	const isPlaying = usePlaybackStore(s => s.isPlaying);
	const feedback = usePlaylistStore(s => s);
	const songMenu = useQueueSongMenu();
	const [menu, setMenu] = useState<{ items: MenuItem[]; position: { x: number; y: number } } | null>(null);
	const [view, setView] = useState<DragView | null>(null);
	// One render with transitions off right after a drop, so reordered songs don't animate from their old offsets.
	const [frozen, setFrozen] = useState(false);
	const listRef = useRef<HTMLDivElement>(null);
	const currentRef = useRef<HTMLDivElement>(null);
	const rowRefs = useRef(new Map<string, HTMLDivElement>());
	const hold = useRef<Hold | null>(null);
	const settleTimer = useRef(0);
	const suppressClick = useRef(false);

	useEffect(() => {
		ensurePlaylistsLoaded();
		ensureSavedLoaded();
		return () => {
			hold.current?.cleanup();
			hold.current = null;
			clearTimeout(settleTimer.current);
		};
	}, []);
	// Keep the playing song in view as the list moves on. Only the list's own scroller moves:
	// scrollIntoView would also scroll the player's overflow-hidden layout and shift its controls.
	useEffect(() => {
		const row = currentRef.current;
		const box = scrollParent(row);
		if (!row || !box) return;
		const r = row.getBoundingClientRect();
		const b = box.getBoundingClientRect();
		if (r.top < b.top || r.bottom > b.bottom) box.scrollBy({ top: r.top - b.top - b.height / 3, behavior: scrollBehavior() });
	}, [current?.id]);

	/** Where the held song would land and how everything sits, from the live list and layout. */
	const compute = (h: Hold, settling = false): DragView | null => {
		const ids = listIds();
		const from = ids.indexOf(h.id);
		const list = listRef.current;
		const els = ids.map(id => rowRefs.current.get(id));
		if (from < 0 || !list || els.some(el => !el)) return null;
		// Layout positions inside the list: transforms don't affect them, so they hold mid-drag.
		const tops = els.map(el => el?.offsetTop ?? 0);
		const heights = els.map(el => el?.offsetHeight ?? 0);
		const gap = tops.length > 1 ? tops[1] - tops[0] - heights[0] : 4;
		const last = ids.length - 1;
		// The pointer in the list's coordinates (the list's box moves as it scrolls, so this follows).
		const py = h.y - list.getBoundingClientRect().top;
		const box = h.scroller?.getBoundingClientRect();
		let to = 0;
		if (box && h.y < box.top) to = 0;
		else if (box && h.y > box.bottom) to = last;
		else for (let j = 0; j < ids.length; j++) if (j !== from && tops[j] + heights[j] / 2 < py) to++;
		const offset = settling ? (to > from ? tops[to] + heights[to] - tops[from] - heights[from] : tops[to] - tops[from]) : clamp(py - h.grab - tops[from], tops[0] - tops[from], tops[last] + heights[last] - heights[from] - tops[from]);
		return { id: h.id, from, to, offset, shift: heights[from] + gap, settling };
	};

	const stop = (h: Hold) => {
		h.cleanup();
		if (hold.current === h) hold.current = null;
		setView(null);
	};
	const refresh = (h: Hold) => {
		const v = compute(h);
		if (v) setView(v);
		// The held song left the list (removed, or the queue was cleared).
		else stop(h);
	};

	// Songs ending or radio adding more mid-drag: re-place everything against the new list.
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs on list changes; refresh reads live state.
	useEffect(() => {
		const h = hold.current;
		if (h?.active) refresh(h);
	}, [queue, current, history, historyStart]);

	const onRowPointerDown = (e: ReactPointerEvent<HTMLDivElement>, id: string) => {
		if (e.button !== 0 || hold.current || (e.target as HTMLElement).closest("button")) return;
		const row = rowRefs.current.get(id);
		if (!row || !listRef.current) return;
		const touch = e.pointerType === "touch";
		const startX = e.clientX;
		const startY = e.clientY;
		const h: Hold = { id, pointerId: e.pointerId, y: e.clientY, grab: e.clientY - row.getBoundingClientRect().top, active: false, timer: 0, raf: 0, scroller: scrollParent(listRef.current), cleanup: () => {} };

		// Near (or past) the top or bottom of the list, scroll it, faster the further out the pointer is.
		const tick = () => {
			const s = h.scroller;
			if (s) {
				const b = s.getBoundingClientRect();
				const speed = h.y < b.top + EDGE ? -Math.min(22, (b.top + EDGE - h.y) / 3 + 2) : h.y > b.bottom - EDGE ? Math.min(22, (h.y - b.bottom + EDGE) / 3 + 2) : 0;
				const before = s.scrollTop;
				s.scrollTop += speed;
				if (s.scrollTop !== before) refresh(h);
			}
			h.raf = requestAnimationFrame(tick);
		};
		const begin = () => {
			h.active = true;
			document.getSelection()?.removeAllRanges();
			h.raf = requestAnimationFrame(tick);
			refresh(h);
		};
		const end = (cancelled: boolean) => {
			h.cleanup();
			if (!h.active) {
				hold.current = null;
				return;
			}
			// The release still clicks whatever is under it; swallow that (reset on the next press).
			suppressClick.current = true;
			const final = cancelled ? null : compute(h, true);
			setView(v => (final ? final : v && { ...v, to: v.from, offset: 0, settling: true }));
			settleTimer.current = window.setTimeout(
				() => {
					if (final && final.to !== final.from) useMusicStore.getState().moveInList(final.id, final.to);
					hold.current = null;
					setFrozen(true);
					setView(null);
					requestAnimationFrame(() => requestAnimationFrame(() => setFrozen(false)));
				},
				reducedMotion() ? 0 : SETTLE_MS,
			);
		};
		const move = (ev: PointerEvent) => {
			if (ev.pointerId !== h.pointerId) return;
			h.y = ev.clientY;
			if (!h.active) {
				const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY);
				// A finger that moves before the hold is scrolling, not dragging.
				if (touch) {
					if (dist > 8) end(true);
					return;
				}
				if (dist < DRAG_DISTANCE) return;
				begin();
			}
			refresh(h);
		};
		const up = (ev: PointerEvent) => ev.pointerId === h.pointerId && end(false);
		const cancel = (ev: PointerEvent) => ev.pointerId === h.pointerId && end(true);
		const key = (ev: KeyboardEvent) => ev.key === "Escape" && end(true);
		// While a finger drags a song, the page must not scroll under it.
		const blockScroll = (ev: TouchEvent) => h.active && ev.cancelable && ev.preventDefault();
		h.cleanup = () => {
			clearTimeout(h.timer);
			cancelAnimationFrame(h.raf);
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			window.removeEventListener("pointercancel", cancel);
			window.removeEventListener("keydown", key);
			window.removeEventListener("touchmove", blockScroll);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
		window.addEventListener("pointercancel", cancel);
		window.addEventListener("keydown", key);
		window.addEventListener("touchmove", blockScroll, { passive: false });
		if (touch)
			h.timer = window.setTimeout(() => {
				begin();
				navigator.vibrate?.(10);
			}, TOUCH_HOLD_MS);
		hold.current = h;
	};

	/** Transform for a song while one is held: the held one follows the pointer, the rest make room. */
	const rowStyle = (id: string, index: number): CSSProperties | undefined => {
		if (frozen) return { transition: "none" };
		if (!view) return undefined;
		const { from, to } = view;
		if (id === view.id)
			return {
				position: "relative",
				zIndex: 10,
				cursor: "grabbing",
				transform: `translateY(${view.offset}px) scale(${view.settling ? 1 : 1.02})`,
				transition: view.settling ? `transform ${SETTLE_MS}ms ${EASE}, box-shadow ${SETTLE_MS}ms ease` : "box-shadow 150ms ease",
				boxShadow: view.settling ? "0 0 0 0 transparent" : "0 12px 28px -8px #000000a0, 0 0 0 1px color-mix(in srgb, var(--accent) 60%, transparent)",
				background: dark ? "#ffffff24" : "#ffffffd9",
				backdropFilter: "blur(16px)",
			};
		const shift = from < to && index > from && index <= to ? -view.shift : to < from && index >= to && index < from ? view.shift : 0;
		return { transform: shift ? `translateY(${shift}px)` : undefined, transition: `transform 180ms ${EASE}` };
	};

	const rows: { track: Track; state: RowState }[] = [...history.slice(historyStart).map(track => ({ track, state: "played" as const })), ...(current ? [{ track: current, state: "current" as const }] : []), ...queue.map(track => ({ track, state: "next" as const }))];
	const compact = variant === "compact";
	const hover = dark ? "hover:bg-[#ffffff18]" : "hover:bg-[#00000010]";
	const upcoming = queue.length;

	if (!rows.length) {
		return (
			<div className="flex flex-col items-center justify-center gap-2 py-8 text-(--text-secondary)">
				<span className="text-lg font-semibold text-(--text-primary)">
					<HolyText text="Queue is empty" />
				</span>
				<RadioStatus className="mt-2" />
			</div>
		);
	}

	return (
		<div
			ref={listRef}
			className={`relative flex flex-col gap-1 w-full ${view ? "cursor-grabbing select-none" : ""}`}
			onPointerDownCapture={() => {
				suppressClick.current = false;
			}}
			onClickCapture={e => {
				if (!suppressClick.current) return;
				suppressClick.current = false;
				e.stopPropagation();
				e.preventDefault();
			}}
		>
			<RadioStatus className="mb-1 w-full" />
			<div className="flex items-center justify-between gap-2 px-1.5 pb-1">
				<h2 className={`${compact ? "text-2xl" : "text-lg"} font-bold`}>
					<HolyText text="Queue" />
				</h2>
				{(upcoming > 0 || historyStart < history.length) && (
					<button type="button" className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold text-(--text-secondary) hover:text-(--text-primary) cursor-pointer duration-150 ${dark ? "bg-[#ffffff18] hover:bg-[#ffffff28]" : "bg-[#00000010] hover:bg-[#0000001c]"}`} onClick={clearQueue}>
						<HolyText text="Clear queue" />
					</button>
				)}
			</div>
			{rows.map(({ track, state }, index) => {
				const isCurrent = state === "current";
				const artists = trackArtists(track);
				const links = linkable(track);
				const liked = isLiked(feedback, track.title, artistText(track));
				return (
					<div
						key={track.id}
						ref={el => {
							if (isCurrent) currentRef.current = el;
							if (el) rowRefs.current.set(track.id, el);
							else rowRefs.current.delete(track.id);
						}}
						aria-current={isCurrent ? "true" : undefined}
						style={rowStyle(track.id, index)}
						onPointerDown={e => onRowPointerDown(e, track.id)}
						onClick={() => !isCurrent && useMusicStore.getState().playFromQueue(track.id)}
						onContextMenu={e => {
							e.preventDefault();
							// A touch hold that picked the song up isn't asking for the menu.
							if (hold.current?.active) return;
							setMenu({ items: songMenu(track, state), position: { x: e.clientX, y: e.clientY } });
						}}
						className={`group flex items-center gap-3 rounded-lg ${compact ? "p-1.5" : "p-2"} duration-150 ${isCurrent ? (dark ? "bg-[#ffffff1c]" : "bg-[#00000012]") : `cursor-pointer ${view ? "" : hover}`} select-none [-webkit-touch-callout:none]`}
					>
						<div className="relative shrink-0">
							{track.cover ? (
								<img src={track.cover} alt="" draggable={false} className={`${compact ? "size-10" : "size-12"} rounded-md object-cover`} />
							) : (
								<div className={`${compact ? "size-10" : "size-12"} rounded-md flex justify-center items-center bg-(--primary) text-(--text-secondary)`}>
									<MusicalNoteIcon className="size-6" />
								</div>
							)}
							{isCurrent && <div className="absolute inset-0 flex items-center justify-center rounded-md bg-black/45">{isPlaying ? <SpeakerWaveIcon className="size-5 text-white" /> : <PauseIcon className="size-5 text-white" />}</div>}
						</div>
						<div className="flex flex-1 min-w-0 flex-col gap-1">
							<span className={`truncate font-semibold leading-none ${isCurrent ? "text-(--accent)" : ""}`}>
								<span
									title={track.title}
									className={links ? "cursor-pointer hover:underline" : ""}
									onClick={
										links
											? e => {
													e.stopPropagation();
													openTrackAlbum(track);
												}
											: undefined
									}
								>
									{track.title}
								</span>
							</span>
							<span className={`truncate ${compact ? "text-xs" : "text-sm"} leading-none text-(--text-secondary)`}>
								{artists.map((name, i) => (
									<span key={`${name}-${i}`}>
										<span
											className={links ? "cursor-pointer hover:underline hover:text-(--text-primary)" : ""}
											onClick={
												links
													? e => {
															e.stopPropagation();
															if (track.source === "digital-library") openTrackArtist(track, name);
															else openArtistByName(name);
														}
													: undefined
											}
										>
											{name}
										</span>
										{i < artists.length - 1 && ", "}
									</span>
								))}
								<PlayCount title={track.title} artist={track.artists} skeleton={false} prefix=" · " className="text-(--text-tertiary)" />
							</span>
						</div>
						{/* Plain titles below: each is its icon's or icon button's only accessible name. */}
						{liked && <HeartIcon className="size-4 shrink-0 text-[#ff3b5c]" aria-label="Liked" />}
						<button
							type="button"
							title="More options"
							className={`shrink-0 p-1.5 rounded-md text-(--text-secondary) hover:text-(--text-primary) cursor-pointer duration-150 ${isCurrent ? "" : "opacity-0 group-hover:opacity-100"} ${hover}`}
							onClick={e => {
								e.stopPropagation();
								setMenu({ items: songMenu(track, state), position: { x: e.clientX, y: e.clientY } });
							}}
						>
							<EllipsisHorizontalIcon className="size-5" />
						</button>
					</div>
				);
			})}
			{menu && <ContextMenu items={menu.items} position={menu.position} onClose={() => setMenu(null)} />}
		</div>
	);
};
