/**
 * The omnibox: suggestions under an address or search box, for the top bar (Search.tsx) and the new tab page
 * (Home.tsx). useOmniBox gives the input its combobox props and key handling and returns the dropdown to render;
 * the box keeps its own markup. Arrows move, Enter opens, Tab fills the box, Escape closes; hovering highlights.
 */
import { GlobeAltIcon, MagnifyingGlassIcon, MusicalNoteIcon, PuzzlePieceIcon, Squares2X2Icon, UserCircleIcon } from "@heroicons/react/24/solid";
import { type KeyboardEvent, type ReactNode, type RefObject, useCallback, useEffect, useId, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { portalTarget } from "../libs/cloak";
import type { GroupKey, Suggestion } from "../libs/omni/rank";
import { engineName } from "../libs/omni/sources";
import { useOmniSuggestions } from "../libs/omni/useOmniSuggestions";
import { useHoldBar } from "./CollapsibleBar";
import { HolyDynamic, HolyRich } from "./common/HolyRich";
import { HolyText } from "./common/HolyText";

export interface OmniTarget {
	url: string;
	displayUrl: string;
	title: string;
	icon: string | ReactNode | null;
}

export interface UseOmniBoxOptions {
	inputRef: RefObject<HTMLInputElement | null>;
	/** The box the dropdown hangs under. */
	anchorRef: RefObject<HTMLElement | null>;
	query: string;
	/** The box has focus (and, in the top bar, belongs to the tab on screen). */
	enabled: boolean;
	onNavigate: (target: OmniTarget) => void;
	/** Tab pressed on a row: put its text in the box. */
	onFill: (text: string) => void;
	/** Enter with no row highlighted: what the box did before it had suggestions. */
	onSubmitPlain: (text: string) => void;
}

const HEADERS: Partial<Record<GroupKey, string>> = { tab: "Open tabs", url: "Sites", page: "Pages", game: "Games", song: "Songs", artist: "Artists", completion: "Search suggestions", jump: "Jump back in", top: "Top sites" };
const HINTS: Record<Suggestion["kind"], string> = { tab: "Switch to tab", url: "Open", page: "Open", game: "Play", song: "Play", artist: "Open", search: "Search", completion: "Search" };
const MIN_WIDTH = 360;

const KindIcon = ({ row }: { row: Suggestion }) => {
	const cls = "size-5 shrink-0 text-(--text-tertiary)";
	if (row.icon && typeof row.icon !== "string") return <span className="flex size-5 shrink-0 items-center justify-center [&>svg]:size-5">{row.icon}</span>;
	if (typeof row.icon === "string" && row.icon) return <img src={row.icon} alt="" aria-hidden className={`size-5 shrink-0 rounded ${row.kind === "song" || row.kind === "game" || row.kind === "artist" ? "object-cover" : ""}`} onError={e => (e.currentTarget.style.visibility = "hidden")} />;
	switch (row.kind) {
		case "game":
			return <PuzzlePieceIcon className={cls} />;
		case "song":
			return <MusicalNoteIcon className={cls} />;
		case "artist":
			return <UserCircleIcon className={cls} />;
		case "tab":
			return <Squares2X2Icon className={cls} />;
		case "search":
		case "completion":
			return <MagnifyingGlassIcon className={cls} />;
		default:
			return <GlobeAltIcon className={cls} />;
	}
};

export function useOmniBox({ inputRef, anchorRef, query, enabled, onNavigate, onFill, onSubmitPlain }: UseOmniBoxOptions) {
	const listId = useId();
	const { ranked, loading } = useOmniSuggestions(query, enabled);
	const rows = ranked.rows;
	const [index, setIndex] = useState(-1);
	const [closed, setClosed] = useState(false);
	const open = enabled && !closed && rows.length > 0;
	useHoldBar(open);

	// New text or a new focus: nothing highlighted, list showing again.
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs on each change of the query or the focus on purpose
	useEffect(() => {
		setIndex(-1);
		setClosed(false);
	}, [query, enabled]);
	useEffect(() => {
		if (index >= rows.length) setIndex(-1);
	}, [rows.length, index]);

	const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-measured when the row count changes the box's height
	useLayoutEffect(() => {
		if (!open) return;
		const place = () => {
			const r = anchorRef.current?.getBoundingClientRect();
			if (!r) return;
			const width = Math.min(Math.max(r.width, MIN_WIDTH), window.innerWidth - 16);
			setRect({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), width });
		};
		place();
		window.addEventListener("resize", place);
		return () => window.removeEventListener("resize", place);
	}, [open, rows.length, anchorRef]);

	const pick = useCallback(
		(row: Suggestion) => {
			setClosed(true);
			if (row.run) row.run();
			else if (row.url) onNavigate({ url: row.url, displayUrl: row.displayUrl ?? row.url, title: row.title, icon: row.icon ?? null });
			inputRef.current?.blur();
		},
		[onNavigate, inputRef],
	);

	const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter") {
			e.preventDefault();
			if (open && index >= 0 && rows[index]) pick(rows[index]);
			else onSubmitPlain(query);
			return;
		}
		if (!open) return;
		const move = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
		if (move) {
			e.preventDefault();
			// -1 is "nothing": down from it goes to the first row, up to the last.
			setIndex(i => (i + move < -1 ? rows.length - 1 : i + move >= rows.length ? -1 : i + move));
			return;
		}
		if (e.key === "Tab" && !e.shiftKey && index >= 0 && rows[index]) {
			e.preventDefault();
			onFill(rows[index].fill ?? rows[index].url ?? rows[index].title);
			return;
		}
		if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			setClosed(true);
		}
	};

	const inputProps = {
		role: "combobox",
		"aria-autocomplete": "list" as const,
		"aria-expanded": open,
		"aria-controls": listId,
		"aria-activedescendant": open && index >= 0 && rows[index] ? `${listId}-${rows[index].id}` : undefined,
		autoComplete: "off",
		spellCheck: false,
	};

	const dropdown =
		open && rect
			? createPortal(
					// The input is the combobox: it keeps focus and names the highlighted option (aria-activedescendant), so the
					// options themselves take no focus and no keys.
					<div
						id={listId}
						role="listbox"
						aria-busy={loading}
						style={{ top: rect.top, left: rect.left, width: rect.width }}
						className="fixed z-50 flex max-h-[min(70vh,34rem)] flex-col gap-0.5 overflow-y-auto p-1.5 rounded-2xl text-(--text-primary) bg-(--secondary) inset-shadow-(--inset-shadow-primary) shadow-xl"
					>
						{ranked.groups.map(group => (
							// biome-ignore lint/a11y/useSemanticElements: a listbox's groups are plain containers, not fieldsets
							<div key={group.key} role="group" className="flex flex-col gap-0.5">
								{HEADERS[group.key] && <HolyText as="div" className="px-2.5 pt-1.5 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-(--text-tertiary)" text={HEADERS[group.key] as string} />}
								{group.rows.map(row => {
									const i = rows.indexOf(row);
									const active = i === index;
									return (
										// biome-ignore lint/a11y/useKeyWithClickEvents: the combobox input handles the keys for every option
										<div
											key={row.id}
											id={`${listId}-${row.id}`}
											role="option"
											tabIndex={-1}
											aria-selected={active}
											className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-sm cursor-pointer ${active ? "bg-(--accent)/20" : "hover:bg-[#8881]"}`}
											onMouseDown={e => e.preventDefault()}
											onMouseEnter={() => setIndex(i)}
											onClick={() => pick(row)}
										>
											<KindIcon row={row} />
											<span className="flex min-w-0 flex-1 items-baseline gap-2">
												{row.kind === "search" && row.id === "default" ? (
													<HolyRich className="truncate font-medium">
														Search <HolyDynamic>{engineName()}</HolyDynamic> for “<HolyDynamic>{row.title}</HolyDynamic>”
													</HolyRich>
												) : row.kind === "url" && row.id === "default" ? (
													<HolyRich className="truncate font-medium">
														Go to <HolyDynamic>{row.title}</HolyDynamic>
													</HolyRich>
												) : (
													<>
														{/* The site's, song's or game's name: a data value. */}
														<span className="truncate font-medium">{row.title}</span>
														{/* The host or artist: a data value. */}
														{row.subtitle && <span className="truncate text-xs text-(--text-tertiary)">{row.subtitle}</span>}
													</>
												)}
											</span>
											<HolyText className={`shrink-0 text-[11px] ${active ? "text-(--text-secondary)" : "text-(--text-tertiary)"}`} text={HINTS[row.kind]} />
										</div>
									);
								})}
							</div>
						))}
					</div>,
					portalTarget(),
				)
			: null;

	return { inputProps, onKeyDown, dropdown, open };
}
