import { faDiscord } from "@fortawesome/free-brands-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { ChatBubbleOvalLeftIcon, CheckBadgeIcon, ChevronDownIcon, EyeSlashIcon, FireIcon, HeartIcon, LockClosedIcon, MusicalNoteIcon, PencilIcon, PlayIcon, QueueListIcon, SignalIcon, SparklesIcon } from "@heroicons/react/24/solid";
import { createId } from "@paralleldrive/cuid2";
import { useCallback, useEffect, useState } from "react";
import { HolyText } from "../components/common/HolyText";
import { FollowButton, FollowCounts, InterestChip, PROFILE_CHIP, ProfileAvatar, ProfileBanner, SocialLink, useFollow } from "../components/ProfileCard";
import { NameStreak } from "../components/StreakBadge";
import { openLibraryPage } from "../libs/aboutPages";
import { commentAge } from "../libs/comments";
import { trackToFracital } from "../libs/music-service";
import { type ProfileComment, type Profile as ProfileData, type ProfileSection, profiles } from "../libs/profiles";
import { useMusicStore, useTabsStore } from "../store";

const DISCORD_STATUS = {
	online: { label: "Online", color: "#23a55a" },
	idle: { label: "Idle", color: "#f0b232" },
	dnd: { label: "Do Not Disturb", color: "#f23f43" },
	offline: { label: "Offline", color: "#80848e" },
} as const;
const ACTIVITY_VERBS: Record<number, string> = { 0: "Playing", 1: "Streaming", 2: "Listening to", 3: "Watching", 5: "Competing in" };

const card = "flex flex-col gap-3 p-4 rounded-2xl bg-(--tertiary)";

/** A section's heading; on the owner's own profile, hidden sections say so. */
const Heading = ({ icon, title, profile, section, children }: { icon: React.ReactNode; title: string; profile: ProfileData; section: ProfileSection; children?: React.ReactNode }) => (
	<div className="flex items-center gap-2">
		<span className="text-(--text-secondary)">{icon}</span>
		<HolyText as="h2" className="flex-1 font-bold" text={title} />
		{profile.own && (profile.private || profile.hidden?.includes(section)) && (
			<span className="flex items-center gap-1 text-xs font-semibold text-(--text-tertiary)">
				<EyeSlashIcon className="size-3.5" />
				<HolyText text="Only you see this" />
			</span>
		)}
		{children}
	</div>
);

