import { faApple, faBandcamp, faBluesky, faDiscord, faFacebook, faGithub, faInstagram, faPinterest, faReddit, faSnapchat, faSoundcloud, faSpotify, faSteam, faThreads, faTiktok, faTwitch, faXTwitter, faYoutube, type IconDefinition } from "@fortawesome/free-brands-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { ArrowTopRightOnSquareIcon, CheckBadgeIcon, ComputerDesktopIcon, GlobeAltIcon, LockClosedIcon, MusicalNoteIcon, UserCircleIcon, UserMinusIcon, UserPlusIcon } from "@heroicons/react/24/solid";
import { createId } from "@paralleldrive/cuid2";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { openLibraryPage } from "../libs/aboutPages";
import { portalTarget } from "../libs/cloak";
import { comments } from "../libs/comments";
import { useHolyAttr } from "../libs/holy-attr";
import { closeProfileCard, type Profile, type ProfileInterest, type ProfileUser, profiles, profileUrl, useProfileCard } from "../libs/profiles";
import { useTabsStore } from "../store";
import { HolyText } from "./common/HolyText";
import { NameStreak } from "./StreakBadge";

const CARD_W = 300;

/** Opens someone's profile page in a new tab. */
export const openProfilePage = (user: Pick<ProfileUser, "id" | "username" | "name">) => {
	const url = profileUrl(user);
	useTabsStore.getState().newTab({ id: createId(), url, displayUrl: url, title: user.name, icon: null, current: true });
};

const openSignIn = () => useTabsStore.getState().newTab({ id: createId(), url: "about:account", displayUrl: "about:account", title: "Fracital Account", icon: null, current: true });

// The person's picture: their own data (alt is empty, their name is next to it).
export const ProfileAvatar = ({ user, className }: { user: Pick<ProfileUser, "image">; className: string }) =>
	user.image ? <img src={user.image} alt="" className={`${className} shrink-0 rounded-full object-cover bg-(--tertiary)`} /> : <UserCircleIcon className={`${className} shrink-0 text-(--text-tertiary) bg-(--secondary) rounded-full`} />;

/** The banner: their image, their color, or (with neither) a wash of the accent color. */
export const ProfileBanner = ({ profile, className }: { profile: Pick<Profile, "banner" | "bannerColor"> | null; className: string }) =>
	profile?.banner ? (
		<img src={profile.banner} alt="" className={`${className} object-cover`} />
	) : (
		<div className={className} style={{ background: profile?.bannerColor ? profile.bannerColor : "linear-gradient(135deg, color-mix(in srgb, var(--accent) 55%, transparent), color-mix(in srgb, var(--accent) 15%, transparent))" }} />
	);

/** The pill under a profile's name (artist pages, interests): tinted with the accent, blurred over the banner. */
export const PROFILE_CHIP = "flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-bold bg-(--accent)/20 text-(--accent) backdrop-blur-md";

/** A game they play or an artist they like; an artist opens their page in the library. */
export const InterestChip = ({ interest, className = "", children }: { interest: ProfileInterest; className?: string; children?: React.ReactNode }) => {
	const Icon = interest.kind === "game" ? ComputerDesktopIcon : MusicalNoteIcon;
	const body = (
		<>
			<Icon className="size-4 shrink-0" />
			{/* Their own words: a data value. */}
			<span className="truncate">{interest.name}</span>
			{children}
		</>
	);
	if (interest.kind === "music" && !children)
		return (
			<button type="button" className={`${PROFILE_CHIP} max-w-full cursor-pointer hover:bg-(--accent)/30 duration-150 ${className}`} onClick={() => openLibraryPage(`artistName=${encodeURIComponent(interest.name)}`, interest.name)}>
				{body}
			</button>
		);
	return <span className={`${PROFILE_CHIP} max-w-full ${className}`}>{body}</span>;
};

