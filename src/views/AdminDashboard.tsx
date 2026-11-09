import { CheckBadgeIcon, CheckIcon, MagnifyingGlassIcon, NoSymbolIcon, ShieldCheckIcon, TrashIcon, XMarkIcon } from "@heroicons/react/24/solid";
import { createId } from "@paralleldrive/cuid2";
import { useEffect, useState } from "react";
import { admin, type AdminClaim, type AdminUser } from "../libs/artistPanel";
import { getMe } from "../libs/auth";
import { formatCount, searchTracks, type MusicArtist } from "../libs/music-service";
import { useSettingsStore, useTabsStore } from "../store";
import { StatCard } from "./ArtistPanel";

type Tab = "overview" | "claims" | "artists" | "users";

const openTab = (url: string, title: string) => useTabsStore.getState().newTab({ id: createId(), url, displayUrl: url, title, icon: null, current: true });
const ago = (d: string | null) => {
	if (!d) return "never";
	const s = (Date.now() - new Date(d).getTime()) / 1000;
	if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
	if (s < 86400) return `${Math.round(s / 3600)}h ago`;
	return `${Math.round(s / 86400)}d ago`;
};

/** about:admin — claims review, verified artists, users and overview stats. Admins only. */
export const AdminDashboard = ({ query }: { query?: string }) => {
	const dark = useSettingsStore(s => s.settings.brightness) !== "light";
	const initial = (new URLSearchParams(query || "").get("tab") as Tab) || "overview";
	const [tab, setTab] = useState<Tab>(["overview", "claims", "artists", "users"].includes(initial) ? initial : "overview");
	const [allowed, setAllowed] = useState<boolean | undefined>(undefined);

	useEffect(() => {
		void getMe().then(m => setAllowed(!!m?.isAdmin));
	}, []);

	if (allowed === undefined) return <div className="flex items-center justify-center size-full text-(--text-tertiary)">Loading…</div>;
	if (!allowed) {
		return (
			<div className="flex flex-col items-center justify-center size-full gap-2 text-center p-6">
				<ShieldCheckIcon className="size-12 opacity-40" />
				<h1 className="text-xl font-bold">Admins only</h1>
				<p className="text-sm text-(--text-tertiary)">Sign in with an admin account to use the dashboard.</p>
			</div>
		);
	}

	const chip = (active: boolean) => `px-3.5 py-2 rounded-full text-sm font-semibold cursor-pointer duration-150 ${active ? (dark ? "bg-white text-black" : "bg-black text-white") : dark ? "bg-[#ffffff12] hover:bg-[#ffffff20]" : "bg-[#0000000c] hover:bg-[#00000016]"}`;

	return (
		<div className="size-full overflow-auto p-6">
			<div className="flex flex-col gap-5 max-w-6xl mx-auto">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<h1 className="text-3xl font-black flex items-center gap-2">
						<ShieldCheckIcon className="size-8" /> Admin Dashboard
					</h1>
					<div className="flex gap-1.5">
						{(["overview", "claims", "artists", "users"] as Tab[]).map(t => (
							<button key={t} className={`${chip(tab === t)} capitalize`} onClick={() => setTab(t)}>
								{t}
							</button>
						))}
					</div>
				</div>
				{tab === "overview" && <Overview dark={dark} goTo={setTab} />}
				{tab === "claims" && <Claims dark={dark} chip={chip} />}
				{tab === "artists" && <Artists dark={dark} />}
				{tab === "users" && <Users dark={dark} />}
			</div>
		</div>
	);
};

const Panel = ({ dark, children, className = "" }: { dark: boolean; children: React.ReactNode; className?: string }) => <div className={`rounded-2xl p-4 ${dark ? "bg-[#ffffff0d]" : "bg-[#00000008]"} ${className}`}>{children}</div>;

