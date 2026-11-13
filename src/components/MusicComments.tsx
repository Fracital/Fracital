import { HeartIcon as HeartOutlineIcon } from "@heroicons/react/24/outline";
import { BarsArrowDownIcon, ChatBubbleOvalLeftIcon, CheckIcon, ChevronDownIcon, EllipsisHorizontalIcon, FlagIcon, HeartIcon, PencilIcon, TrashIcon, UserCircleIcon, UserMinusIcon, UserPlusIcon, XMarkIcon } from "@heroicons/react/24/solid";
import { createId } from "@paralleldrive/cuid2";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { splitArtistCredit } from "../libs/artistCredit";
import { type CommentFilter, type CommentListOptions, type CommentPage, type CommentSort, type CommentTarget, commentAge, comments, type MusicComment } from "../libs/comments";
import { replaceShortcodes } from "../libs/emoji";
import { useHolyAttr } from "../libs/holy-attr";
import { seek } from "../libs/playback";
import { openProfileCard } from "../libs/profiles";
import { useTabsStore } from "../store";
import type { Track } from "../types";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { HolyText } from "./common/HolyText";
import { EmojiTextarea } from "./EmojiTextarea";

const COMMENT_MAX = 500;

/** The song's main artist, which comments are keyed by along with the title (or album name). */
const mainArtist = (track: Track) => (Array.isArray(track.artists) ? track.artists[0] : track.artists) ?? "";

const SORTS: { id: CommentSort; label: string; signedIn?: boolean }[] = [
	{ id: "newest", label: "Newest" },
	{ id: "oldest", label: "Oldest" },
	{ id: "top", label: "Top" },
	{ id: "relevant", label: "Relevant" },
	{ id: "friends", label: "Friends first", signedIn: true },
];

/** Who a comment is by, for the "by a person" filter. */
type Author = MusicComment["user"];
const authorName = (user: Author) => (user.username ? `@${user.username}` : user.name);

/** Splits text at song times ("1:23", "12:05") so they can be tapped to jump there. */
const TIME = /\b(\d{1,2}):([0-5]\d)\b/g;
const CommentText = ({ text, seekable }: { text: string; seekable: boolean }) => {
	if (!seekable) return <>{text}</>;
	// Each piece is keyed by where it starts in the text.
	const parts: React.ReactNode[] = [];
	let last = 0;
	for (const match of text.matchAll(TIME)) {
		const at = match.index ?? 0;
		parts.push(<Fragment key={`t${last}`}>{text.slice(last, at)}</Fragment>);
		const seconds = Number(match[1]) * 60 + Number(match[2]);
		parts.push(
			<button key={`s${at}`} type="button" className="font-semibold text-(--accent) hover:underline cursor-pointer" onClick={() => seek(seconds)}>
				{match[0]}
			</button>,
		);
		last = at + match[0].length;
	}
	parts.push(<Fragment key={`t${last}`}>{text.slice(last)}</Fragment>);
	return <>{parts}</>;
};

/** The typed text with its song times (1:23) in the accent color, drawn under a comment box that only shows the caret. */
const TimeMirror = ({ text }: { text: string }) => {
	const parts: React.ReactNode[] = [];
	let last = 0;
	for (const match of text.matchAll(TIME)) {
		const at = match.index ?? 0;
		parts.push(text.slice(last, at));
		// Color only: a bolder time would be wider than the text the caret moves through.
		parts.push(
			<span key={at} className="text-(--accent)">
				{match[0]}
			</span>,
		);
		last = at + match[0].length;
	}
	// The trailing space keeps a last empty line as tall as the box's.
	parts.push(`${text.slice(last)} `);
	return <>{parts}</>;
};

interface TimeFieldProps extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> {
	value: string;
	onValueChange: (value: string) => void;
	/** Song comments color their times as they're typed; an album's don't (they don't jump anywhere). */
	highlight: boolean;
	fieldRef: (el: HTMLTextAreaElement | null) => void;
	/** The box: background, padding, rounding, ring. The copy underneath gets the same padding. */
	boxClassName: string;
	pad: string;
}

/**
 * A comment box, with the emoji keyboard and :shortcodes: (the smiley sits in its right padding). With `highlight`,
 * a copy of the text sits under the (see-through) box with its times in the accent color.
 */
