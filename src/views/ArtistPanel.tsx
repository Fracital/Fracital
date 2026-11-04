import { ArrowLeftIcon, ArrowUpTrayIcon, ChartBarIcon, CheckBadgeIcon, ClipboardDocumentIcon, LinkIcon, MagnifyingGlassIcon, MusicalNoteIcon, PaintBrushIcon, PlusIcon, StarIcon, TrashIcon, UserGroupIcon, XMarkIcon } from "@heroicons/react/24/solid";
import { createId } from "@paralleldrive/cuid2";
import { useEffect, useRef, useState } from "react";
import { getMe, type Me } from "../libs/auth";
import { ProfileEditor, SignIn } from "./Account";
import {
	FONT_STACK,
	GOOGLE_FONTS,
	loadArtistFont,
	panel,
	type ArtistFont,
	type ArtistPick,
	type ArtistProfile,
	type ArtistStats,
	type Claim,
	type Member,
	type PageRole,
	type ProfileEdit,
} from "../libs/artistPanel";
import { IMAGE_PRESETS } from "../libs/compressImage";
import { artworkHighRes, formatCount, getArtist, searchTracks, type ArtistDetail, type ArtistLinkKind, type MusicArtist } from "../libs/music-service";
import { useSettingsStore, useTabsStore } from "../store";

const LINK_KINDS: { kind: ArtistLinkKind; label: string }[] = [
	{ kind: "instagram", label: "Instagram" },
	{ kind: "spotify", label: "Spotify" },
	{ kind: "youtube", label: "YouTube" },
	{ kind: "tidal", label: "TIDAL" },
	{ kind: "apple", label: "Apple Music" },
	{ kind: "soundcloud", label: "SoundCloud" },
	{ kind: "x", label: "X" },
	{ kind: "tiktok", label: "TikTok" },
	{ kind: "facebook", label: "Facebook" },
	{ kind: "bandcamp", label: "Bandcamp" },
	{ kind: "deezer", label: "Deezer" },
	{ kind: "website", label: "Website" },
];

/** Rewrites this tab's URL (so refresh/back keep the view) without importing aboutPages (import cycle). */
function setTabUrl(query: string | undefined, title = "Fracital for Artists") {
	const tab = useTabsStore.getState().tabs.find(t => t.current);
	if (!tab) return;
	const url = query ? `about:artists?${query}` : "about:artists";
	window.dispatchEvent(new CustomEvent("navigate", { detail: { url, title, displayUrl: url, id: tab.id } }));
}

const openTab = (url: string, title: string) => useTabsStore.getState().newTab({ id: createId(), url, displayUrl: url, title, icon: null, current: true });

const useDark = () => useSettingsStore(s => s.settings.brightness) !== "light";

const Card = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => {
	const dark = useDark();
	return <div className={`rounded-2xl p-4 ${dark ? "bg-[#ffffff0d]" : "bg-[#00000008]"} ${className}`}>{children}</div>;
};

const Button = ({ children, onClick, kind = "secondary", disabled, title, className = "" }: { children: React.ReactNode; onClick?: () => void; kind?: "primary" | "secondary" | "danger"; disabled?: boolean; title?: string; className?: string }) => {
	const dark = useDark();
	const styles =
		kind === "primary"
			? dark
				? "bg-white text-black hover:bg-white/90"
				: "bg-black text-white hover:bg-black/85"
			: kind === "danger"
				? "bg-red-500/15 text-red-400 hover:bg-red-500/25"
				: dark
					? "bg-[#ffffff14] hover:bg-[#ffffff24]"
					: "bg-[#00000010] hover:bg-[#0000001c]";
	return (
		<button title={title} disabled={disabled} onClick={onClick} className={`flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-semibold disabled:opacity-50 cursor-pointer duration-150 ${styles} ${className}`}>
			{children}
		</button>
	);
};

const inputCls = (dark: boolean) => `w-full px-3 py-2 rounded-xl text-sm outline-none duration-150 ${dark ? "bg-[#ffffff10] focus:bg-[#ffffff18]" : "bg-[#00000008] focus:bg-[#00000012]"}`;

const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
	<label className="flex flex-col gap-1.5">
		<span className="text-sm font-semibold">{label}</span>
		{children}
		{hint && <span className="text-xs text-(--text-tertiary)">{hint}</span>}
	</label>
);

const ErrorBox = ({ error }: { error: string }) => (error ? <div className="p-2.5 rounded-xl bg-red-500/15 border border-red-500/40 text-sm text-red-300">{error}</div> : null);

const roleLabel: Record<PageRole, string> = { owner: "Owner", admin: "Admin", editor: "Editor" };

// ============================================================
// Root
// ============================================================

export const ArtistPanel = ({ query }: { query?: string }) => {
	const params = new URLSearchParams(query || "");
	const [me, setMe] = useState<Me | null | undefined>(undefined);

	useEffect(() => {
		const load = () => void getMe().then(setMe);
		load();
		window.addEventListener("account-upd", load);
		return () => window.removeEventListener("account-upd", load);
	}, []);

	if (me === undefined) return <div className="flex items-center justify-center size-full text-(--text-tertiary)">Loading…</div>;
	if (!me) {
		// Artists sign in or register with a regular Fracital Account (existing accounts work too).
		return (
			<div className="size-full overflow-auto py-8">
				<SignIn
					initialPage={params.get("register") !== null ? "register" : "login"}
					onSignedIn={setMe}
					branding={{
						icon: <CheckBadgeIcon className="size-14 text-[#3d91ff]" />,
						loginTitle: "Fracital for Artists",
						registerTitle: "Join Fracital for Artists",
						subtitle: "Sign in with your Fracital Account — or create one — to claim your artist page, customize it, see your stats and bring your team.",
					}}
				/>
			</div>
		);
	}

	const page = params.get("page");
	if (page) return <PageEditor artistId={page} initialTab={(params.get("tab") as Tab) || "profile"} />;
	if (params.get("claim") !== null) return <ClaimForm artistId={params.get("claim") || ""} artistName={params.get("name") || ""} />;
	return <Home invite={params.get("invite")} />;
};