/** Where a link goes, by its host: the brand's icon and color (monochrome ones follow the text color). */
const SOCIALS: { hosts: string[]; name: string; icon: IconDefinition; color?: string }[] = [
	{ hosts: ["instagram.com"], name: "Instagram", icon: faInstagram },
	{ hosts: ["spotify.com"], name: "Spotify", icon: faSpotify, color: "#1ed760" },
	{ hosts: ["youtube.com", "youtu.be"], name: "YouTube", icon: faYoutube, color: "#ff0033" },
	{ hosts: ["tiktok.com"], name: "TikTok", icon: faTiktok },
	{ hosts: ["x.com", "twitter.com"], name: "X", icon: faXTwitter },
	{ hosts: ["twitch.tv"], name: "Twitch", icon: faTwitch, color: "#9146ff" },
	{ hosts: ["discord.gg", "discord.com"], name: "Discord", icon: faDiscord, color: "#5865f2" },
	{ hosts: ["soundcloud.com"], name: "SoundCloud", icon: faSoundcloud, color: "#ff5500" },
	{ hosts: ["music.apple.com"], name: "Apple Music", icon: faApple, color: "#fa243c" },
	{ hosts: ["bandcamp.com"], name: "Bandcamp", icon: faBandcamp, color: "#1da0c3" },
	{ hosts: ["steamcommunity.com", "steampowered.com"], name: "Steam", icon: faSteam },
	{ hosts: ["github.com"], name: "GitHub", icon: faGithub },
	{ hosts: ["reddit.com"], name: "Reddit", icon: faReddit, color: "#ff4500" },
	{ hosts: ["bsky.app"], name: "Bluesky", icon: faBluesky, color: "#1185fe" },
	{ hosts: ["threads.net", "threads.com"], name: "Threads", icon: faThreads },
	{ hosts: ["facebook.com"], name: "Facebook", icon: faFacebook, color: "#0866ff" },
	{ hosts: ["snapchat.com"], name: "Snapchat", icon: faSnapchat, color: "#fffc00" },
	{ hosts: ["pinterest.com"], name: "Pinterest", icon: faPinterest, color: "#e60023" },
];

export const socialOf = (url: string) => {
	let host = "";
	try {
		host = new URL(url).hostname.replace(/^www\./, "");
	} catch {}
	return SOCIALS.find(s => s.hosts.some(h => host === h || host.endsWith(`.${h}`))) ?? { name: host || url, icon: null, color: undefined };
};

export const SocialIcon = ({ url, className }: { url: string; className: string }) => {
	const social = socialOf(url);
	return social.icon ? <FontAwesomeIcon icon={social.icon} className={className} style={social.color ? { color: social.color } : undefined} /> : <GlobeAltIcon className={className} />;
};

/** One of their accounts elsewhere, as its brand's icon (named by the brand, or the site for any other link); opens in a new tab. */
export const SocialLink = ({ url, className = "size-10" }: { url: string; className?: string }) => {
	const { name } = socialOf(url);
	const { ref, placeholder } = useHolyAttr({ "aria-label": name, title: name });
	return (
		<button ref={ref} {...placeholder} type="button" className="shrink-0 rounded-xl cursor-pointer duration-150 hover:scale-110 hover:brightness-110 drop-shadow-md" onClick={() => useTabsStore.getState().newTab({ id: createId(), url, displayUrl: url, title: name, icon: null, current: true })}>
			<SocialIcon url={url} className={`${className} block`} />
		</button>
	);
};

/** Following someone from their card or page; signed out, it opens the sign-in page instead. */
export const useFollow = (profile: Profile | null) => {
	const [state, setState] = useState({ followed: false, followers: 0 });
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		if (profile) setState({ followed: profile.followed, followers: profile.followers });
	}, [profile]);
	const toggle = async () => {
		if (!profile || busy) return;
		const following = !state.followed;
		setBusy(true);
		try {
			await comments.follow(profile.user.id, following);
			setState(s => ({ followed: following, followers: Math.max(0, s.followers + (following ? 1 : -1)) }));
		} catch (e) {
			if ((e as { status?: number }).status === 401) openSignIn();
		} finally {
			setBusy(false);
		}
	};
	return { ...state, busy, toggle };
};

export const FollowButton = ({ follow, className = "" }: { follow: ReturnType<typeof useFollow>; className?: string }) => (
	<button
		type="button"
		disabled={follow.busy}
		className={`flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-semibold cursor-pointer duration-150 disabled:opacity-60 ${follow.followed ? "bg-[#8882] text-(--text-primary) hover:bg-[#8883]" : "bg-(--accent) text-white hover:brightness-110"} ${className}`}
		onClick={() => void follow.toggle()}
	>
		{follow.followed ? <UserMinusIcon className="size-4" /> : <UserPlusIcon className="size-4" />}
		<HolyText text={follow.followed ? "Following" : "Follow"} />
	</button>
);

/** "12 followers · 3 following": counts are data values. */
export const FollowCounts = ({ followers, following }: { followers: number; following: number }) => (
	<span className="flex items-center gap-3 text-sm text-(--text-secondary)">
		<span>
			<span className="font-bold text-(--text-primary)">{followers.toLocaleString()}</span> <HolyText text={followers === 1 ? "follower" : "followers"} />
		</span>
		<span>
			<span className="font-bold text-(--text-primary)">{following.toLocaleString()}</span> <HolyText text="following" />
		</span>
	</span>
);

/** The card a name or avatar opens (one at a time, mounted once in the app). */
export const ProfileCardHost = () => {
	const open = useProfileCard(s => s.open);
	if (!open) return null;
	return createPortal(<ProfileCard key={open.user.id} user={open.user} anchor={open.anchor} />, portalTarget());
};