/** Someone's profile: about:user?<username or account id>. */
const Profile = ({ query }: { query?: string }) => {
	const handle = decodeURIComponent(query ?? "").trim();
	const [profile, setProfile] = useState<ProfileData | null>(null);
	const [error, setError] = useState<string | null>(null);
	const follow = useFollow(profile);

	const load = useCallback(() => {
		if (!handle) return setError("No profile to show.");
		setError(null);
		profiles.get(handle).then(setProfile, (e: Error) => setError(e.message));
	}, [handle]);

	useEffect(() => {
		setProfile(null);
		load();
		window.addEventListener("account-upd", load);
		return () => window.removeEventListener("account-upd", load);
	}, [load]);

	// Listening and Discord change while the page is open.
	useEffect(() => {
		if (!profile || !("listening" in profile || "discord" in profile)) return;
		const timer = window.setInterval(() => document.visibilityState === "visible" && profiles.get(handle).then(setProfile, () => undefined), 30_000);
		return () => window.clearInterval(timer);
	}, [profile, handle]);

	if (error)
		return (
			<div className="flex h-full w-full items-center justify-center p-6">
				{/* The server's message: a data value. */}
				<p className="text-(--text-tertiary)">{error}</p>
			</div>
		);

	if (!profile)
		return (
			<div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4" aria-hidden="true">
				<div className="h-96 rounded-2xl bg-(--tertiary) animate-pulse" />
				<div className="h-24 w-1/2 rounded-2xl bg-(--tertiary) animate-pulse" />
			</div>
		);

	const { user } = profile;
	const closed = profile.private && !profile.own;
	const editProfile = () => useTabsStore.getState().newTab({ id: createId(), url: "about:account", displayUrl: "about:account", title: "Fracital Account", icon: null, current: true });

	return (
		<div className="h-full w-full overflow-y-auto @container">
			<div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4">
				{/* The banner fills the whole header and fades into the card under the details. */}
				<header className="relative isolate flex flex-col overflow-hidden rounded-2xl bg-(--tertiary)">
					<ProfileBanner profile={profile} className="absolute inset-0 -z-10 size-full" />
					<div className="absolute inset-0 -z-10" style={{ background: "linear-gradient(to bottom, transparent 30%, color-mix(in srgb, var(--tertiary) 60%, transparent) 62%, var(--tertiary) 84%)" }} />
					<div className="absolute right-4 top-4">
						{profile.own ? (
							<button type="button" className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-semibold bg-black/40 text-white backdrop-blur-md hover:bg-black/55 cursor-pointer duration-150" onClick={editProfile}>
								<PencilIcon className="size-4" />
								<HolyText text="Edit profile" />
							</button>
						) : (
							<FollowButton follow={follow} />
						)}
					</div>
					<div className="flex flex-col gap-3 px-5 pb-5 pt-32 @2xl:px-7 @2xl:pt-52">
						<div className={`flex flex-col gap-4 @xl:flex-row @xl:items-center @2xl:gap-5 ${profile.banner ? "[text-shadow:0_1px_10px_rgb(0_0_0/0.35)]" : ""}`}>
							<ProfileAvatar user={user} className="size-28 @2xl:size-40 shadow-xl" />
							<div className="flex min-w-0 flex-col">
								{/* Their name and handle: data values. */}
								<span className="flex min-w-0 items-center gap-2">
									<h1 className="truncate text-3xl @2xl:text-5xl font-extrabold leading-tight">{user.name}</h1>
									<NameStreak streak={profile.stats?.streak} />
								</span>
								{user.username && <span className="truncate text-xl @2xl:text-3xl font-semibold opacity-90">@{user.username}</span>}
								{/* Their bio: their own words (a data value). */}
								{profile.bio && <p className="mt-0.5 max-w-3xl whitespace-pre-wrap break-words text-base @2xl:text-xl font-semibold text-(--text-secondary)">{profile.bio}</p>}
								{!!profile.artistPages?.length && (
									<div className="mt-2.5 flex flex-wrap gap-2 [text-shadow:none]">
										{profile.artistPages.map(page => (
											<button key={page.artistId} type="button" className={`${PROFILE_CHIP} cursor-pointer hover:bg-(--accent)/30 duration-150`} onClick={() => openLibraryPage(`artistName=${encodeURIComponent(page.name)}`, page.name)}>
												<CheckBadgeIcon className="size-5" />
												<HolyText text="Artist" />
												{/* The artist's name: a data value. */}
												<span>- {page.name}</span>
											</button>
										))}
									</div>
								)}
							</div>
						</div>
						<div className="flex flex-wrap items-center gap-x-5 gap-y-1">
							<FollowCounts followers={follow.followers} following={profile.following} />
							<span className="text-sm text-(--text-tertiary)">
								<HolyText text="Joined" /> {new Date(user.joinedAt).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
							</span>
						</div>
						{(!!profile.interests?.length || !!profile.links?.length) && (
							<div className="flex flex-wrap items-end justify-between gap-3">
								<div className="flex min-w-0 flex-wrap gap-2">
									{profile.interests?.map(interest => (
										<InterestChip key={`${interest.kind}-${interest.name}`} interest={interest} />
									))}
								</div>
								{!!profile.links?.length && (
									<div className="ml-auto flex items-center gap-3">
										{profile.links.map(url => (
											<SocialLink key={url} url={url} className="size-10 @2xl:size-12" />
										))}
									</div>
								)}
							</div>
						)}
					</div>
				</header>

				{closed ? (
					<div className={`${card} items-center py-10 text-center`}>
						<LockClosedIcon className="size-8 text-(--text-tertiary)" />
						<HolyText as="p" className="text-(--text-secondary)" text="This profile is private." />
					</div>
				) : (
					<div className="grid gap-4 @3xl:grid-cols-[minmax(0,1fr)_320px]">
						<div className="flex min-w-0 flex-col gap-4">
							{profile.listening !== undefined && <Listening profile={profile} />}
							{profile.discord !== undefined && <Discord profile={profile} />}
							{profile.comments && <Comments profile={profile} handle={handle} />}
						</div>
						<div className="flex min-w-0 flex-col gap-4">
							{profile.stats && <Stats profile={profile} />}
							{profile.artists && <Artists profile={profile} />}
							{profile.playlists && <Playlists profile={profile} handle={handle} />}
						</div>
					</div>
				)}
			</div>
		</div>
	);
};

const Listening = ({ profile }: { profile: ProfileData }) => {
	const now = profile.listening;
	return (
		<section className={card}>
			<Heading icon={<SignalIcon className="size-5" />} title="Listening now" profile={profile} section="listening" />
			{now ? (
				<button type="button" className="flex items-center gap-3 rounded-xl text-left cursor-pointer hover:bg-[#8881] -m-1.5 p-1.5 duration-150" onClick={() => openLibraryPage(`track=${encodeURIComponent(now.song.title)}&by=${encodeURIComponent(now.song.artist)}`, now.song.title)}>
					{now.song.artwork ? <img src={now.song.artwork} alt="" className="size-14 shrink-0 rounded-lg object-cover" /> : <MusicalNoteIcon className="size-14 shrink-0 rounded-lg bg-[#8882] p-3 text-(--text-tertiary)" />}
					{/* The song: data values. */}
					<span className="flex min-w-0 flex-col">
						<span className="truncate font-semibold">{now.song.title}</span>
						<span className="truncate text-sm text-(--text-secondary)">{now.song.artist}</span>
					</span>
				</button>
			) : (
				<HolyText as="p" className="text-sm text-(--text-tertiary)" text="Not listening to anything right now." />
			)}
		</section>
	);
};

const Discord = ({ profile }: { profile: ProfileData }) => {
	const presence = profile.discord;
	const status = presence ? DISCORD_STATUS[presence.status] : null;
	return (
		<section className={card}>
			<Heading icon={<FontAwesomeIcon icon={faDiscord} className="size-5 text-[#5865f2]" />} title="On Discord" profile={profile} section="discord">
				{status && (
					<span className="flex items-center gap-1.5 text-xs text-(--text-secondary)">
						<span className="size-2.5 rounded-full" style={{ backgroundColor: status.color }} />
						<HolyText text={status.label} />
					</span>
				)}
			</Heading>
			{presence?.activities.length ? (
				<div className="flex flex-col gap-2.5">
					{presence.activities.map(a => (
						<div key={`${a.type}-${a.name}-${a.details ?? ""}`} className="flex min-w-0 items-center gap-3">
							{a.image ? <img src={a.image} alt="" className="size-12 shrink-0 rounded-lg object-cover bg-[#8882]" /> : a.type !== 4 && <div className="size-12 shrink-0 rounded-lg bg-[#8882]" />}
							{/* Activity text is the person's own data, shown as-is. */}
							<div className="flex min-w-0 flex-col text-sm leading-snug">
								{a.type === 4 ? (
									<span className="flex min-w-0 items-center gap-1.5">
										{a.emoji && (a.emoji.startsWith("https://") ? <img src={a.emoji} alt="" className="size-4" /> : <span>{a.emoji}</span>)}
										<span className="truncate">{a.state}</span>
									</span>
								) : (
									<>
										<span className="truncate">
											<HolyText className="text-(--text-tertiary)" text={ACTIVITY_VERBS[a.type] ?? "Playing"} /> <span className="font-semibold">{a.name}</span>
										</span>
										{a.details && <span className="truncate text-(--text-secondary)">{a.details}</span>}
										{a.state && <span className="truncate text-(--text-tertiary)">{a.state}</span>}
									</>
								)}
							</div>
						</div>
					))}
				</div>
			) : (
				<HolyText as="p" className="text-sm text-(--text-tertiary)" text={presence ? "Nothing going on right now." : "Not on Discord right now."} />
			)}
		</section>
	);
};

const Comments = ({ profile, handle }: { profile: ProfileData; handle: string }) => {
	const [list, setList] = useState<ProfileComment[] | null>(null);
	const [more, setMore] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		setList(null);
		profiles.comments(handle).then(
			page => {
				setList(page.comments);
				setMore(page.more);
			},
			(e: Error) => setError(e.message),
		);
	}, [handle]);

	const loadMore = () =>
		profiles.comments(handle, list?.length ?? 0).then(
			page => {
				setList(prev => [...(prev ?? []), ...page.comments.filter(c => !prev?.some(p => p.id === c.id))]);
				setMore(page.more);
			},
			(e: Error) => setError(e.message),
		);

	const open = (c: ProfileComment) => (c.on.kind === "song" ? openLibraryPage(`track=${encodeURIComponent(c.on.name)}&by=${encodeURIComponent(c.on.artist)}`, c.on.name) : openLibraryPage(`q=${encodeURIComponent(`${c.on.name} ${c.on.artist}`)}`));

	return (
		<section className={card}>
			<Heading icon={<ChatBubbleOvalLeftIcon className="size-5" />} title="Comments" profile={profile} section="comments" />
			{/* The server's message: a data value. */}
			{error && <p className="text-sm text-red-400">{error}</p>}
			{!list && !error && (
				<div className="flex flex-col gap-3" aria-hidden="true">
					{[0, 1, 2].map(i => (
						<span key={i} className="h-14 rounded-xl bg-[#8881] animate-pulse" />
					))}
				</div>
			)}
			{list?.length === 0 && <HolyText as="p" className="text-sm text-(--text-tertiary)" text="No comments yet." />}
			{!!list?.length && (
				<ul className="flex flex-col gap-1">
					{list.map(c => (
						<li key={c.id} className="flex flex-col gap-1 rounded-xl p-2.5 -mx-1 hover:bg-[#8881] duration-150">
							<button type="button" className="flex min-w-0 items-center gap-1.5 text-left text-xs text-(--text-tertiary) cursor-pointer hover:text-(--text-primary)" onClick={() => open(c)}>
								{c.on.kind === "song" ? <MusicalNoteIcon className="size-3.5 shrink-0" /> : <QueueListIcon className="size-3.5 shrink-0" />}
								{/* What it's on, and when: data values. */}
								<span className="truncate font-semibold">{c.on.name}</span>
								<span className="truncate">· {c.on.artist}</span>
								<span className="ml-auto shrink-0">{commentAge(c.at)}</span>
							</button>
							{/* The comment: their own words. */}
							<p className="whitespace-pre-wrap break-words text-sm text-(--text-secondary)">{c.body}</p>
							{c.likes > 0 && (
								<span className="flex items-center gap-1 text-xs font-semibold text-(--text-tertiary)">
									<HeartIcon className="size-3.5" />
									{c.likes.toLocaleString()}
								</span>
							)}
						</li>
					))}
				</ul>
			)}
			{more && (
				<button type="button" className="self-center px-3 py-1 rounded-full text-xs font-semibold text-(--text-secondary) hover:text-(--text-primary) cursor-pointer" onClick={() => void loadMore()}>
					<HolyText text="Show more" />
				</button>
			)}
		</section>
	);
};

