import { ArrowLeftStartOnRectangleIcon, CheckCircleIcon, UserCircleIcon } from "@heroicons/react/24/solid";
import { faLastfm } from "@fortawesome/free-brands-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { createId } from "@paralleldrive/cuid2";
import { useEffect, useRef, useState } from "react";
import { Input } from "../components/Input";
import { HolyText } from "../components/common/HolyText";
import { connectLastfm, disconnectLastfm, getMe, refreshMe, signIn, signOut, signUp, updateProfile, uploadAvatar, type Me } from "../libs/auth";
import { formatCount } from "../libs/music-service";
import { useTabsStore } from "../store";

interface AccountProps {
	query?: string;
}

const LASTFM_RED = "#d51007";

const LastfmButton = ({ label, busy, onClick }: { label: string; busy?: boolean; onClick: () => void }) => (
	<button
		className="flex items-center justify-center gap-2 w-full p-2.5 rounded-lg font-semibold text-white hover:brightness-110 disabled:opacity-60 duration-150 cursor-pointer"
		style={{ backgroundColor: LASTFM_RED }}
		disabled={busy}
		onClick={onClick}
	>
		<FontAwesomeIcon icon={faLastfm} className="size-5" />
		{busy ? "Waiting for Last.fm…" : label}
	</button>
);

/** about:account — Fracital Accounts sign-in / sign-up, and account management once signed in. */
export const Account = ({ query }: AccountProps) => {
	const [me, setMe] = useState<Me | null | undefined>(undefined);

	useEffect(() => {
		let alive = true;
		const load = () => getMe().then(m => alive && setMe(m));
		void load();
		const onUpdate = () => void getMe().then(m => alive && setMe(m));
		window.addEventListener("account-upd", onUpdate);
		return () => {
			alive = false;
			window.removeEventListener("account-upd", onUpdate);
		};
	}, []);

	if (me === undefined) return <div className="flex items-center justify-center size-full text-(--text-tertiary)">Loading…</div>;
	return me ? <Manage me={me} onChange={setMe} /> : <SignIn initialPage={query === "register" ? "register" : "login"} onSignedIn={setMe} />;
};

export interface SignInBranding {
	icon?: React.ReactNode;
	loginTitle: string;
	registerTitle: string;
	subtitle: string;
}

const DEFAULT_BRANDING: SignInBranding = {
	loginTitle: "Sign in to Fracital",
	registerTitle: "Create a Fracital Account",
	subtitle: "Sync your settings and build your library from Last.fm.",
};

/** Sign in / register with a Fracital Account. Reused by Fracital for Artists with its own branding. */
export const SignIn = ({ initialPage, onSignedIn, branding = DEFAULT_BRANDING }: { initialPage: "login" | "register"; onSignedIn: (me: Me | null) => void; branding?: SignInBranding }) => {
	const [page, setPage] = useState<"login" | "register">(initialPage);
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [loading, setLoading] = useState(false);
	const [lastfmBusy, setLastfmBusy] = useState(false);
	const [error, setError] = useState("");

	const finish = async () => {
		const me = await refreshMe();
		onSignedIn(me);
		// Pull this account's synced settings, if it has any.
		await window.fr?.sync.get().catch(() => false);
	};

	const submit = async () => {
		setError("");
		if (!email || !password || (page === "register" && !name)) return setError("Please fill in all fields");
		setLoading(true);
		const res =
			page === "login"
				? await signIn.email({ email, password })
				: await signUp.email({ name, email, password });
		setLoading(false);
		if (res.error) return setError(res.error.message || (page === "login" ? "Sign-in failed" : "Registration failed"));
		await finish();
		// A brand-new account starts syncing this device's settings.
		if (page === "register") await window.fr?.sync.set().catch(() => {});
	};

	const withLastfm = async () => {
		setError("");
		setLastfmBusy(true);
		try {
			await connectLastfm("signin");
			await finish();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Last.fm sign-in failed");
		} finally {
			setLastfmBusy(false);
		}
	};

	return (
		<div className="flex flex-col items-center justify-center size-full gap-5">
			<div className="flex flex-col items-center gap-2">
				{branding.icon ?? <img src="/icon.svg" alt="" className="size-14" />}
				<h1 className="text-2xl font-bold"><HolyText text={page === "login" ? branding.loginTitle : branding.registerTitle} /></h1>
				<p className="text-sm text-(--text-tertiary) text-center max-w-sm"><HolyText text={branding.subtitle} /></p>
			</div>
			<div className="flex flex-col items-center gap-3 w-full max-w-sm">
				{error && <div className="w-full p-2 bg-red-500/20 border border-red-500/50 rounded-md text-sm text-red-300">{error}</div>}
				<LastfmButton label={page === "login" ? "Continue with Last.fm" : "Sign up with Last.fm"} busy={lastfmBusy} onClick={withLastfm} />
				<div className="flex items-center gap-3 w-full text-xs text-(--text-tertiary)">
					<span className="flex-1 h-px bg-(--text-tertiary) opacity-30" />
					or with email
					<span className="flex-1 h-px bg-(--text-tertiary) opacity-30" />
				</div>
				{page === "register" && <Input title="Name" type="text" value={name} onChange={e => setName(e.target.value)} />}
				<Input title="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} />
				<Input title="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} />
				<button className="flex items-center justify-center w-full p-2.5 bg-(--accent) rounded-lg font-semibold opacity-80 hover:opacity-100 disabled:opacity-50 cursor-pointer duration-150" onClick={submit} disabled={loading}>
					{loading ? "Loading…" : page === "login" ? "Sign in" : "Create account"}
				</button>
			</div>
			<div className="flex items-center gap-1 text-sm">
				<span className="opacity-70">{page === "login" ? "Don't have an account?" : "Have an account?"}</span>
				<button
					className="font-semibold opacity-85 hover:opacity-100 cursor-pointer duration-150"
					onClick={() => {
						setError("");
						setPage(page === "login" ? "register" : "login");
					}}
				>
					{page === "login" ? "Register" : "Sign in"}
				</button>
			</div>
		</div>
	);
};