const ProfileCard = ({ user, anchor }: { user: ProfileUser; anchor: { top: number; bottom: number; left: number; right: number } }) => {
	const actions = useProfileCard(s => s.actions);
	const panel = useRef<HTMLDivElement>(null);
	const [profile, setProfile] = useState<Profile | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [height, setHeight] = useState(0);
	const follow = useFollow(profile);

	useEffect(() => {
		profiles.get(user.username ?? user.id).then(setProfile, (e: Error) => setError(e.message));
	}, [user.id, user.username]);

	useEffect(() => {
		const outside = (e: MouseEvent) => panel.current && !e.composedPath().includes(panel.current) && closeProfileCard();
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeProfileCard();
		document.addEventListener("mousedown", outside);
		document.addEventListener("keydown", onKey);
		window.addEventListener("resize", closeProfileCard);
		return () => {
			document.removeEventListener("mousedown", outside);
			document.removeEventListener("keydown", onKey);
			window.removeEventListener("resize", closeProfileCard);
		};
	}, []);

	// Placed beside what was clicked: below it when there's room, else above; kept on screen.
	useLayoutEffect(() => {
		if (panel.current) setHeight(panel.current.offsetHeight);
	});
	const width = Math.min(CARD_W, window.innerWidth - 16);
	const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
	const below = anchor.bottom + 8 + height <= window.innerHeight - 8 || anchor.top - 8 - height < 8;
	const top = below ? Math.min(anchor.bottom + 8, Math.max(8, window.innerHeight - height - 8)) : anchor.top - 8 - height;

	const shown = profile?.user ?? user;
	const view = () => {
		closeProfileCard();
		openProfilePage(shown);
	};

	return (
		<div ref={panel} role="dialog" className="fixed z-50 flex flex-col overflow-hidden rounded-2xl text-(--text-primary) bg-(--secondary) inset-shadow-(--inset-shadow-primary) shadow-xl" style={{ left, top, width, visibility: height ? "visible" : "hidden" }}>
			<ProfileBanner profile={profile} className="h-26.5 w-full" />
			<div className="flex flex-col gap-2.5 px-4 pb-4">
				<div className="-mt-8 flex items-end justify-between gap-2">
					<button type="button" className="cursor-pointer rounded-full ring-4 ring-(--secondary)" onClick={view}>
						<ProfileAvatar user={shown} className="size-16" />
					</button>
					{profile && !profile.own && <FollowButton follow={follow} />}
				</div>
				<div className="flex flex-col min-w-0">
					{/* Their name and handle: data values. */}
					<span className="flex items-center gap-1.5 min-w-0">
						<button type="button" className="truncate text-lg font-bold hover:underline cursor-pointer" onClick={view}>
							{shown.name}
						</button>
						{!!profile?.artistPages?.length && <CheckBadgeIcon className="size-5 shrink-0 text-(--accent)" />}
						<NameStreak streak={profile?.stats?.streak} />
					</span>
					{shown.username && <span className="truncate text-sm text-(--text-tertiary)">@{shown.username}</span>}
				</div>
				{/* Their bio: their own words (a data value). */}
				{profile?.bio && <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm text-(--text-secondary)">{profile.bio}</p>}
				{profile?.private && !profile.own && (
					<span className="flex items-center gap-1.5 text-sm text-(--text-tertiary)">
						<LockClosedIcon className="size-4" />
						<HolyText text="This profile is private." />
					</span>
				)}
				{profile && <FollowCounts followers={follow.followers} following={profile.following} />}
				{!profile && !error && (
					<div className="flex flex-col gap-2" aria-hidden="true">
						<span className="h-3.5 w-3/4 rounded bg-[#8882] animate-pulse" />
						<span className="h-3.5 w-1/2 rounded bg-[#8882] animate-pulse" />
					</div>
				)}
				{/* The server's message: a data value. */}
				{error && <p className="text-sm text-red-400">{error}</p>}
				<div className="flex flex-col gap-1.5 pt-1">
					<button type="button" className="flex items-center justify-center gap-1.5 w-full px-3 py-1.5 rounded-full text-sm font-semibold bg-[#8882] hover:bg-[#8883] cursor-pointer duration-150" onClick={view}>
						<HolyText text="View profile" />
						<ArrowTopRightOnSquareIcon className="size-4" />
					</button>
					{actions.map(a => (
						<button
							key={a.label}
							type="button"
							className="w-full px-3 py-1.5 rounded-full text-sm font-semibold text-(--text-secondary) hover:text-(--text-primary) hover:bg-[#8881] cursor-pointer duration-150"
							onClick={() => {
								closeProfileCard();
								a.onClick();
							}}
						>
							<HolyText text={a.label} />
						</button>
					))}
				</div>
			</div>
		</div>
	);
};