const Stats = ({ profile }: { profile: ProfileData }) => {
	const s = profile.stats;
	if (!s) return null;
	const tiles: { label: string; value: number; icon: React.ReactNode }[] = [
		{ label: "Day streak", value: s.streak, icon: <FireIcon className="size-4 text-[#ff8a3d]" /> },
		{ label: "Best streak", value: s.best, icon: <SparklesIcon className="size-4 text-amber-400" /> },
		{ label: "Plays", value: s.plays, icon: <PlayIcon className="size-4 text-(--accent)" /> },
		{ label: "Comments", value: s.comments, icon: <ChatBubbleOvalLeftIcon className="size-4 text-sky-400" /> },
		{ label: "Likes received", value: s.likesReceived, icon: <HeartIcon className="size-4 text-pink-400" /> },
	];
	return (
		<section className={card}>
			<Heading icon={<SparklesIcon className="size-5" />} title="Stats" profile={profile} section="stats" />
			<div className="grid grid-cols-2 gap-2">
				{tiles.map(t => (
					<div key={t.label} className="flex flex-col gap-0.5 rounded-xl bg-[#8881] p-3">
						<span className="flex items-center gap-1.5 text-xs font-semibold text-(--text-tertiary)">
							{t.icon}
							<HolyText text={t.label} />
						</span>
						{/* The number: a data value. */}
						<span className="text-xl font-bold">{t.value.toLocaleString()}</span>
					</div>
				))}
			</div>
		</section>
	);
};