// ============================================================
// Home: your pages + claims
// ============================================================

const Home = ({ invite }: { invite: string | null }) => {
	const [data, setData] = useState<Awaited<ReturnType<typeof panel.overview>> | null>(null);
	const [error, setError] = useState("");
	const [inviteInfo, setInviteInfo] = useState<{ artistId: string; artistName: string | null; role: PageRole } | null>(null);
	const dark = useDark();

	const load = () =>
		panel
			.overview()
			.then(setData)
			.catch(e => setError(e.message));
	useEffect(() => {
		void load();
	}, []);
	useEffect(() => {
		if (invite)
			panel
				.inviteInfo(invite)
				.then(setInviteInfo)
				.catch(e => setError(e.message));
	}, [invite]);

	const accept = async () => {
		if (!invite) return;
		try {
			const r = await panel.acceptInvite(invite);
			setTabUrl(`page=${encodeURIComponent(r.artistId)}`, inviteInfo?.artistName || "Artist page");
		} catch (e) {
			setError(e instanceof Error ? e.message : "Couldn't accept the invite");
		}
	};

	return (
		<div className="size-full overflow-auto p-6">
			<div className="flex flex-col gap-5 max-w-4xl mx-auto">
				<div className="flex flex-wrap items-end justify-between gap-3">
					<div>
						<h1 className="text-3xl font-black flex items-center gap-2">
							<CheckBadgeIcon className="size-8 text-[#3d91ff]" /> Fracital for Artists
						</h1>
						<p className="text-sm text-(--text-tertiary)">Manage your artist pages, stats and team.</p>
					</div>
					<div className="flex gap-2">
						{data?.isAdmin && <Button onClick={() => openTab("about:admin", "Admin Dashboard")}>Admin dashboard</Button>}
						<Button kind="primary" onClick={() => setTabUrl("claim=", "Claim your page")}>
							<PlusIcon className="size-4" /> Claim a page
						</Button>
					</div>
				</div>

				<ErrorBox error={error} />

				<AccountStrip />

				{inviteInfo && (
					<Card className="flex items-center gap-3">
						<UserGroupIcon className="size-6 shrink-0" />
						<span className="flex-1 text-sm">
							You've been invited to manage <b>{inviteInfo.artistName || "an artist page"}</b> as {roleLabel[inviteInfo.role].toLowerCase()}.
						</span>
						<Button kind="primary" onClick={accept}>
							Accept invite
						</Button>
					</Card>
				)}

				<section className="flex flex-col gap-2">
					<h2 className="text-lg font-bold">Your pages</h2>
					{!data ? (
						<span className="text-sm text-(--text-tertiary)">Loading…</span>
					) : data.pages.length === 0 ? (
						<Card className="text-sm text-(--text-tertiary)">You don't manage any artist pages yet. Claim yours to get started — an admin reviews every claim.</Card>
					) : (
						<div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
							{data.pages.map(p => (
								<button
									key={p.artistId}
									className={`flex items-center gap-3 p-3 rounded-2xl text-left cursor-pointer duration-150 ${dark ? "bg-[#ffffff0d] hover:bg-[#ffffff18]" : "bg-[#00000008] hover:bg-[#00000012]"}`}
									onClick={() => setTabUrl(`page=${encodeURIComponent(p.artistId)}`, p.name)}
								>
									{p.image ? <img src={p.image} alt="" className="size-12 rounded-full object-cover" /> : <div className="size-12 rounded-full bg-(--tertiary) flex items-center justify-center font-bold">{p.name?.charAt(0)}</div>}
									<div className="flex flex-col min-w-0">
										<span className="font-bold truncate flex items-center gap-1">
											{p.name} {p.verified && <CheckBadgeIcon className="size-4 shrink-0 text-[#3d91ff]" />}
										</span>
										<span className="text-xs text-(--text-tertiary)">{roleLabel[p.role]}</span>
									</div>
								</button>
							))}
						</div>
					)}
				</section>

				{!!data?.claims.length && (
					<section className="flex flex-col gap-2">
						<h2 className="text-lg font-bold">Your claims</h2>
						<div className="flex flex-col gap-2">
							{data.claims.map(c => (
								<ClaimRow key={c.id} claim={c} onCancel={() => panel.cancelClaim(c.id).then(load)} />
							))}
						</div>
					</section>
				)}
			</div>
		</div>
	);
};

const statusStyle: Record<Claim["status"], string> = {
	pending: "bg-yellow-500/15 text-yellow-300",
	approved: "bg-green-500/15 text-green-400",
	rejected: "bg-red-500/15 text-red-400",
};

const ClaimRow = ({ claim, onCancel }: { claim: Claim; onCancel: () => void }) => (
	<Card className="flex items-center gap-3">
		<div className="flex flex-col flex-1 min-w-0">
			<span className="font-semibold truncate">{claim.artistName}</span>
			<span className="text-xs text-(--text-tertiary)">
				{claim.roleTitle} · submitted {new Date(claim.createdAt).toLocaleDateString()}
				{claim.adminNote ? ` · “${claim.adminNote}”` : ""}
			</span>
		</div>
		<span className={`px-2.5 py-1 rounded-full text-xs font-bold capitalize ${statusStyle[claim.status]}`}>{claim.status}</span>
		{claim.status === "pending" && (
			<button className="p-1.5 rounded-full hover:bg-[#ffffff18] cursor-pointer" title="Cancel claim" onClick={onCancel}>
				<XMarkIcon className="size-4" />
			</button>
		)}
	</Card>
);