const Manage = ({ me, onChange }: { me: Me; onChange: (me: Me | null) => void }) => {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const newTab = useTabsStore(state => state.newTab);
	const avatar = me.user.image || me.lastfm?.image;

	const run = async (fn: () => Promise<unknown>) => {
		setError("");
		setBusy(true);
		try {
			await fn();
			onChange(await getMe());
		} catch (err) {
			setError(err instanceof Error ? err.message : "Something went wrong");
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="flex flex-col items-center size-full overflow-auto p-6">
			<div className="flex flex-col gap-4 w-full max-w-lg">
				<div className="flex items-center gap-4 p-4 rounded-2xl bg-(--tertiary)">
					{avatar ? <img src={avatar} alt="" className="size-16 rounded-full object-cover" /> : <UserCircleIcon className="size-16 text-(--text-secondary)" />}
					<div className="flex flex-col min-w-0">
						<h1 className="text-2xl font-bold truncate">{me.user.name}</h1>
						{me.username && <span className="text-sm font-semibold text-(--text-secondary) truncate">@{me.username}</span>}
						<span className="text-sm text-(--text-tertiary) truncate">{me.user.email ?? (me.lastfm ? `Signed in with Last.fm (@${me.lastfm.username})` : "")}</span>
					</div>
				</div>

				{error && <div className="p-2 bg-red-500/20 border border-red-500/50 rounded-md text-sm text-red-300">{error}</div>}

				<ProfileEditor me={me} onChange={onChange} />

				<section className="flex flex-col gap-3 p-4 rounded-2xl bg-(--tertiary)">
					<h2 className="font-bold">Connected services</h2>
					<div className="flex items-center gap-3">
						<div className="flex items-center justify-center size-10 rounded-full text-white" style={{ backgroundColor: LASTFM_RED }}>
							<FontAwesomeIcon icon={faLastfm} className="size-5" />
						</div>
						{me.lastfm ? (
							<>
								<div className="flex flex-col flex-1 min-w-0">
									<span className="flex items-center gap-1.5 font-semibold">
										Last.fm <CheckCircleIcon className="size-4 text-green-500" />
									</span>
									<button
										className="text-left text-sm text-(--text-tertiary) hover:underline truncate cursor-pointer"
										onClick={() => newTab({ id: createId(), title: "Last.fm", url: me.lastfm!.url, displayUrl: me.lastfm!.url, icon: null, current: true })}
									>
										@{me.lastfm.username} · {formatCount(me.lastfm.playcount)} scrobbles
									</button>
								</div>
								{me.hasPassword && (
									<button className="text-sm font-semibold px-3 py-1.5 rounded-full bg-[#ffffff15] hover:bg-[#ffffff25] disabled:opacity-50 cursor-pointer duration-150" disabled={busy} onClick={() => run(disconnectLastfm)}>
										Disconnect
									</button>
								)}
							</>
						) : (
							<>
								<div className="flex flex-col flex-1 min-w-0">
									<span className="font-semibold">Last.fm</span>
									<span className="text-sm text-(--text-tertiary)">Build your library, see your play counts, and scrobble what you play.</span>
								</div>
								<button
									className="text-sm font-semibold px-3 py-1.5 rounded-full text-white hover:brightness-110 disabled:opacity-50 cursor-pointer duration-150"
									style={{ backgroundColor: LASTFM_RED }}
									disabled={busy || !me.lastfmAvailable}
									title={me.lastfmAvailable ? undefined : "Last.fm isn't configured on this server"}
									onClick={() => run(() => connectLastfm("link"))}
								>
									{busy ? "Waiting…" : "Connect"}
								</button>
							</>
						)}
					</div>
				</section>

				<button
					className="flex items-center justify-center gap-2 p-2.5 rounded-xl font-semibold text-(--text-secondary) bg-(--tertiary) hover:text-[#d03b3b] cursor-pointer duration-150"
					onClick={async () => {
						await signOut();
						onChange(null);
					}}
				>
					<ArrowLeftStartOnRectangleIcon className="size-5" /> Sign out
				</button>
			</div>
		</div>
	);
};

/** Display name, username and profile picture. */
export const ProfileEditor = ({ me, onChange }: { me: Me; onChange: (me: Me | null) => void }) => {
	const [name, setName] = useState(me.user.name);
	const [username, setUsername] = useState(me.username ?? "");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [saved, setSaved] = useState(false);
	const fileRef = useRef<HTMLInputElement>(null);
	const avatar = me.user.image || me.lastfm?.image;
	const dirty = name.trim() !== me.user.name || username.trim().toLowerCase() !== (me.username ?? "");
	const inputCls = "w-full px-3 py-2 rounded-xl text-sm outline-none bg-[#ffffff10] focus:bg-[#ffffff18] duration-150";

	const run = async (fn: () => Promise<Me | null>) => {
		setError("");
		setSaved(false);
		setBusy(true);
		try {
			onChange(await fn());
			setSaved(true);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Something went wrong");
		} finally {
			setBusy(false);
		}
	};

	return (
		<section className="flex flex-col gap-3 p-4 rounded-2xl bg-(--tertiary)">
			<h2 className="font-bold">Profile</h2>
			{error && <div className="p-2 bg-red-500/20 border border-red-500/50 rounded-md text-sm text-red-300">{error}</div>}
			<div className="flex items-center gap-4">
				<button className="group relative shrink-0 rounded-full cursor-pointer" title="Change profile picture" onClick={() => fileRef.current?.click()} disabled={busy}>
					{avatar ? <img src={avatar} alt="" className="size-20 rounded-full object-cover" /> : <UserCircleIcon className="size-20 text-(--text-secondary)" />}
					<span className="absolute inset-0 hidden group-hover:flex items-center justify-center rounded-full bg-black/50 text-white text-xs font-semibold">Change</span>
				</button>
				<div className="flex flex-col gap-1.5 text-xs text-(--text-tertiary)">
					<span>Any image size works; it's resized automatically.</span>
					{me.user.image && (
						<button className="w-max font-semibold hover:text-(--text-primary) cursor-pointer" onClick={() => run(() => updateProfile({ image: null }))} disabled={busy}>
							Remove picture
						</button>
					)}
				</div>
				<input
					ref={fileRef}
					type="file"
					accept="image/*"
					className="hidden"
					onChange={e => {
						const file = e.target.files?.[0];
						e.target.value = "";
						if (file) void run(() => uploadAvatar(file));
					}}
				/>
			</div>
			<label className="flex flex-col gap-1.5">
				<span className="text-sm font-semibold">Display name</span>
				<input className={inputCls} maxLength={50} value={name} onChange={e => setName(e.target.value)} />
			</label>
			<label className="flex flex-col gap-1.5">
				<span className="text-sm font-semibold">Username</span>
				<div className="flex items-center gap-1 px-3 rounded-xl bg-[#ffffff10] focus-within:bg-[#ffffff18]">
					<span className="text-sm text-(--text-tertiary)">@</span>
					<input className="flex-1 py-2 bg-transparent outline-none text-sm" maxLength={30} value={username} placeholder="yourname" onChange={e => setUsername(e.target.value.replace(/[^a-zA-Z0-9_.]/g, ""))} />
				</div>
				<span className="text-xs text-(--text-tertiary)">3–30 characters: letters, numbers, _ and .</span>
			</label>
			<button
				className="w-max px-4 py-2 rounded-full text-sm font-semibold bg-white text-black hover:bg-white/90 disabled:opacity-50 cursor-pointer duration-150"
				disabled={!dirty || busy}
				onClick={() => run(() => updateProfile({ name: name.trim(), username: username.trim() ? username.trim().toLowerCase() : null }))}
			>
				{busy ? "Saving…" : saved && !dirty ? "Saved ✓" : "Save profile"}
			</button>
		</section>
	);
};
