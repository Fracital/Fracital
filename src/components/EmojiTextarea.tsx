import { ClockIcon } from "@heroicons/react/24/outline";
import { FaceSmileIcon } from "@heroicons/react/24/solid";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { portalTarget } from "../libs/cloak";
import { EMOJI_GROUPS, type Emoji, emojiForCode, loadEmoji, recentEmoji, rememberEmoji, searchEmoji, shownCode } from "../libs/emoji";
import { useHolyAttr } from "../libs/holy-attr";
import { HolyText } from "./common/HolyText";

const SUGGESTIONS = 6;
const PICKER_W = 320;
const PICKER_H = 360;
/** The loading grid's cells. */
const SKELETON = Array.from({ length: 40 }, (_, i) => i);

/** A ":word" being typed right before the caret (after a space or the start, so times like "1:23" don't count). */
const TYPING = /(?:^|[\s(])(:([a-z0-9_+-]{2,}))$/i;
/** A finished ":shortcode:" right before the caret. */
const TYPED = /:([a-z0-9_+-]+):$/i;

/** An emoji's ":shortcode:" (the one a search matched), or its name when it has none. */
const label = (e: Emoji, query?: string) => {
	const code = shownCode(e, query);
	return code ? `:${code}:` : e.name;
};

type Rect = { top: number; bottom: number; left: number; right: number };
const rectOf = (el: Element): Rect => {
	const r = el.getBoundingClientRect();
	return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
};

interface EmojiTextareaProps extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> {
	value: string;
	onValueChange: (value: string) => void;
	/** For the holy-attr ref (and any other) on the textarea. */
	inputRef?: (el: HTMLTextAreaElement | null) => void;
}

/**
 * A textarea with an emoji keyboard (the smiley button) and :shortcodes:. Typing ":sob:" turns into 😭 as the last
 * colon goes in; typing ":so" lists matches above the box (arrows to move, Enter or Tab to pick, Esc to close).
 */
export const EmojiTextarea = ({ value, onValueChange, inputRef, onKeyDown, onFocus, onBlur, onSelect, className, maxLength, ...props }: EmojiTextareaProps) => {
	const ref = useRef<HTMLTextAreaElement | null>(null);
	const buttonRef = useRef<HTMLButtonElement | null>(null);
	/** Where the caret goes after the next value change (an emoji went in). */
	const caret = useRef<number | null>(null);
	/** The selection when the box last lost focus, for the picker (its search box takes the focus). */
	const selection = useRef<[number, number] | null>(null);
	const [suggest, setSuggest] = useState<{ start: number; end: number; query: string; results: Emoji[]; index: number; rect: Rect } | null>(null);
	const [picker, setPicker] = useState<Rect | null>(null);
	const { ref: emojiAttrRef, placeholder: emojiAttrs } = useHolyAttr({ title: "Emoji", "aria-label": "Emoji" });

	useLayoutEffect(() => {
		if (caret.current === null || !ref.current) return;
		ref.current.setSelectionRange(caret.current, caret.current);
		caret.current = null;
	});

	/** Puts text in place of [start, end), unless it'd go past the length limit. */
	const splice = useCallback(
		(start: number, end: number, text: string) => {
			const next = value.slice(0, start) + text + value.slice(end);
			if (maxLength !== undefined && next.length > maxLength) return false;
			caret.current = start + text.length;
			onValueChange(next);
			return true;
		},
		[value, maxLength, onValueChange],
	);

	/** A ":shortcode:" just finished: it becomes its emoji. */
	const finish = (text: string, at: number) => {
		const typed = text.slice(0, at).match(TYPED);
		const emoji = typed && emojiForCode(typed[1]);
		if (!typed || !emoji) return false;
		const start = at - typed[0].length;
		caret.current = start + emoji.length;
		onValueChange(text.slice(0, start) + emoji + text.slice(at));
		setSuggest(null);
		return true;
	};

	/** Lists the matches for the ":word" right before the caret, if there is one. */
	const check = (text: string, at: number) => {
		const typing = text.slice(0, at).match(TYPING);
		const results = typing ? searchEmoji(typing[2], SUGGESTIONS) : [];
		setSuggest(typing && results.length && ref.current ? { start: at - typing[1].length, end: at, query: typing[2], results, index: 0, rect: rectOf(ref.current) } : null);
	};

	const pickSuggestion = (e: Emoji) => {
		if (!suggest) return;
		if (splice(suggest.start, suggest.end, e.emoji)) rememberEmoji(e.emoji);
		setSuggest(null);
		ref.current?.focus();
	};

	const insert = (emoji: string) => {
		const el = ref.current;
		const [start, end] = el && document.activeElement === el ? [el.selectionStart, el.selectionEnd] : (selection.current ?? [value.length, value.length]);
		if (splice(start, end, emoji)) rememberEmoji(emoji);
		selection.current = [start + emoji.length, start + emoji.length];
	};

	// The lists are placed against the box, so they follow it when the page scrolls.
	// biome-ignore lint/correctness/useExhaustiveDependencies: only when the list opens or closes.
	useEffect(() => {
		if (!suggest) return;
		const follow = () => ref.current && setSuggest(s => (s && ref.current ? { ...s, rect: rectOf(ref.current) } : s));
		window.addEventListener("scroll", follow, true);
		window.addEventListener("resize", follow);
		return () => {
			window.removeEventListener("scroll", follow, true);
			window.removeEventListener("resize", follow);
		};
	}, [suggest !== null]);

	const above = suggest ? suggest.rect.top > SUGGESTIONS * 36 + 16 : true;

	return (
		<div className="relative">
			<textarea
				{...props}
				ref={el => {
					ref.current = el;
					inputRef?.(el);
				}}
				value={value}
				maxLength={maxLength}
				// Leave room on the right for the smiley (the box's own padding does).
				className={className}
				onChange={e => {
					const { value: text, selectionStart: at } = e.target;
					if (finish(text, at)) return;
					onValueChange(text);
					check(text, at);
				}}
				onFocus={e => {
					void loadEmoji();
					onFocus?.(e);
				}}
				onBlur={e => {
					selection.current = [e.target.selectionStart, e.target.selectionEnd];
					setSuggest(null);
					onBlur?.(e);
				}}
				onSelect={e => {
					// Moving the caret away from the ":word" closes its list.
					if (suggest) check(e.currentTarget.value, e.currentTarget.selectionStart);
					onSelect?.(e);
				}}
				onKeyDown={e => {
					if (suggest) {
						const move = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
						if (move) {
							e.preventDefault();
							setSuggest({ ...suggest, index: (suggest.index + move + suggest.results.length) % suggest.results.length });
							return;
						}
						if (e.key === "Enter" || e.key === "Tab") {
							e.preventDefault();
							pickSuggestion(suggest.results[suggest.index]);
							return;
						}
						if (e.key === "Escape") {
							e.preventDefault();
							e.stopPropagation();
							setSuggest(null);
							return;
						}
					}
					onKeyDown?.(e);
				}}
			/>
			<button
				ref={el => {
					buttonRef.current = el;
					emojiAttrRef(el);
				}}
				{...emojiAttrs}
				type="button"
				aria-haspopup="dialog"
				aria-expanded={!!picker}
				className={`absolute top-2 right-2 rounded-full cursor-pointer duration-150 ${picker ? "text-(--accent)" : "text-(--text-secondary) hover:text-(--text-primary) hover:scale-110"}`}
				// Keeps the caret in the box.
				onMouseDown={e => e.preventDefault()}
				onClick={e => {
					void loadEmoji();
					if (ref.current && document.activeElement === ref.current) selection.current = [ref.current.selectionStart, ref.current.selectionEnd];
					setPicker(picker ? null : rectOf(e.currentTarget));
				}}
			>
				<FaceSmileIcon className="size-5" />
			</button>

			{suggest &&
				createPortal(
					<ul
						className="fixed z-50 flex w-64 flex-col p-1 rounded-xl text-(--text-primary) bg-(--secondary) inset-shadow-(--inset-shadow-primary) shadow-lg"
						style={{ left: Math.max(8, Math.min(suggest.rect.left, window.innerWidth - 264)), ...(above ? { bottom: window.innerHeight - suggest.rect.top + 4 } : { top: suggest.rect.bottom + 4 }) }}
					>
						{suggest.results.map((e, i) => (
							<li key={e.emoji}>
								<button
									type="button"
									className={`flex w-full items-center gap-2.5 px-2 py-1.5 rounded-lg text-left text-sm cursor-pointer ${i === suggest.index ? "bg-(--accent)/20" : "hover:bg-[#8881]"}`}
									onMouseDown={ev => ev.preventDefault()}
									onMouseEnter={() => setSuggest({ ...suggest, index: i })}
									onClick={() => pickSuggestion(e)}
								>
									<span className="text-xl leading-none">{e.emoji}</span>
									{/* The shortcode: a data value. */}
									<span className="truncate font-medium">{label(e, suggest.query)}</span>
								</button>
							</li>
						))}
					</ul>,
					portalTarget(),
				)}

			{picker && <EmojiPicker anchor={picker} toggle={buttonRef} onPick={insert} onClose={() => setPicker(null)} onDone={() => ref.current?.focus()} />}
		</div>
	);
};

interface EmojiPickerProps {
	anchor: Rect;
	/** The button that opens it (a press on it toggles, so it isn't an outside click). */
	toggle: React.RefObject<HTMLButtonElement | null>;
	onPick: (emoji: string) => void;
	onClose: () => void;
	/** After a pick that closes it. */
	onDone: () => void;
}

/** The emoji keyboard: search, recent ones, then every emoji by group. Shift-click picks without closing. */
const EmojiPicker = ({ anchor, toggle, onPick, onClose, onDone }: EmojiPickerProps) => {
	const panel = useRef<HTMLDivElement>(null);
	const scroller = useRef<HTMLDivElement>(null);
	const sections = useRef<Record<string, HTMLElement | null>>({});
	const [all, setAll] = useState<Emoji[] | null>(null);
	const [query, setQuery] = useState("");
	const [hovered, setHovered] = useState<Emoji | null>(null);
	const [active, setActive] = useState("recent");
	const recent = useMemo(recentEmoji, []);
	const { ref: searchRef, placeholder: searchAttrs } = useHolyAttr({ placeholder: "Search emoji", "aria-label": "Search emoji" });

	useEffect(() => {
		void loadEmoji().then(setAll);
	}, []);

	useEffect(() => {
		const outside = (e: MouseEvent) => {
			const path = e.composedPath();
			if (panel.current && !path.includes(panel.current) && !(toggle.current && path.includes(toggle.current))) onClose();
		};
		const onEscape = (e: KeyboardEvent) => e.key === "Escape" && onClose();
		document.addEventListener("mousedown", outside);
		document.addEventListener("keydown", onEscape);
		return () => {
			document.removeEventListener("mousedown", outside);
			document.removeEventListener("keydown", onEscape);
		};
	}, [onClose, toggle]);

	const byEmoji = useMemo(() => new Map(all?.map(e => [e.emoji, e])), [all]);
	const groups = useMemo(() => {
		const list: { id: string; label: string; icon: React.ReactNode; emoji: Emoji[] }[] = [];
		const recentList = recent.map(e => byEmoji.get(e)).filter((e): e is Emoji => !!e);
		if (recentList.length) list.push({ id: "recent", label: "Recently used", icon: <ClockIcon className="size-4.5" />, emoji: recentList });
		for (const g of EMOJI_GROUPS) list.push({ id: String(g.group), label: g.label, icon: g.icon, emoji: all?.filter(e => e.group === g.group) ?? [] });
		return list;
	}, [all, byEmoji, recent]);
	const results = useMemo(() => (query.trim() && all ? searchEmoji(query) : null), [query, all]);

	const pick = (e: Emoji, keepOpen: boolean) => {
		onPick(e.emoji);
		if (keepOpen) return;
		onClose();
		onDone();
	};

	const width = Math.min(PICKER_W, window.innerWidth - 16);
	const left = Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8));
	const placement = anchor.top > PICKER_H + 8 ? { bottom: window.innerHeight - anchor.top + 6 } : { top: anchor.bottom + 6 };

	const grid = (list: Emoji[]) => (
		<div className="grid grid-cols-8">
			{list.map(e => (
				<button
					key={e.emoji}
					type="button"
					// The emoji's shortcode (or name): a data value.
					title={label(e, query)}
					className="flex aspect-square items-center justify-center rounded-lg text-2xl leading-none cursor-pointer hover:bg-[#8882]"
					onMouseEnter={() => setHovered(e)}
					onClick={ev => pick(e, ev.shiftKey)}
				>
					{e.emoji}
				</button>
			))}
		</div>
	);

	return createPortal(
		<div ref={panel} role="dialog" className="fixed z-50 flex flex-col rounded-xl text-(--text-primary) bg-(--secondary) inset-shadow-(--inset-shadow-primary) shadow-lg overflow-hidden" style={{ left, width, height: PICKER_H, ...placement }}>
			<div className="flex flex-col gap-2 p-2 pb-1">
				{/* What the user searches for: a form value. */}
				<input
					ref={searchRef}
					{...searchAttrs}
					// biome-ignore lint/a11y/noAutofocus: the picker was opened to type in it.
					autoFocus
					value={query}
					onChange={e => setQuery(e.target.value)}
					onKeyDown={e => {
						if (e.key !== "Enter" || !results?.[0]) return;
						// Otherwise the Enter would go on into the comment box, which has the focus again.
						e.preventDefault();
						pick(results[0], e.shiftKey);
					}}
					className="w-full rounded-lg px-2.5 py-1.5 text-sm bg-[#8881] outline-none inset-shadow-[0_0_0_1.5px_#8882] focus:inset-shadow-[0_0_0_1.5px_var(--accent)]"
				/>
				{!results && (
					<div className="flex justify-between">
						{groups.map(g => (
							<PickerTab
								key={g.id}
								label={g.label}
								icon={g.icon}
								active={active === g.id}
								onClick={() => {
									const section = sections.current[g.id];
									// The scroller is the sections' offset parent.
									if (section && scroller.current) scroller.current.scrollTop = section.offsetTop;
									setActive(g.id);
								}}
							/>
						))}
					</div>
				)}
			</div>
			<div
				ref={scroller}
				className="relative min-h-0 flex-1 overflow-y-auto px-2"
				onScroll={e => {
					const top = e.currentTarget.scrollTop + 8;
					const current = groups.filter(g => (sections.current[g.id]?.offsetTop ?? Number.POSITIVE_INFINITY) <= top).pop();
					if (current && current.id !== active) setActive(current.id);
				}}
			>
				{!all ? (
					<div className="grid grid-cols-8 gap-1 pt-1" aria-hidden="true">
						{SKELETON.map(i => (
							<span key={i} className="aspect-square rounded-lg bg-[#8881] animate-pulse" />
						))}
					</div>
				) : results ? (
					results.length ? (
						grid(results)
					) : (
						<HolyText as="p" className="py-6 text-center text-sm text-(--text-tertiary)" text="No emoji found." />
					)
				) : (
					groups.map(g => (
						<section
							key={g.id}
							ref={el => {
								sections.current[g.id] = el;
							}}
							className="pb-2"
						>
							<HolyText as="h4" className="sticky top-0 z-10 bg-(--secondary) py-1 text-xs font-semibold text-(--text-secondary)" text={g.label} />
							{grid(g.emoji)}
						</section>
					))
				)}
			</div>
			<div className="flex h-11 shrink-0 items-center gap-2 border-t border-[#8882] px-3">
				{hovered ? (
					<>
						<span className="text-2xl leading-none">{hovered.emoji}</span>
						{/* The emoji's shortcode and name: data values. */}
						<span className="min-w-0 truncate text-sm font-semibold">{label(hovered, query)}</span>
					</>
				) : (
					<HolyText className="truncate text-xs text-(--text-tertiary)" text="Tip: type :name: in a comment, like :sob:" />
				)}
			</div>
		</div>,
		portalTarget(),
	);
};

const PickerTab = ({ label, icon, active, onClick }: { label: string; icon: React.ReactNode; active: boolean; onClick: () => void }) => {
	const { ref, placeholder } = useHolyAttr({ title: label, "aria-label": label });
	return (
		<button ref={ref} {...placeholder} type="button" className={`flex size-7 items-center justify-center rounded-lg text-base leading-none cursor-pointer duration-150 ${active ? "bg-(--accent)/20 text-(--accent)" : "text-(--text-secondary) opacity-70 hover:opacity-100"}`} onClick={onClick}>
			{icon}
		</button>
	);
};