const TimeField = ({ value, onValueChange, highlight, fieldRef, boxClassName, pad, className = "", onScroll, ...props }: TimeFieldProps) => {
	const mirrorRef = useRef<HTMLDivElement>(null);
	if (!highlight) return <EmojiTextarea inputRef={fieldRef} value={value} onValueChange={onValueChange} className={`${boxClassName} ${pad} pr-9 ${className}`} onScroll={onScroll} {...props} />;
	return (
		<div className={`relative ${boxClassName}`}>
			<div ref={mirrorRef} aria-hidden="true" className={`pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words text-(--text-primary) ${pad} pr-9 ${className}`}>
				<TimeMirror text={value} />
			</div>
			<EmojiTextarea
				inputRef={fieldRef}
				value={value}
				onValueChange={onValueChange}
				className={`relative block w-full resize-none bg-transparent text-transparent caret-(--text-primary) outline-none placeholder:text-(--text-tertiary) [scrollbar-width:none] ${pad} pr-9 ${className}`}
				onScroll={e => {
					if (mirrorRef.current) mirrorRef.current.scrollTop = e.currentTarget.scrollTop;
					onScroll?.(e);
				}}
				{...props}
			/>
		</div>
	);
};

/** What the comments are on: the song playing (in the players), or an album (on its page). */
type CommentsOn = { track: Track; album?: never } | { album: { title: string; artist: string }; track?: never };