// ============================================================
// Claim form
// ============================================================

const ClaimForm = ({ artistId: initialId, artistName: initialName }: { artistId: string; artistName: string }) => {
	const dark = useDark();
	const [artist, setArtist] = useState<{ id: string; name: string; picture?: string } | null>(initialId ? { id: initialId, name: initialName } : null);
	const [q, setQ] = useState("");
	const [results, setResults] = useState<MusicArtist[]>([]);
	const [roleTitle, setRoleTitle] = useState("Artist");
	const [contactEmail, setContactEmail] = useState("");
	const [links, setLinks] = useState("");
	const [message, setMessage] = useState("");
	const [error, setError] = useState("");
	const [done, setDone] = useState(false);
	const [busy, setBusy] = useState(false);
	const debounce = useRef(0);

	useEffect(() => {
		void getMe().then(m => m?.user.email && setContactEmail(e => e || m.user.email!));
	}, []);

	const search = (value: string) => {
		setQ(value);
		window.clearTimeout(debounce.current);
		debounce.current = window.setTimeout(() => {
			if (!value.trim()) return setResults([]);
			searchTracks(value, 5)
				.then(r => setResults(r.artists ?? []))
				.catch(() => setResults([]));
		}, 350);
	};

	const submit = async () => {
		if (!artist) return setError("Pick your artist page first");
		const proofLinks = links
			.split(/\s+/)
			.map(s => s.trim())
			.filter(Boolean);
		if (!proofLinks.length) return setError("Add at least one official link (Instagram, Spotify, website…) so we can verify you");
		setBusy(true);
		setError("");
		try {
			await panel.claim({ artistId: artist.id, artistName: artist.name, roleTitle, contactEmail, proofLinks, message });
			setDone(true);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Couldn't submit your claim");
		} finally {
			setBusy(false);
		}
	};

	if (done) {
		return (
			<div className="flex flex-col items-center justify-center size-full gap-3 text-center p-6">
				<CheckBadgeIcon className="size-14 text-[#3d91ff]" />
				<h1 className="text-2xl font-black">Claim submitted</h1>
				<p className="text-(--text-tertiary) max-w-md">An admin will review your claim for {artist?.name}. You'll see the result on your Artists home page.</p>
				<Button onClick={() => setTabUrl(undefined)}>Back to your pages</Button>
			</div>
		);
	}

	return (
		<div className="size-full overflow-auto p-6">
			<div className="flex flex-col gap-4 max-w-xl mx-auto">
				<button className="flex items-center gap-1.5 text-sm text-(--text-tertiary) hover:text-(--text-primary) w-max cursor-pointer" onClick={() => setTabUrl(undefined)}>
					<ArrowLeftIcon className="size-4" /> Back
				</button>
				<h1 className="text-2xl font-black">Claim your artist page</h1>
				<p className="text-sm text-(--text-tertiary)">Tell us who you are. An admin checks every claim against your official accounts before the page is yours.</p>
				<ErrorBox error={error} />

				<Card className="flex flex-col gap-4">
					<Field label="Artist page">
						{artist ? (
							<div className="flex items-center gap-3">
								{artist.picture ? <img src={artist.picture} alt="" className="size-10 rounded-full object-cover" /> : <div className="size-10 rounded-full bg-(--tertiary)" />}
								<span className="flex-1 font-semibold">{artist.name}</span>
								<Button onClick={() => setArtist(null)}>Change</Button>
							</div>
						) : (
							<div className="flex flex-col gap-2">
								<div className={`flex items-center gap-2 ${inputCls(dark)}`}>
									<MagnifyingGlassIcon className="size-4 opacity-60" />
									<input autoFocus className="flex-1 bg-transparent outline-none" placeholder="Search your artist name" value={q} onChange={e => search(e.target.value)} />
								</div>
								{results.map(r => (
									<button key={r.id} className={`flex items-center gap-3 p-2 rounded-xl text-left cursor-pointer ${dark ? "hover:bg-[#ffffff12]" : "hover:bg-[#0000000c]"}`} onClick={() => setArtist({ id: r.id, name: r.name, picture: r.picture })}>
										{r.picture ? <img src={r.picture} alt="" className="size-9 rounded-full object-cover" /> : <div className="size-9 rounded-full bg-(--tertiary)" />}
										<span className="font-medium">{r.name}</span>
									</button>
								))}
							</div>
						)}
					</Field>
					<Field label="Your role">
						<select className={inputCls(dark)} value={roleTitle} onChange={e => setRoleTitle(e.target.value)}>
							{["Artist", "Manager", "Label", "Team member"].map(r => (
								<option key={r}>{r}</option>
							))}
						</select>
					</Field>
					<Field label="Contact email" hint="We may email you to confirm. Use an address on your official domain if you have one.">
						<input className={inputCls(dark)} type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="you@yourdomain.com" />
					</Field>
					<Field label="Official links" hint="Instagram, X, YouTube, Spotify, website — one per line. The quickest way to get verified is to also mention Fracital on one of them.">
						<textarea className={`${inputCls(dark)} min-h-24`} value={links} onChange={e => setLinks(e.target.value)} placeholder={"https://instagram.com/yourname\nhttps://yourwebsite.com"} />
					</Field>
					<Field label="Anything else? (optional)">
						<textarea className={`${inputCls(dark)} min-h-20`} value={message} onChange={e => setMessage(e.target.value)} placeholder="Anything that helps us verify you" maxLength={2000} />
					</Field>
					<Button kind="primary" onClick={submit} disabled={busy}>
						{busy ? "Submitting…" : "Submit claim"}
					</Button>
				</Card>
			</div>
		</div>
	);
};