const Btn = ({ children, onClick, kind = "secondary", disabled, title }: { children: React.ReactNode; onClick: () => void; kind?: "primary" | "secondary" | "danger" | "good"; disabled?: boolean; title?: string }) => {
	const cls = kind === "primary" ? "bg-white text-black hover:bg-white/90" : kind === "danger" ? "bg-red-500/15 text-red-400 hover:bg-red-500/25" : kind === "good" ? "bg-green-500/15 text-green-400 hover:bg-green-500/25" : "bg-[#ffffff14] hover:bg-[#ffffff24]";
	return (
		<button title={title} disabled={disabled} onClick={onClick} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold disabled:opacity-50 cursor-pointer duration-150 ${cls}`}>
			{children}
		</button>
	);
};

const Err = ({ e }: { e: string }) => (e ? <div className="p-2.5 rounded-xl bg-red-500/15 border border-red-500/40 text-sm text-red-300">{e}</div> : null);

// --- Overview ---

const Overview = ({ dark, goTo }: { dark: boolean; goTo: (t: Tab) => void }) => {
	const [data, setData] = useState<Awaited<ReturnType<typeof admin.overview>> | null>(null);
	const [error, setError] = useState("");
	useEffect(() => {
		admin
			.overview()
			.then(setData)
			.catch(e => setError(e.message));
	}, []);
	if (error) return <Err e={error} />;
	if (!data) return <span className="text-sm text-(--text-tertiary)">Loading…</span>;
	const max = Math.max(1, ...data.daily.map(d => d.plays));
	return (
		<div className="flex flex-col gap-4">
			{data.pending_claims > 0 && (
				<button className="flex items-center gap-3 p-4 rounded-2xl bg-yellow-500/15 text-yellow-200 text-left cursor-pointer hover:bg-yellow-500/20" onClick={() => goTo("claims")}>
					<CheckBadgeIcon className="size-6" />
					<span className="flex-1 font-semibold">
						{data.pending_claims} artist claim{data.pending_claims === 1 ? "" : "s"} waiting for review
					</span>
					<span className="text-sm">Review →</span>
				</button>
			)}
			<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
				<StatCard label="Users" value={data.users} sub={`+${data.new_users7} this week`} />
				<StatCard label="Verified artists" value={data.verified_artists} sub={`${data.pending_claims} pending claims`} />
				<StatCard label="Plays · 7 days" value={data.plays7} sub={`${formatCount(data.plays1)} today · ${formatCount(data.plays28)} in 28 days`} />
				<StatCard label="Listeners · 7 days" value={data.listeners7} sub={`${data.banned} banned accounts`} />
			</div>
			<div className="grid lg:grid-cols-[1.6fr_1fr] gap-4">
				<Panel dark={dark} className="flex flex-col gap-3">
					<h2 className="font-bold">Plays per day (last 28 days)</h2>
					<div className="flex items-end gap-1 h-36">
						{data.daily.map(d => (
							<div key={d.day} className="flex-1 flex flex-col justify-end h-full" title={`${d.day}: ${d.plays} plays`}>
								<div className="rounded-t bg-[#3d91ff] min-h-0.5" style={{ height: `${(d.plays / max) * 100}%` }} />
							</div>
						))}
					</div>
				</Panel>
				<Panel dark={dark} className="flex flex-col gap-1">
					<h2 className="font-bold mb-1">Top artists · 7 days</h2>
					{data.topArtists.length === 0 && <span className="text-sm text-(--text-tertiary)">No plays yet.</span>}
					{data.topArtists.map((a, i) => (
						<div key={a.artist} className="flex items-center gap-3 text-sm py-1">
							<span className="w-5 text-right font-bold text-(--text-tertiary)">{i + 1}</span>
							<span className="flex-1 truncate font-semibold">{a.artist}</span>
							<span className="tabular-nums text-(--text-tertiary)">{formatCount(a.plays)} plays</span>
						</div>
					))}
				</Panel>
			</div>
		</div>
	);
};

// --- Claims ---

const Claims = ({ dark, chip }: { dark: boolean; chip: (a: boolean) => string }) => {
	const [status, setStatus] = useState<"pending" | "approved" | "rejected">("pending");
	const [claims, setClaims] = useState<AdminClaim[] | null>(null);
	const [notes, setNotes] = useState<Record<number, string>>({});
	const [error, setError] = useState("");
	const load = () =>
		admin
			.claims(status)
			.then(r => setClaims(r.claims))
			.catch(e => setError(e.message));
	useEffect(() => {
		void load();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [status]);
	const review = (c: AdminClaim, action: "approve" | "reject") =>
		admin
			.review(c.id, action, notes[c.id] ?? "")
			.then(load)
			.catch(e => setError(e.message));

	return (
		<div className="flex flex-col gap-3">
			<div className="flex gap-1.5">
				{(["pending", "approved", "rejected"] as const).map(s => (
					<button
						key={s}
						className={`${chip(status === s)} capitalize`}
						onClick={() => {
							if (s === status) return;
							setClaims(null);
							setStatus(s);
						}}
					>
						{s}
					</button>
				))}
			</div>
			<Err e={error} />
			{!claims ? (
				<span className="text-sm text-(--text-tertiary)">Loading…</span>
			) : claims.length === 0 ? (
				<Panel dark={dark} className="text-sm text-(--text-tertiary)">
					No {status} claims.
				</Panel>
			) : (
				claims.map(c => (
					<Panel key={c.id} dark={dark} className="flex flex-col gap-3">
						<div className="flex flex-wrap items-start justify-between gap-3">
							<div className="flex flex-col">
								<button className="text-lg font-bold text-left hover:underline cursor-pointer" onClick={() => openTab(`about:library?artist=${encodeURIComponent(c.artistId)}`, c.artistName)}>
									{c.artistName}
								</button>
								<span className="text-xs text-(--text-tertiary)">
									Claimed as <b>{c.roleTitle}</b> · {ago(c.createdAt)}
									{c.existingMembers > 0 && ` · page already has ${c.existingMembers} manager${c.existingMembers === 1 ? "" : "s"}`}
								</span>
							</div>
							<div className="flex items-center gap-2 text-sm">
								{c.user.image ? <img src={c.user.image} alt="" className="size-8 rounded-full object-cover" /> : <div className="size-8 rounded-full bg-(--tertiary)" />}
								<div className="flex flex-col leading-tight">
									<span className="font-semibold">{c.user.name}</span>
									<span className="text-xs text-(--text-tertiary)">
										{c.user.email} · joined {ago(c.user.createdAt)}
									</span>
								</div>
							</div>
						</div>
						<div className="grid md:grid-cols-2 gap-3 text-sm">
							<div className="flex flex-col gap-1">
								<span className="text-xs font-semibold text-(--text-tertiary)">Contact</span>
								<a className="hover:underline w-max" href={`mailto:${c.contactEmail}`}>
									{c.contactEmail}
								</a>
								<span className="text-xs font-semibold text-(--text-tertiary) mt-1">Official links</span>
								{c.proofLinks.map(l => (
									<button key={l} className="text-left text-[#6aaaff] hover:underline truncate cursor-pointer" onClick={() => openTab(l, "Claim proof")}>
										{l}
									</button>
								))}
							</div>
							<div className="flex flex-col gap-1">
								<span className="text-xs font-semibold text-(--text-tertiary)">Message</span>
								<p className="whitespace-pre-wrap">{c.message || <span className="text-(--text-tertiary)">—</span>}</p>
								{c.adminNote && <p className="text-xs text-(--text-tertiary) mt-1">Admin note: {c.adminNote}</p>}
							</div>
						</div>
						{c.status === "pending" && (
							<div className="flex flex-wrap items-center gap-2">
								<input className={`flex-1 min-w-48 px-3 py-1.5 rounded-full text-sm outline-none ${dark ? "bg-[#ffffff10]" : "bg-[#00000008]"}`} placeholder="Note to the claimant (optional)" value={notes[c.id] ?? ""} onChange={e => setNotes(n => ({ ...n, [c.id]: e.target.value }))} />
								<Btn kind="good" onClick={() => review(c, "approve")}>
									<CheckIcon className="size-4" /> Approve
								</Btn>
								<Btn kind="danger" onClick={() => review(c, "reject")}>
									<XMarkIcon className="size-4" /> Reject
								</Btn>
							</div>
						)}
					</Panel>
				))
			)}
		</div>
	);
};

// --- Artists ---

const Artists = ({ dark }: { dark: boolean }) => {
	const [list, setList] = useState<Awaited<ReturnType<typeof admin.artists>>["artists"] | null>(null);
	const [error, setError] = useState("");
	const [q, setQ] = useState("");
	const [results, setResults] = useState<MusicArtist[]>([]);
	const load = () =>
		admin
			.artists()
			.then(r => setList(r.artists))
			.catch(e => setError(e.message));
	useEffect(() => {
		void load();
	}, []);
	const run = (fn: () => Promise<unknown>) => fn().then(load, e => setError(e.message));

	return (
		<div className="flex flex-col gap-3">
			<Err e={error} />
			<Panel dark={dark} className="flex flex-col gap-2">
				<h2 className="font-bold">Find any artist</h2>
				<p className="text-xs text-(--text-tertiary)">Edit any page directly, or verify it without a claim.</p>
				<div className={`flex items-center gap-2 px-3 py-2 rounded-xl ${dark ? "bg-[#ffffff10]" : "bg-[#00000008]"}`}>
					<MagnifyingGlassIcon className="size-4 opacity-60" />
					<input
						className="flex-1 bg-transparent outline-none text-sm"
						placeholder="Search artists"
						value={q}
						onChange={e => setQ(e.target.value)}
						onKeyDown={e => {
							if (e.key === "Enter" && q.trim())
								searchTracks(q, 5)
									.then(r => setResults(r.artists ?? []))
									.catch(() => setResults([]));
						}}
					/>
				</div>
				{results.map(a => (
					<div key={a.id} className="flex items-center gap-3 py-1">
						{a.picture ? <img src={a.picture} alt="" className="size-9 rounded-full object-cover" /> : <div className="size-9 rounded-full bg-(--tertiary)" />}
						<span className="flex-1 font-semibold text-sm">{a.name}</span>
						<Btn onClick={() => openTab(`about:artists?page=${encodeURIComponent(a.id)}`, a.name)}>Edit page</Btn>
						<Btn kind="good" onClick={() => run(() => admin.verify(a.id, a.name))}>
							<CheckBadgeIcon className="size-4" /> Verify
						</Btn>
					</div>
				))}
			</Panel>
			{!list ? (
				<span className="text-sm text-(--text-tertiary)">Loading…</span>
			) : list.length === 0 ? (
				<Panel dark={dark} className="text-sm text-(--text-tertiary)">
					No claimed or customized artist pages yet.
				</Panel>
			) : (
				<Panel dark={dark} className="flex flex-col divide-y divide-[#ffffff10]">
					{list.map(a => (
						<div key={a.artistId} className="flex flex-wrap items-center gap-3 py-2.5">
							{a.image ? <img src={a.image} alt="" className="size-10 rounded-full object-cover" /> : <div className="size-10 rounded-full bg-(--tertiary) flex items-center justify-center font-bold">{a.name.charAt(0)}</div>}
							<div className="flex flex-col flex-1 min-w-40">
								<span className="font-bold flex items-center gap-1">
									{a.name} {a.verified && <CheckBadgeIcon className="size-4 text-[#3d91ff]" />}
								</span>
								<span className="text-xs text-(--text-tertiary)">
									{a.verified ? `Verified ${ago(a.verifiedAt)}` : "Not verified"} · edited {ago(a.updatedAt)}
								</span>
							</div>
							<div className="flex flex-wrap gap-1">
								{a.members.map(m => (
									<span key={m.userId} className="flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-[11px] font-semibold bg-[#ffffff14]">
										{m.name} · {m.role}
										<button className="p-0.5 rounded-full hover:bg-[#ffffff24] cursor-pointer" title="Remove from page" onClick={() => run(() => admin.removeMember(a.artistId, m.userId))}>
											<XMarkIcon className="size-3" />
										</button>
									</span>
								))}
							</div>
							<Btn onClick={() => openTab(`about:artists?page=${encodeURIComponent(a.artistId)}`, a.name)}>Edit page</Btn>
							{a.verified ? (
								<Btn kind="danger" onClick={() => confirm(`Revoke ${a.name}? This removes the badge and every manager.`) && run(() => admin.revoke(a.artistId))}>
									<TrashIcon className="size-4" /> Revoke
								</Btn>
							) : (
								<Btn kind="good" onClick={() => run(() => admin.verify(a.artistId, a.name))}>
									<CheckBadgeIcon className="size-4" /> Verify
								</Btn>
							)}
						</div>
					))}
				</Panel>
			)}
		</div>
	);
};

// --- Users ---

const Users = ({ dark }: { dark: boolean }) => {
	const [q, setQ] = useState("");
	const [users, setUsers] = useState<AdminUser[] | null>(null);
	const [error, setError] = useState("");
	const load = (query = q) =>
		admin
			.users(query)
			.then(r => setUsers(r.users))
			.catch(e => setError(e.message));
	useEffect(() => {
		const t = window.setTimeout(() => void load(q), 300);
		return () => window.clearTimeout(t);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [q]);
	const update = (u: AdminUser, change: Parameters<typeof admin.updateUser>[1]) =>
		admin
			.updateUser(u.id, change)
			.then(() => load())
			.catch(e => setError(e.message));
	/** The last account deleted here: its data's download link, to pass on when it couldn't be emailed. */
	const [deleted, setDeleted] = useState<{ name: string; download: string; expires: string; emailed: boolean } | null>(null);
	const remove = (u: AdminUser) => {
		if (!confirm(`Delete ${u.name}'s account and all of its data?\n\nThey can download a copy for 30 days (we email them the link when the account has an email); then it's erased for good. This can't be undone.`)) return;
		setError("");
		admin
			.deleteUser(u.id)
			.then(res => (setDeleted({ name: u.name, ...res }), load()))
			.catch(e => setError(e.message));
	};

	return (
		<div className="flex flex-col gap-3">
			<div className={`flex items-center gap-2 px-3 py-2 rounded-xl ${dark ? "bg-[#ffffff10]" : "bg-[#00000008]"}`}>
				<MagnifyingGlassIcon className="size-4 opacity-60" />
				<input className="flex-1 bg-transparent outline-none text-sm" placeholder="Search by name or email" value={q} onChange={e => setQ(e.target.value)} />
			</div>
			<Err e={error} />
			{deleted && (
				<div className="flex flex-col gap-1.5 p-3 rounded-xl bg-green-500/10 border border-green-500/30 text-sm">
					<span>
						Deleted {deleted.name}'s account. {deleted.emailed ? "We emailed them a link to download their data." : "We couldn't email them (no email address on the account, or email isn't set up), so send them this link to download their data."} It works until{" "}
						{new Date(deleted.expires).toLocaleDateString()}.
					</span>
					<div className="flex gap-2">
						<input readOnly value={deleted.download} onFocus={e => e.currentTarget.select()} className="flex-1 min-w-0 px-2 py-1 rounded-lg text-xs bg-[#ffffff10] outline-none" />
						<Btn onClick={() => void navigator.clipboard?.writeText(deleted.download)}>Copy link</Btn>
						<Btn onClick={() => setDeleted(null)}>
							<XMarkIcon className="size-4" />
						</Btn>
					</div>
				</div>
			)}
			{!users ? (
				<span className="text-sm text-(--text-tertiary)">Loading…</span>
			) : (
				<Panel dark={dark} className="flex flex-col divide-y divide-[#ffffff10]">
					{users.length === 0 && <span className="text-sm text-(--text-tertiary)">No users found.</span>}
					{users.map(u => (
						<div key={u.id} className={`flex flex-wrap items-center gap-3 py-2.5 ${u.banned ? "opacity-60" : ""}`}>
							{u.image ? <img src={u.image} alt="" className="size-9 rounded-full object-cover" /> : <div className="size-9 rounded-full bg-(--tertiary) flex items-center justify-center font-bold">{u.name.charAt(0)}</div>}
							<div className="flex flex-col flex-1 min-w-48">
								<span className="font-semibold flex items-center gap-1.5">
									{u.name}
									{u.role === "admin" && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#3d91ff]/20 text-[#6aaaff]">ADMIN</span>}
									{u.premium && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-yellow-500/20 text-yellow-300">PREMIUM</span>}
									{u.banned && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-400">BANNED</span>}
								</span>
								<span className="text-xs text-(--text-tertiary)">
									{u.username ? `@${u.username} · ` : ""}
									{u.email} · joined {ago(u.createdAt)} · seen {ago(u.lastSeen)}
									{u.pages ? ` · manages ${u.pages} page${u.pages === 1 ? "" : "s"}` : ""}
									{u.banReason ? ` · banned: ${u.banReason}` : ""}
								</span>
							</div>
							<Btn onClick={() => update(u, { premium: !u.premium })} title="Premium accounts see no ads">
								{u.premium ? "Remove premium" : "Give premium"}
							</Btn>
							{u.role === "admin" ? (
								<Btn disabled={u.adminByEnv} title={u.adminByEnv ? "Admin via ADMIN_EMAILS on the server" : undefined} onClick={() => update(u, { role: "user" })}>
									Remove admin
								</Btn>
							) : (
								<Btn onClick={() => confirm(`Make ${u.name} an admin?`) && update(u, { role: "admin" })}>
									<ShieldCheckIcon className="size-4" /> Make admin
								</Btn>
							)}
							{u.banned ? (
								<Btn kind="good" onClick={() => update(u, { banned: false })}>
									Unban
								</Btn>
							) : (
								<Btn
									kind="danger"
									onClick={() => {
										const reason = prompt(`Ban ${u.name}? Optional reason:`);
										if (reason !== null) void update(u, { banned: true, reason });
									}}
								>
									<NoSymbolIcon className="size-4" /> Ban
								</Btn>
							)}
							<Btn kind="danger" disabled={u.role === "admin"} title={u.role === "admin" ? "Remove their admin role first" : "Delete the account and all of its data"} onClick={() => remove(u)}>
								<TrashIcon className="size-4" /> Delete
							</Btn>
						</div>
					))}
				</Panel>
			)}
		</div>
	);
};