/** Comments on a song, under the players' controls, or on an album, on its page. */
export const MusicComments = ({ track, album, dark }: CommentsOn & { dark: boolean }) => {
	const kind: "song" | "album" = album ? "album" : "song";
	const [page, setPage] = useState<CommentPage | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [draft, setDraft] = useState("");
	const [busy, setBusy] = useState(false);
	const [sort, setSort] = useState<CommentSort>("newest");
	const [filter, setFilter] = useState<CommentFilter | undefined>();
	const [by, setBy] = useState<Author | null>(null);
	const [sortMenu, setSortMenu] = useState<{ x: number; y: number } | null>(null);
	/** A different order or filter is loading: the old list stays, dimmed. */
	const [loading, setLoading] = useState(false);
	/** Only the newest request's answer is shown. */
	const request = useRef(0);
	// An album's comments are keyed by its first artist, as a song's are by its main one.
	const artist = album ? (splitArtistCredit(album.artist)[0] ?? album.artist) : mainArtist(track);
	const name = album ? album.title : track.title;
	const target = useMemo<CommentTarget | null>(() => (artist && name ? { kind, name, artist } : null), [kind, name, artist]);
	// Times only jump within a song, so that filter is the song's.
	const activeFilter = filter === "timestamps" && kind !== "song" ? undefined : filter;
	const options = useMemo<CommentListOptions>(() => ({ sort, filter: activeFilter, by: by?.id }), [sort, activeFilter, by?.id]);
	const { ref: sortRef, placeholder: sortAttrs } = useHolyAttr({ title: "Sort comments", "aria-label": "Sort comments" });
	const { ref: draftRef, placeholder: draftAttrs } = useHolyAttr({ placeholder: kind === "song" ? "Say something about this song" : "Say something about this album", "aria-label": "Your comment" });

	// Another song or album starts with an empty box and no "by" filter.
	// biome-ignore lint/correctness/useExhaustiveDependencies: resets when the song or album changes.
	useEffect(() => {
		setDraft("");
		setBy(null);
	}, [name, artist]);

	const load = useCallback(async () => {
		if (!target) return;
		const mine = ++request.current;
		setError(null);
		setLoading(true);
		try {
			const next = await comments.list(target, options);
			if (mine === request.current) setPage(next);
		} catch (e) {
			if (mine !== request.current) return;
			setPage(null);
			setError((e as Error).message);
		} finally {
			if (mine === request.current) setLoading(false);
		}
	}, [target, options]);

	// Another song or album starts from the skeleton; another order or filter keeps the list until it's replaced.
	// biome-ignore lint/correctness/useExhaustiveDependencies: clears when the target changes.
	useEffect(() => setPage(null), [target]);

	useEffect(() => {
		void load();
		window.addEventListener("account-upd", load);
		return () => window.removeEventListener("account-upd", load);
	}, [load]);

	// Signed out: "mine" and "friends first" mean nothing, so they go back to the defaults.
	const signedIn = page?.viewer.signedIn;
	useEffect(() => {
		if (signedIn !== false) return;
		setFilter(f => (f === "mine" ? undefined : f));
		setSort(s => (SORTS.find(o => o.id === s)?.signedIn ? "newest" : s));
	}, [signedIn]);

	if (!target) return null;

	const post = async () => {
		// A ":shortcode:" left as typed (pasted, or sent before the emoji loaded) goes out as its emoji.
		const body = replaceShortcodes(draft).trim();
		if (!body || busy) return;
		setBusy(true);
		setError(null);
		try {
			const { comment } = await comments.post(target, body);
			setDraft("");
			setPage(prev => (prev ? { ...prev, comments: [comment, ...prev.comments], total: prev.total + 1 } : prev));
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setBusy(false);
		}
	};

	const replace = (comment: MusicComment) => setPage(prev => (prev ? { ...prev, comments: prev.comments.map(c => (c.id === comment.id ? comment : c)) } : prev));
	const drop = (id: number) => setPage(prev => (prev ? { ...prev, comments: prev.comments.filter(c => c.id !== id), total: Math.max(0, prev.total - 1) } : prev));
	const more = async () => {
		if (!page || !target) return;
		const mine = request.current;
		try {
			const next = await comments.list(target, options, page.comments.length);
			if (mine !== request.current) return;
			// A post or delete since shifts the pages by one, so a comment can come twice.
			setPage(prev => (prev ? { ...next, comments: [...prev.comments, ...next.comments.filter(c => !prev.comments.some(p => p.id === c.id))] } : next));
		} catch (e) {
			setError((e as Error).message);
		}
	};
	/** Following someone changes it on every comment of theirs. */
	const followed = (userId: string, following: boolean) => setPage(prev => (prev ? { ...prev, comments: prev.comments.map(c => (c.user.id === userId ? { ...c, followed: following } : c)) } : prev));
	const signIn = () => useTabsStore.getState().newTab({ id: createId(), url: "about:account", displayUrl: "about:account", title: "Fracital Account", icon: null, current: true });
	const chip = (on: boolean) =>
		`px-3 py-1 rounded-full text-xs font-semibold cursor-pointer duration-150 ${on ? (dark ? "bg-white text-black" : "bg-black text-white") : dark ? "bg-[#ffffff12] text-(--text-secondary) hover:text-(--text-primary)" : "bg-[#0000000f] text-(--text-secondary) hover:text-(--text-primary)"}`;

	return (
		<section className="flex w-full flex-col gap-2.5 text-left">
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-1.5">
					<ChatBubbleOvalLeftIcon className="size-5 text-(--text-secondary)" />
					<HolyText as="h3" className="font-bold" text="Comments" />
					{/* The count: a data value. */}
					{page && page.total > 0 && <span className="text-sm font-semibold text-(--text-tertiary)">{page.total.toLocaleString()}</span>}
				</div>
			</div>

			<div className="flex flex-wrap items-center gap-1.5">
				<button
					ref={sortRef}
					{...sortAttrs}
					type="button"
					aria-haspopup="menu"
					className={`${chip(false)} flex items-center gap-1`}
					onClick={e => {
						const r = e.currentTarget.getBoundingClientRect();
						setSortMenu({ x: r.left, y: r.bottom + 4 });
					}}
				>
					<BarsArrowDownIcon className="size-3.5" />
					<HolyText text={SORTS.find(o => o.id === sort)?.label ?? "Newest"} />
					<ChevronDownIcon className="size-3" />
				</button>
				{page?.viewer.signedIn && (
					<button type="button" aria-pressed={activeFilter === "mine"} className={chip(activeFilter === "mine")} onClick={() => setFilter(f => (f === "mine" ? undefined : "mine"))}>
						<HolyText text="Mine" />
					</button>
				)}
				<button type="button" aria-pressed={activeFilter === "artist"} className={chip(activeFilter === "artist")} onClick={() => setFilter(f => (f === "artist" ? undefined : "artist"))}>
					<HolyText text="Artist" />
				</button>
				{kind === "song" && (
					<button type="button" aria-pressed={activeFilter === "timestamps"} className={chip(activeFilter === "timestamps")} onClick={() => setFilter(f => (f === "timestamps" ? undefined : "timestamps"))}>
						<HolyText text="Timestamps" />
					</button>
				)}
				{by && (
					<button type="button" className={`${chip(true)} flex min-w-0 items-center gap-1`} onClick={() => setBy(null)}>
						<HolyText className="shrink-0" text="By" />
						{/* The person's name: a data value. */}
						<span className="truncate">{authorName(by)}</span>
						<XMarkIcon className="size-3.5 shrink-0" />
					</button>
				)}
			</div>
			{sortMenu && (
				<ContextMenu
					items={SORTS.filter(o => !o.signedIn || page?.viewer.signedIn).map(o => ({
						title: <HolyText text={o.label} />,
						icon: o.id === sort ? <CheckIcon className="size-4.5" /> : <span className="size-4.5" />,
						onClick: () => setSort(o.id),
					}))}
					position={sortMenu}
					onClose={() => setSortMenu(null)}
				/>
			)}

			{page?.viewer.signedIn ? (
				<form
					className="flex flex-col gap-1.5"
					onSubmit={e => {
						e.preventDefault();
						void post();
					}}
				>
					{/* What the user types: a form value. */}
					<TimeField
						fieldRef={draftRef}
						{...draftAttrs}
						highlight={kind === "song"}
						rows={draft ? 3 : 1}
						maxLength={COMMENT_MAX}
						value={draft}
						onValueChange={setDraft}
						onKeyDown={e => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								void post();
							}
						}}
						boxClassName={`w-full resize-none rounded-xl outline-none inset-shadow-[0_0_0_1.5px_#ffffff18] focus-within:inset-shadow-[0_0_0_1.5px_var(--accent)] focus:inset-shadow-[0_0_0_1.5px_var(--accent)] duration-150 ${dark ? "bg-[#ffffff0d]" : "bg-[#0000000a]"}`}
						pad="px-3 py-2"
						className="text-sm text-(--text-primary)"
					/>
					{draft && (
						<div className="flex items-center justify-end gap-2">
							{/* Characters left: a data value. */}
							{draft.length > COMMENT_MAX - 100 && <span className="text-xs text-(--text-tertiary)">{COMMENT_MAX - draft.length}</span>}
							<button type="button" className="px-3 py-1 rounded-full text-xs font-semibold text-(--text-secondary) hover:text-(--text-primary) cursor-pointer" onClick={() => setDraft("")}>
								<HolyText text="Cancel" />
							</button>
							<button type="submit" disabled={busy || !draft.trim()} className="px-3 py-1 rounded-full text-xs font-semibold bg-(--accent) text-white cursor-pointer disabled:opacity-40 disabled:cursor-default">
								<HolyText text="Post" />
							</button>
						</div>
					)}
				</form>
			) : (
				page && (
					<button type="button" className={`w-full rounded-xl px-3 py-2 text-sm font-semibold text-(--text-secondary) hover:text-(--text-primary) cursor-pointer duration-150 ${dark ? "bg-[#ffffff0d]" : "bg-[#0000000a]"}`} onClick={signIn}>
						<HolyText text="Sign in to comment" />
					</button>
				)
			)}

			{/* The server's message (rate limit, too long, sign-in expired…): a data value. */}
			{error && <p className="text-xs font-medium text-red-400">{error}</p>}

			{!page && !error && (
				<div className="flex flex-col gap-3" aria-hidden="true">
					{[0, 1, 2].map(i => (
						<div key={i} className="flex gap-2">
							<span className={`size-7 shrink-0 rounded-full animate-pulse ${dark ? "bg-[#ffffff12]" : "bg-[#0000000f]"}`} />
							<span className={`h-9 flex-1 rounded-lg animate-pulse ${dark ? "bg-[#ffffff0d]" : "bg-[#0000000a]"}`} />
						</div>
					))}
				</div>
			)}

			{page && page.comments.length === 0 && <HolyText as="p" className="py-2 text-center text-sm text-(--text-tertiary)" text={activeFilter || by ? "No comments match." : kind === "song" ? "No comments on this song yet." : "No comments on this album yet."} />}

			{page && page.comments.length > 0 && (
				<ul className={`flex flex-col gap-3 duration-150 ${loading ? "opacity-50" : ""}`}>
					{page.comments.map(comment => (
						<CommentItem key={comment.id} comment={comment} seekable={kind === "song"} signedIn={page.viewer.signedIn} dark={dark} onEdited={replace} onDeleted={drop} onAuthor={setBy} onFollowed={followed} onSignIn={signIn} />
					))}
				</ul>
			)}

			{page?.more && (
				<button type="button" className="self-center px-3 py-1 rounded-full text-xs font-semibold text-(--text-secondary) hover:text-(--text-primary) cursor-pointer" onClick={() => void more()}>
					<HolyText text="Show more" />
				</button>
			)}
		</section>
	);
};