// ============================================================
// Page editor
// ============================================================

type Tab = "profile" | "links" | "pick" | "stats" | "team";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
	{ id: "profile", label: "Profile", icon: <PaintBrushIcon className="size-4" /> },
	{ id: "links", label: "Links", icon: <LinkIcon className="size-4" /> },
	{ id: "pick", label: "Artist Pick", icon: <StarIcon className="size-4" /> },
	{ id: "stats", label: "Stats", icon: <ChartBarIcon className="size-4" /> },
	{ id: "team", label: "Team", icon: <UserGroupIcon className="size-4" /> },
];

const emptyDraft = (p: ArtistProfile | null): ProfileEdit => ({
	bio: p?.bio ?? "",
	banner: p?.banner ?? "",
	photos: p?.photos ?? [],
	logo: p?.logo ?? "",
	font: p?.font ?? null,
	links: p?.links ?? null,
	pick: p?.pick ?? null,
	announcement: p?.announcement ?? "",
});

const PageEditor = ({ artistId, initialTab }: { artistId: string; initialTab: Tab }) => {
	const dark = useDark();
	const [tab, setTab] = useState<Tab>(TABS.some(t => t.id === initialTab) ? initialTab : "profile");
	const [data, setData] = useState<Awaited<ReturnType<typeof panel.page>> | null>(null);
	const [catalog, setCatalog] = useState<ArtistDetail | null>(null);
	const [draft, setDraft] = useState<ProfileEdit>(emptyDraft(null));
	const [savedJson, setSavedJson] = useState(JSON.stringify(emptyDraft(null)));
	const [error, setError] = useState("");
	const [saving, setSaving] = useState(false);
	const [savedAt, setSavedAt] = useState(0);

	const load = () =>
		panel
			.page(artistId)
			.then(d => {
				setData(d);
				const dr = emptyDraft(d.profile);
				setDraft(dr);
				setSavedJson(JSON.stringify(dr));
			})
			.catch(e => setError(e.message));

	useEffect(() => {
		void load();
		getArtist(artistId)
			.then(setCatalog)
			.catch(() => {});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [artistId]);

	useEffect(() => loadArtistFont(draft.font), [draft.font]);

	const name = data?.profile?.name || catalog?.artist.name || "Artist";
	const dirty = JSON.stringify(draft) !== savedJson;
	const set = (patch: ProfileEdit) => setDraft(d => ({ ...d, ...patch }));

	const save = async () => {
		setSaving(true);
		setError("");
		try {
			const r = await panel.save(artistId, { ...draft, name });
			const dr = emptyDraft(r.profile);
			setDraft(dr);
			setSavedJson(JSON.stringify(dr));
			setSavedAt(Date.now());
		} catch (e) {
			setError(e instanceof Error ? e.message : "Couldn't save");
		} finally {
			setSaving(false);
		}
	};

	const switchTab = (t: Tab) => {
		setTab(t);
		setTabUrl(`page=${encodeURIComponent(artistId)}&tab=${t}`, name);
	};

	if (error && !data) {
		return (
			<div className="flex flex-col items-center justify-center size-full gap-3 p-6">
				<ErrorBox error={error} />
				<Button onClick={() => setTabUrl(undefined)}>Back</Button>
			</div>
		);
	}

	const banner = draft.banner || catalog?.artist.banner || catalog?.artist.picture || "";

	return (
		<div className="size-full overflow-auto">
			{/* Header */}
			<div className="relative h-44 shrink-0">
				{banner && <img src={banner} alt="" className="absolute inset-0 size-full object-cover" />}
				<div className="absolute inset-0 bg-linear-to-b from-black/30 to-black/80" />
				<div className="absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-3 p-5 max-w-5xl mx-auto">
					<div className="flex flex-col gap-1 min-w-0">
						<button className="flex items-center gap-1 text-xs text-white/70 hover:text-white w-max cursor-pointer" onClick={() => setTabUrl(undefined)}>
							<ArrowLeftIcon className="size-3.5" /> Your pages
						</button>
						{draft.logo ? (
							<img src={draft.logo} alt={name} className="max-h-14 max-w-72 object-contain object-left" />
						) : (
							<h1 className="text-4xl font-black text-white truncate flex items-center gap-2" style={{ fontFamily: FONT_STACK(draft.font) }}>
								{name}
								{data?.profile?.verified && <CheckBadgeIcon className="size-7 shrink-0 text-[#3d91ff]" />}
							</h1>
						)}
						<span className="text-xs text-white/60">{data ? `You're ${roleLabel[data.role].toLowerCase()} of this page` : "Loading…"}</span>
					</div>
					<div className="flex items-center gap-2">
						<Button onClick={() => openTab(`about:library?artist=${encodeURIComponent(artistId)}`, name)}>View page</Button>
						{tab !== "stats" && tab !== "team" && (
							<Button kind="primary" onClick={save} disabled={!dirty || saving}>
								{saving ? "Saving…" : dirty ? "Save changes" : savedAt ? "Saved ✓" : "Saved"}
							</Button>
						)}
					</div>
				</div>
			</div>

			<div className="flex flex-col gap-4 p-5 max-w-5xl mx-auto">
				<div className="flex flex-wrap gap-1.5">
					{TABS.map(t => (
						<button
							key={t.id}
							onClick={() => switchTab(t.id)}
							className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-semibold cursor-pointer duration-150 ${tab === t.id ? (dark ? "bg-white text-black" : "bg-black text-white") : dark ? "bg-[#ffffff12] hover:bg-[#ffffff20]" : "bg-[#0000000c] hover:bg-[#00000016]"}`}
						>
							{t.icon}
							{t.label}
						</button>
					))}
				</div>
				<ErrorBox error={error} />
				{tab === "profile" && <ProfileTab artistId={artistId} name={name} draft={draft} set={set} catalog={catalog} onError={setError} />}
				{tab === "links" && <LinksTab draft={draft} set={set} />}
				{tab === "pick" && <PickTab draft={draft} set={set} catalog={catalog} />}
				{tab === "stats" && <StatsTab artistId={artistId} catalog={catalog} />}
				{tab === "team" && data && <TeamTab artistId={artistId} role={data.role} members={data.members} invites={data.invites} reload={load} onError={setError} />}
			</div>
		</div>
	);
};

// --- Profile ---

const ImagePicker = ({
	artistId,
	label,
	hint,
	value,
	onChange,
	onError,
	shape = "wide",
	preset,
}: {
	artistId: string;
	label: string;
	hint?: string;
	value: string;
	onChange: (url: string) => void;
	onError: (e: string) => void;
	shape?: "wide" | "square" | "logo";
	preset?: keyof typeof IMAGE_PRESETS;
}) => {
	const dark = useDark();
	const input = useRef<HTMLInputElement>(null);
	const [busy, setBusy] = useState(false);
	const upload = async (file: File | undefined) => {
		if (!file) return;
		setBusy(true);
		onError("");
		try {
			onChange(await panel.upload(artistId, file, "image", preset ?? (shape === "wide" ? "banner" : shape === "logo" ? "logo" : "photo")));
		} catch (e) {
			onError(e instanceof Error ? e.message : "Upload failed");
		} finally {
			setBusy(false);
			if (input.current) input.current.value = "";
		}
	};
	const box = shape === "wide" ? "w-full aspect-[3/1]" : shape === "logo" ? "w-full h-24" : "aspect-square w-full";
	return (
		<div className="flex flex-col gap-1.5">
			<span className="text-sm font-semibold">{label}</span>
			<div className={`relative ${box} rounded-xl overflow-hidden flex items-center justify-center ${dark ? "bg-[#ffffff0d]" : "bg-[#00000008]"} ${shape === "logo" ? "bg-[repeating-conic-gradient(#ffffff10_0%_25%,transparent_0%_50%)] bg-size-[16px_16px]" : ""}`}>
				{value ? <img src={value} alt="" className={`size-full ${shape === "logo" ? "object-contain p-2" : "object-cover"}`} /> : <span className="text-xs text-(--text-tertiary)">No image</span>}
				<div className="absolute bottom-2 right-2 flex gap-1.5">
					<button className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-black/60 text-white hover:bg-black/80 cursor-pointer" onClick={() => input.current?.click()} disabled={busy}>
						<ArrowUpTrayIcon className="size-3.5" /> {busy ? "Processing…" : "Upload"}
					</button>
					{value && (
						<button className="p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 cursor-pointer" title="Remove" onClick={() => onChange("")}>
							<TrashIcon className="size-3.5" />
						</button>
					)}
				</div>
			</div>
			<input ref={input} type="file" accept="image/*" className="hidden" onChange={e => upload(e.target.files?.[0])} />
			{hint && <span className="text-xs text-(--text-tertiary)">{hint}</span>}
		</div>
	);
};

const ProfileTab = ({ artistId, name, draft, set, catalog, onError }: { artistId: string; name: string; draft: ProfileEdit; set: (p: ProfileEdit) => void; catalog: ArtistDetail | null; onError: (e: string) => void }) => {
	const dark = useDark();
	const photos = [...(draft.photos ?? []), "", "", "", ""].slice(0, 4);
	return (
		<div className="grid lg:grid-cols-2 gap-4">
			<Card className="flex flex-col gap-4">
				<Field label="Bio" hint="Shown on your page. Leave empty to use the automatic Wikipedia bio.">
					<textarea className={`${inputCls(dark)} min-h-36`} maxLength={4000} value={draft.bio ?? ""} placeholder={catalog?.artist.bio?.slice(0, 200) || "Tell listeners about yourself"} onChange={e => set({ bio: e.target.value })} />
				</Field>
				<Field label="Announcement" hint="A short banner on your page — new release, tour, merch drop.">
					<input className={inputCls(dark)} maxLength={500} value={draft.announcement ?? ""} placeholder="“LV BAG” w/ j-hope, Pharrell & Speedy OUT NOW" onChange={e => set({ announcement: e.target.value })} />
				</Field>
				<FontPicker artistId={artistId} name={name} font={draft.font ?? null} onChange={font => set({ font })} onError={onError} />
			</Card>
			<Card className="flex flex-col gap-4">
				<ImagePicker artistId={artistId} label="Banner" hint="The main image behind your name. Wide images work best (at least 1500px)." value={draft.banner ?? ""} onChange={banner => set({ banner })} onError={onError} />
				<ImagePicker artistId={artistId} label="Logo" hint="Replaces your name in text on the page. Use a transparent PNG." shape="logo" value={draft.logo ?? ""} onChange={logo => set({ logo })} onError={onError} />
				<div className="flex flex-col gap-1.5">
					<span className="text-sm font-semibold">Photos</span>
					<div className="grid grid-cols-4 gap-2">
						{photos.map((p, i) => (
							<ImagePicker
								key={i}
								artistId={artistId}
								label=""
								shape="square"
								value={p}
								onError={onError}
								onChange={url => {
									const next = [...photos];
									next[i] = url;
									set({ photos: next.filter(Boolean) });
								}}
							/>
						))}
					</div>
					<span className="text-xs text-(--text-tertiary)">The photo collage on your page. Empty slots use automatic photos.</span>
				</div>
			</Card>
		</div>
	);
};

const FontPicker = ({ artistId, name, font, onChange, onError }: { artistId: string; name: string; font: ArtistFont | null; onChange: (f: ArtistFont | null) => void; onError: (e: string) => void }) => {
	const dark = useDark();
	const input = useRef<HTMLInputElement>(null);
	const [custom, setCustom] = useState(font?.source === "google" && !GOOGLE_FONTS.includes(font.family) ? font.family : "");
	const [busy, setBusy] = useState(false);
	const upload = async (file: File | undefined) => {
		if (!file) return;
		setBusy(true);
		onError("");
		try {
			const url = await panel.upload(artistId, file, "font");
			const family = `${name.replace(/[^\p{L}\p{N} ]/gu, "").slice(0, 40) || "Artist"} Custom`;
			onChange({ family, source: "upload", url });
		} catch (e) {
			onError(e instanceof Error ? e.message : "Upload failed");
		} finally {
			setBusy(false);
		}
	};
	const selectValue = !font ? "" : font.source === "upload" ? "__upload" : GOOGLE_FONTS.includes(font.family) ? font.family : "__custom";
	return (
		<div className="flex flex-col gap-1.5">
			<span className="text-sm font-semibold">Font</span>
			<div className="flex gap-2">
				<select
					className={inputCls(dark)}
					value={selectValue}
					onChange={e => {
						const v = e.target.value;
						if (v === "") onChange(null);
						else if (v === "__upload") input.current?.click();
						else if (v === "__custom") onChange(custom ? { family: custom, source: "google" } : font);
						else onChange({ family: v, source: "google" });
					}}
				>
					<option value="">Default (Inter)</option>
					{GOOGLE_FONTS.map(f => (
						<option key={f} value={f}>
							{f}
						</option>
					))}
					<option value="__custom">Other Google Font…</option>
					<option value="__upload">{font?.source === "upload" ? `Uploaded: ${font.family}` : "Upload a font file…"}</option>
				</select>
				<Button onClick={() => input.current?.click()} disabled={busy} title="Upload .woff2, .woff, .ttf or .otf">
					<ArrowUpTrayIcon className="size-4" />
				</Button>
			</div>
			{selectValue === "__custom" && (
				<input className={inputCls(dark)} placeholder="Exact Google Fonts name, e.g. Major Mono Display" value={custom} onChange={e => setCustom(e.target.value)} onBlur={() => custom.trim() && onChange({ family: custom.trim(), source: "google" })} />
			)}
			<input ref={input} type="file" accept=".woff2,.woff,.ttf,.otf" className="hidden" onChange={e => upload(e.target.files?.[0])} />
			<div className={`mt-1 p-3 rounded-xl ${dark ? "bg-black/30" : "bg-white"}`} style={{ fontFamily: FONT_STACK(font) }}>
				<div className="text-3xl font-black leading-tight">{name}</div>
				<div className="text-sm opacity-75">Used for your name, bio and announcement.</div>
			</div>
			<span className="text-xs text-(--text-tertiary)">{busy ? "Uploading font…" : "Pick a Google Font or upload your own (.woff2/.woff/.ttf/.otf, 2MB max)."}</span>
		</div>
	);
};

// --- Links ---

const LinksTab = ({ draft, set }: { draft: ProfileEdit; set: (p: ProfileEdit) => void }) => {
	const dark = useDark();
	const links = draft.links ?? [];
	const update = (next: { kind: ArtistLinkKind; url: string }[]) => set({ links: next.length ? next : null });
	return (
		<Card className="flex flex-col gap-3 max-w-2xl">
			<div>
				<h2 className="font-bold">Official links</h2>
				<p className="text-xs text-(--text-tertiary)">The first four show as icons on your page; the rest are under “+”. With no links set, links are found automatically.</p>
			</div>
			{links.map((l, i) => (
				<div key={i} className="flex gap-2">
					<select className={`${inputCls(dark)} w-40!`} value={l.kind} onChange={e => update(links.map((x, j) => (j === i ? { ...x, kind: e.target.value as ArtistLinkKind } : x)))}>
						{LINK_KINDS.map(k => (
							<option key={k.kind} value={k.kind}>
								{k.label}
							</option>
						))}
					</select>
					<input className={inputCls(dark)} placeholder="https://" value={l.url} onChange={e => update(links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
					<button className="p-2 rounded-full hover:bg-[#ffffff18] cursor-pointer" title="Remove" onClick={() => update(links.filter((_, j) => j !== i))}>
						<TrashIcon className="size-4" />
					</button>
				</div>
			))}
			<div className="flex gap-2">
				<Button disabled={links.length >= 12} onClick={() => update([...links, { kind: LINK_KINDS.find(k => !links.some(l => l.kind === k.kind))?.kind ?? "website", url: "" }])}>
					<PlusIcon className="size-4" /> Add link
				</Button>
				{links.length > 0 && <Button onClick={() => update([])}>Use automatic links</Button>}
			</div>
		</Card>
	);
};

// --- Artist Pick ---

const PickTab = ({ draft, set, catalog }: { draft: ProfileEdit; set: (p: ProfileEdit) => void; catalog: ArtistDetail | null }) => {
	const dark = useDark();
	const pick = draft.pick ?? null;
	const tracks = catalog?.tracks ?? [];
	const choose = (p: ArtistPick | null) => set({ pick: p });
	return (
		<div className="grid lg:grid-cols-[1fr_1.2fr] gap-4">
			<Card className="flex flex-col gap-3">
				<h2 className="font-bold">Artist Pick</h2>
				<p className="text-xs text-(--text-tertiary)">Pinned at the top of your page with a note from you.</p>
				{pick ? (
					<div className="flex items-center gap-3 p-3 rounded-xl bg-black/20">
						{pick.artwork ? <img src={pick.artwork} alt="" className="size-16 rounded-lg object-cover" /> : <div className="size-16 rounded-lg bg-(--tertiary)" />}
						<div className="flex flex-col min-w-0 flex-1">
							<span className="text-[10px] font-bold uppercase tracking-wider text-(--text-tertiary)">Artist Pick</span>
							<span className="font-bold truncate">{pick.title}</span>
							<span className="text-xs text-(--text-tertiary) truncate">{pick.artist}</span>
						</div>
						<button className="p-1.5 rounded-full hover:bg-[#ffffff18] cursor-pointer" title="Remove pick" onClick={() => choose(null)}>
							<XMarkIcon className="size-4" />
						</button>
					</div>
				) : (
					<div className="p-4 rounded-xl text-sm text-(--text-tertiary) bg-black/10">No pick yet — choose a song.</div>
				)}
				<Field label="Note">
					<input className={inputCls(dark)} maxLength={280} disabled={!pick} value={pick?.note ?? ""} placeholder="New single out now 🔥" onChange={e => pick && choose({ ...pick, note: e.target.value })} />
				</Field>
			</Card>
			<Card className="flex flex-col gap-1">
				<h2 className="font-bold mb-1">Your songs</h2>
				{!catalog && <span className="text-sm text-(--text-tertiary)">Loading…</span>}
				{tracks.map(t => (
					<button
						key={t.id}
						className={`flex items-center gap-3 p-2 rounded-xl text-left cursor-pointer duration-150 ${pick?.title === t.title ? (dark ? "bg-[#ffffff1a]" : "bg-[#00000012]") : dark ? "hover:bg-[#ffffff10]" : "hover:bg-[#0000000a]"}`}
						onClick={() => choose({ title: t.title, artist: t.artist, artwork: artworkHighRes(t.artwork), trackId: t.id, albumId: t.albumId, note: pick?.note })}
					>
						{t.artwork ? <img src={t.artwork} alt="" className="size-10 rounded object-cover" /> : <MusicalNoteIcon className="size-10 p-2" />}
						<div className="flex flex-col min-w-0">
							<span className="text-sm font-semibold truncate">{t.title}</span>
							<span className="text-xs text-(--text-tertiary) truncate">{t.album || t.artist}</span>
						</div>
					</button>
				))}
			</Card>
		</div>
	);
};

// --- Stats ---

const Bars = ({ data }: { data: { day: string; plays: number }[] }) => {
	const max = Math.max(1, ...data.map(d => d.plays));
	return (
		<div className="flex items-end gap-1 h-32">
			{data.map(d => (
				<div key={d.day} className="flex-1 flex flex-col justify-end h-full group relative" title={`${d.day}: ${d.plays} plays`}>
					<div className="rounded-t bg-[#3d91ff] group-hover:bg-[#6aaaff] duration-150 min-h-0.5" style={{ height: `${(d.plays / max) * 100}%` }} />
				</div>
			))}
		</div>
	);
};

export const StatCard = ({ label, value, sub }: { label: string; value: string | number; sub?: string }) => (
	<Card className="flex flex-col gap-0.5">
		<span className="text-xs font-semibold text-(--text-tertiary)">{label}</span>
		<span className="text-2xl font-black tabular-nums">{typeof value === "number" ? formatCount(value) : value}</span>
		{sub && <span className="text-[11px] text-(--text-tertiary)">{sub}</span>}
	</Card>
);

const StatsTab = ({ artistId, catalog }: { artistId: string; catalog: ArtistDetail | null }) => {
	const [stats, setStats] = useState<ArtistStats | null>(null);
	const [error, setError] = useState("");
	useEffect(() => {
		panel
			.stats(artistId)
			.then(setStats)
			.catch(e => setError(e.message));
	}, [artistId]);
	if (error) return <ErrorBox error={error} />;
	if (!stats) return <span className="text-sm text-(--text-tertiary)">Loading stats…</span>;
	return (
		<div className="flex flex-col gap-4">
			<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
				<StatCard label="Plays · 28 days" value={stats.plays28} sub={`${formatCount(stats.plays7)} in the last 7 days`} />
				<StatCard label="Listeners · 28 days" value={stats.listeners28} sub={`${formatCount(stats.listenersTotal)} all time`} />
				<StatCard label="Saves" value={stats.saves} sub="Added to Your Library" />
				<StatCard label="All-time plays" value={stats.totalPlays} sub="On Fracital" />
			</div>
			{(catalog?.artist.listeners || catalog?.artist.fans) && (
				<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
					{!!catalog?.artist.listeners && <StatCard label="Last.fm listeners" value={catalog.artist.listeners} sub="All platforms" />}
					{!!catalog?.artist.fans && <StatCard label="Deezer fans" value={catalog.artist.fans} />}
				</div>
			)}
			<Card className="flex flex-col gap-3">
				<h2 className="font-bold">Plays per day (last 28 days)</h2>
				<Bars data={stats.daily} />
			</Card>
			<Card className="flex flex-col gap-1">
				<h2 className="font-bold mb-1">Top songs · 28 days</h2>
				{stats.topSongs.length === 0 && <span className="text-sm text-(--text-tertiary)">No plays on Fracital yet. Plays count after 30 seconds of listening.</span>}
				{stats.topSongs.map((s, i) => (
					<div key={s.title} className="flex items-center gap-3 py-1.5 text-sm">
						<span className="w-5 text-right font-bold text-(--text-tertiary)">{i + 1}</span>
						<span className="flex-1 font-semibold truncate">{s.title}</span>
						<span className="text-(--text-tertiary) tabular-nums">{formatCount(s.listeners)} listeners</span>
						<span className="w-24 text-right font-semibold tabular-nums">{formatCount(s.plays)} plays</span>
					</div>
				))}
			</Card>
		</div>
	);
};

// --- Team ---

const TeamTab = ({
	artistId,
	role,
	members,
	invites,
	reload,
	onError,
}: {
	artistId: string;
	role: PageRole;
	members: Member[];
	invites: { code: string; role: PageRole; createdAt: string; expiresAt: string }[];
	reload: () => void;
	onError: (e: string) => void;
}) => {
	const dark = useDark();
	const [inviteRole, setInviteRole] = useState<"admin" | "editor">("editor");
	const [copied, setCopied] = useState("");
	const [meId, setMeId] = useState("");
	useEffect(() => {
		void getMe().then(m => setMeId(m?.user.id ?? ""));
	}, []);
	const canManage = role === "owner" || role === "admin";
	const rank = { editor: 1, admin: 2, owner: 3 };
	const inviteUrl = (code: string) => `${location.origin}/?artist-invite=${code}`;
	const run = (fn: () => Promise<unknown>) => fn().then(reload, e => onError(e instanceof Error ? e.message : "Something went wrong"));
	const copy = (code: string) => {
		void navigator.clipboard.writeText(inviteUrl(code));
		setCopied(code);
		window.setTimeout(() => setCopied(""), 1500);
	};

	return (
		<div className="grid lg:grid-cols-2 gap-4">
			<Card className="flex flex-col gap-2">
				<h2 className="font-bold">Team</h2>
				{members.map(m => (
					<div key={m.userId} className="flex items-center gap-3 py-1">
						{m.image ? <img src={m.image} alt="" className="size-9 rounded-full object-cover" /> : <div className="size-9 rounded-full bg-(--tertiary) flex items-center justify-center font-bold">{m.name.charAt(0)}</div>}
						<div className="flex flex-col flex-1 min-w-0">
							<span className="text-sm font-semibold truncate">
								{m.name}
								{m.userId === meId && " (you)"}
							</span>
							<span className="text-xs text-(--text-tertiary) truncate">{m.email ?? "Last.fm account"}</span>
						</div>
						<span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#3d91ff]/15 text-[#6aaaff]">{roleLabel[m.role]}</span>
						{m.role !== "owner" && (m.userId === meId || rank[role] > rank[m.role]) && (
							<button className="p-1.5 rounded-full hover:bg-[#ffffff18] cursor-pointer" title={m.userId === meId ? "Leave page" : "Remove"} onClick={() => run(() => panel.removeMember(artistId, m.userId))}>
								<TrashIcon className="size-4" />
							</button>
						)}
					</div>
				))}
			</Card>
			{canManage && (
				<Card className="flex flex-col gap-3">
					<h2 className="font-bold">Invite people</h2>
					<p className="text-xs text-(--text-tertiary)">Create a link and send it to your team. Each link works once and expires after 7 days. Editors can change the page and see stats; admins can also invite and remove people.</p>
					<div className="flex gap-2">
						<select className={inputCls(dark)} value={inviteRole} onChange={e => setInviteRole(e.target.value as "admin" | "editor")}>
							<option value="editor">Editor</option>
							<option value="admin">Admin</option>
						</select>
						<Button kind="primary" onClick={() => run(() => panel.invite(artistId, inviteRole))}>
							Create link
						</Button>
					</div>
					{invites.map(inv => (
						<div key={inv.code} className="flex items-center gap-2 p-2 rounded-xl bg-black/15 text-sm">
							<span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#3d91ff]/15 text-[#6aaaff]">{roleLabel[inv.role]}</span>
							<span className="flex-1 truncate font-mono text-xs">{inviteUrl(inv.code)}</span>
							<button className="p-1.5 rounded-full hover:bg-[#ffffff18] cursor-pointer" title="Copy link" onClick={() => copy(inv.code)}>
								{copied === inv.code ? <CheckBadgeIcon className="size-4 text-green-400" /> : <ClipboardDocumentIcon className="size-4" />}
							</button>
							<button className="p-1.5 rounded-full hover:bg-[#ffffff18] cursor-pointer" title="Revoke" onClick={() => run(() => panel.revokeInvite(artistId, inv.code))}>
								<XMarkIcon className="size-4" />
							</button>
						</div>
					))}
				</Card>
			)}
		</div>
	);
};

/** Who you're signed in as, with inline editing of display name, username and picture. */
const AccountStrip = () => {
	const [me, setMe] = useState<Me | null>(null);
	const [editing, setEditing] = useState(false);
	useEffect(() => {
		void getMe().then(setMe);
	}, []);
	if (!me) return null;
	const avatar = me.user.image || me.lastfm?.image;
	return (
		<div className="flex flex-col gap-3">
			<Card className="flex items-center gap-3">
				{avatar ? <img src={avatar} alt="" className="size-11 rounded-full object-cover" /> : <div className="size-11 rounded-full bg-(--tertiary) flex items-center justify-center font-bold">{me.user.name.charAt(0)}</div>}
				<div className="flex flex-col flex-1 min-w-0">
					<span className="font-bold truncate">{me.user.name}</span>
					<span className="text-xs text-(--text-tertiary) truncate">{me.username ? `@${me.username}` : (me.user.email ?? "Fracital Account")}</span>
				</div>
				<Button onClick={() => setEditing(e => !e)}>{editing ? "Done" : "Edit profile"}</Button>
			</Card>
			{editing && <ProfileEditor me={me} onChange={m => m && setMe(m)} />}
		</div>
	);
};