const Artists = ({ profile }: { profile: ProfileData }) => {
	const a = profile.artists;
	if (!a) return null;
	return (
		<section className={card}>
			<Heading icon={<HeartIcon className="size-5" />} title="Favorite artists" profile={profile} section="artists" />
			{!a.saved.length && !a.top.length && <HolyText as="p" className="text-sm text-(--text-tertiary)" text="No favorite artists yet." />}
			{!!a.saved.length && (
				<div className="grid grid-cols-4 gap-2">
					{a.saved.slice(0, 12).map(artist => (
						<button key={artist.id} type="button" className="flex min-w-0 flex-col items-center gap-1 rounded-xl p-1 cursor-pointer hover:bg-[#8881] duration-150" onClick={() => openLibraryPage(`artist=${encodeURIComponent(artist.id)}`, artist.name)}>
							{artist.picture ? <img src={artist.picture} alt="" className="aspect-square w-full rounded-full object-cover" /> : <span className="aspect-square w-full rounded-full bg-[#8882]" />}
							{/* The artist's name: a data value. */}
							<span className="w-full truncate text-center text-xs font-semibold">{artist.name}</span>
						</button>
					))}
				</div>
			)}
			{!!a.top.length && (
				<div className="flex flex-col gap-1">
					<HolyText as="h3" className="text-xs font-semibold text-(--text-tertiary)" text="Most played this month" />
					<ol className="flex flex-col">
						{a.top.map((artist, i) => (
							<li key={artist.name}>
								<button type="button" className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1 text-left text-sm cursor-pointer hover:bg-[#8881] duration-150" onClick={() => openLibraryPage(`artistName=${encodeURIComponent(artist.name)}`, artist.name)}>
									{/* Rank, name and plays: data values. */}
									<span className="w-4 shrink-0 text-right text-xs font-bold text-(--text-tertiary)">{i + 1}</span>
									<span className="flex-1 truncate font-semibold">{artist.name}</span>
									<span className="shrink-0 text-xs text-(--text-tertiary)">{artist.plays.toLocaleString()}</span>
								</button>
							</li>
						))}
					</ol>
				</div>
			)}
		</section>
	);
};

const Playlists = ({ profile, handle }: { profile: ProfileData; handle: string }) => {
	const lists = profile.playlists ?? [];
	const [open, setOpen] = useState<{ id: string; tracks: Awaited<ReturnType<typeof profiles.playlist>>["tracks"] | null } | null>(null);
	const playList = useMusicStore(s => s.playList);

	const toggle = (id: string) => {
		if (open?.id === id) return setOpen(null);
		setOpen({ id, tracks: null });
		profiles.playlist(handle, id).then(
			p => setOpen(o => (o?.id === id ? { id, tracks: p.tracks } : o)),
			() => setOpen(null),
		);
	};
	const play = (tracks: NonNullable<NonNullable<typeof open>["tracks"]>, index: number) => {
		const playable = tracks.filter(t => t.streamUrl);
		if (!playable.length) return;
		playList(
			playable.map(t => ({ ...trackToFracital(t), id: createId() })),
			Math.max(0, playable.indexOf(tracks[index])),
		);
	};

	return (
		<section className={card}>
			<Heading icon={<QueueListIcon className="size-5" />} title="Playlists" profile={profile} section="playlists" />
			{!lists.length && <HolyText as="p" className="text-sm text-(--text-tertiary)" text="No playlists yet." />}
			<ul className="flex flex-col gap-1">
				{lists.map(list => (
					<li key={list.id} className="flex flex-col">
						<button type="button" aria-expanded={open?.id === list.id} className="flex items-center gap-3 rounded-xl p-1.5 text-left cursor-pointer hover:bg-[#8881] duration-150" onClick={() => toggle(list.id)}>
							<span className="grid size-12 shrink-0 grid-cols-2 overflow-hidden rounded-lg bg-[#8882]">
								{list.artwork.length >= 4 ? list.artwork.slice(0, 4).map(src => <img key={src} src={src} alt="" className="size-full object-cover" />) : list.artwork[0] ? <img src={list.artwork[0]} alt="" className="col-span-2 row-span-2 size-full object-cover" /> : null}
							</span>
							{/* Its name and size: data values. */}
							<span className="flex min-w-0 flex-1 flex-col">
								<span className="truncate text-sm font-semibold">{list.name}</span>
								<span className="text-xs text-(--text-tertiary)">
									{list.count.toLocaleString()} <HolyText text={list.count === 1 ? "song" : "songs"} />
								</span>
							</span>
							<ChevronDownIcon className={`size-4 shrink-0 text-(--text-tertiary) duration-150 ${open?.id === list.id ? "rotate-180" : ""}`} />
						</button>
						{open?.id === list.id && (
							<div className="flex flex-col gap-0.5 py-1 pl-2">
								{!open.tracks && <span className="h-8 rounded-lg bg-[#8881] animate-pulse" aria-hidden="true" />}
								{open.tracks && (
									<button type="button" className="mb-1 flex w-fit items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-(--accent) text-white cursor-pointer hover:brightness-110" onClick={() => open.tracks && play(open.tracks, 0)}>
										<PlayIcon className="size-3.5" />
										<HolyText text="Play" />
									</button>
								)}
								{open.tracks?.map((t, i) => (
									<button key={t.id} type="button" className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-left cursor-pointer hover:bg-[#8881] disabled:opacity-50 disabled:cursor-default" disabled={!t.streamUrl} onClick={() => open.tracks && play(open.tracks, i)}>
										{t.artwork ? <img src={t.artwork} alt="" className="size-8 shrink-0 rounded object-cover" /> : <span className="size-8 shrink-0 rounded bg-[#8882]" />}
										{/* The song: data values. */}
										<span className="flex min-w-0 flex-col">
											<span className="truncate text-sm">{t.title}</span>
											<span className="truncate text-xs text-(--text-tertiary)">{t.artist}</span>
										</span>
									</button>
								))}
							</div>
						)}
					</li>
				))}
			</ul>
		</section>
	);
};

export default Profile;