interface CommentItemProps {
	comment: MusicComment;
	seekable: boolean;
	signedIn: boolean;
	dark: boolean;
	onEdited: (comment: MusicComment) => void;
	onDeleted: (id: number) => void;
	/** Show only this person's comments. */
	onAuthor: (user: Author) => void;
	onFollowed: (userId: string, following: boolean) => void;
	onSignIn: () => void;
}

const CommentItem = ({ comment, seekable, signedIn, dark, onEdited, onDeleted, onAuthor, onFollowed, onSignIn }: CommentItemProps) => {
	/** The like, shown at once and put back if the server refuses it. */
	const [like, setLike] = useState({ liked: comment.liked, likes: comment.likes });
	useEffect(() => setLike({ liked: comment.liked, likes: comment.likes }), [comment.liked, comment.likes]);
	const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
	const [editing, setEditing] = useState<string | null>(null);
	/** After a report, or when the server refused something (its message). */
	const [note, setNote] = useState<{ reported: true } | { error: string } | null>(null);
	const editRef = useRef<HTMLTextAreaElement>(null);
	const { ref: menuRef, placeholder: menuAttrs } = useHolyAttr({ title: "Comment options", "aria-label": "Comment options" });
	const { ref: editAttrRef, placeholder: editAttrs } = useHolyAttr({ "aria-label": "Edit your comment" });
	const { ref: likeRef, placeholder: likeAttrs } = useHolyAttr({ title: like.liked ? "Unlike" : "Like", "aria-label": like.liked ? "Unlike" : "Like" });
	const { ref: authorRef, placeholder: authorAttrs } = useHolyAttr({ title: "View profile" });
	const { ref: avatarRef, placeholder: avatarAttrs } = useHolyAttr({ title: "View profile", "aria-label": "View profile" });
	/** Their profile card, which can also narrow the list to their comments. */
	const showProfile = (e: React.MouseEvent<HTMLElement>) => openProfileCard(comment.user, e.currentTarget, [{ label: "Show only their comments here", onClick: () => onAuthor(comment.user) }]);

	const toggleLike = () => {
		if (!signedIn) return onSignIn();
		const before = like;
		const liked = !before.liked;
		setLike({ liked, likes: Math.max(0, before.likes + (liked ? 1 : -1)) });
		comments.like(comment.id, liked).then(
			() => onEdited({ ...comment, liked, likes: Math.max(0, before.likes + (liked ? 1 : -1)) }),
			(e: Error) => {
				setLike(before);
				setNote({ error: e.message });
			},
		);
	};

	const isEditing = editing !== null;
	useEffect(() => {
		if (isEditing) editRef.current?.focus();
	}, [isEditing]);

	const save = async () => {
		const body = editing === null ? "" : replaceShortcodes(editing).trim();
		if (!body) return;
		try {
			onEdited((await comments.edit(comment.id, body)).comment);
			setEditing(null);
		} catch (e) {
			setNote({ error: (e as Error).message });
		}
	};

	const items: MenuItem[] = [];
	if (comment.mine) items.push({ title: <HolyText text="Edit" />, icon: <PencilIcon className="size-4.5" />, onClick: () => setEditing(comment.body) });
	if (comment.canDelete)
		items.push({
			title: <HolyText text="Delete" />,
			icon: <TrashIcon className="size-4.5" />,
			onClick: () =>
				void comments.remove(comment.id).then(
					() => onDeleted(comment.id),
					(e: Error) => setNote({ error: e.message }),
				),
		});
	if (signedIn && !comment.mine)
		items.push({
			title: <HolyText text={comment.followed ? "Unfollow" : "Follow"} />,
			icon: comment.followed ? <UserMinusIcon className="size-4.5" /> : <UserPlusIcon className="size-4.5" />,
			onClick: () =>
				void comments.follow(comment.user.id, !comment.followed).then(
					() => onFollowed(comment.user.id, !comment.followed),
					(e: Error) => setNote({ error: e.message }),
				),
		});
	if (signedIn && !comment.mine)
		items.push({
			title: <HolyText text="Report" />,
			icon: <FlagIcon className="size-4.5" />,
			onClick: () =>
				void comments.report(comment.id).then(
					() => setNote({ reported: true }),
					(e: Error) => setNote({ error: e.message }),
				),
		});

	return (
		<li className="group/comment flex gap-2">
			<button ref={avatarRef} {...avatarAttrs} type="button" className="h-fit shrink-0 rounded-full cursor-pointer hover:brightness-110" onClick={showProfile}>
				{comment.user.image ? <img src={comment.user.image} alt="" className="size-7 rounded-full object-cover" /> : <UserCircleIcon className="size-7 text-(--text-tertiary)" />}
			</button>
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<div className="flex items-center gap-1.5 text-xs">
					{/* The author's name and when they wrote it: data values. */}
					<button ref={authorRef} {...authorAttrs} type="button" className="truncate font-semibold text-(--text-primary) hover:underline cursor-pointer" onClick={showProfile}>
						{authorName(comment.user)}
					</button>
					{comment.byArtist && <HolyText className="shrink-0 rounded-full bg-(--accent) px-1.5 text-[10px] font-bold leading-4 text-white" text="Artist" />}
					<span className="shrink-0 text-(--text-tertiary)" title={new Date(comment.editedAt ?? comment.at).toLocaleString()}>
						{commentAge(comment.at)}
					</span>
					{comment.editedAt && <HolyText className="shrink-0 text-(--text-tertiary)" text="(edited)" />}
					{items.length > 0 && (
						<button
							ref={menuRef}
							{...menuAttrs}
							type="button"
							aria-haspopup="menu"
							className={`ml-auto shrink-0 rounded-full text-(--text-tertiary) hover:text-(--text-primary) cursor-pointer duration-150 ${menu ? "opacity-100" : "opacity-0 group-hover/comment:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"}`}
							onClick={e => {
								const r = e.currentTarget.getBoundingClientRect();
								setMenu({ x: r.right, y: r.bottom + 4 });
							}}
						>
							<EllipsisHorizontalIcon className="size-4.5" />
						</button>
					)}
				</div>
				{editing !== null ? (
					<div className="flex flex-col gap-1.5">
						{/* What the user types: a form value. */}
						<TimeField
							fieldRef={el => {
								editRef.current = el;
								editAttrRef(el);
							}}
							{...editAttrs}
							highlight={seekable}
							rows={3}
							maxLength={COMMENT_MAX}
							value={editing}
							onValueChange={setEditing}
							onKeyDown={e => {
								if (e.key === "Enter" && !e.shiftKey) {
									e.preventDefault();
									void save();
								} else if (e.key === "Escape") setEditing(null);
							}}
							boxClassName={`w-full resize-none rounded-lg outline-none inset-shadow-[0_0_0_1.5px_var(--accent)] ${dark ? "bg-[#ffffff0d]" : "bg-[#0000000a]"}`}
							pad="px-2.5 py-1.5"
							className="text-sm text-(--text-primary)"
						/>
						<div className="flex justify-end gap-2">
							<button type="button" className="px-2.5 py-0.5 rounded-full text-xs font-semibold text-(--text-secondary) hover:text-(--text-primary) cursor-pointer" onClick={() => setEditing(null)}>
								<HolyText text="Cancel" />
							</button>
							<button type="button" disabled={!editing.trim()} className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-(--accent) text-white cursor-pointer disabled:opacity-40" onClick={() => void save()}>
								<HolyText text="Save" />
							</button>
						</div>
					</div>
				) : (
					// The comment itself: user content (a data value).
					<p className="whitespace-pre-wrap break-words text-sm text-(--text-secondary)">
						<CommentText text={comment.body} seekable={seekable} />
					</p>
				)}
				<button ref={likeRef} {...likeAttrs} type="button" aria-pressed={like.liked} className={`flex w-fit items-center gap-1 text-xs font-semibold cursor-pointer duration-150 ${like.liked ? "text-(--accent)" : "text-(--text-tertiary) hover:text-(--text-primary)"}`} onClick={toggleLike}>
					{like.liked ? <HeartIcon className="size-3.5" /> : <HeartOutlineIcon className="size-3.5" />}
					{/* The count: a data value. */}
					{like.likes > 0 && <span>{like.likes.toLocaleString()}</span>}
				</button>
				{note && "reported" in note && <HolyText as="p" className="text-xs text-(--text-tertiary)" text="Reported. Thanks, an admin will take a look." />}
				{/* The server's message: a data value. */}
				{note && "error" in note && <p className="text-xs text-red-400">{note.error}</p>}
			</div>
			{menu && <ContextMenu items={items} position={menu} align="end" onClose={() => setMenu(null)} />}
		</li>
	);
};
