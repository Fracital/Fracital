import { ArrowLeftStartOnRectangleIcon, ArrowPathIcon, CheckCircleIcon, CubeTransparentIcon, ExclamationTriangleIcon, FingerPrintIcon, KeyIcon, UserCircleIcon } from "@heroicons/react/24/solid";
import { faDiscord, faGithub, faGoogle, faLastfm, faMicrosoft } from "@fortawesome/free-brands-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { createId } from "@paralleldrive/cuid2";
import { useEffect, useRef, useState } from "react";
import { Input } from "../components/Input";
import { HolyText } from "../components/common/HolyText";
import {
	addPasskey,
	connectLastfm,
	connectSocial,
	deletePasskey,
	disconnectLastfm,
	disconnectProvider,
	getAuthOptions,
	getMe,
	importLastfmLoved,
	listPasskeys,
	passkeysUsable,
	refreshLastfm,
	refreshMe,
	requestPasswordReset,
	resetPassword,
	sendVerificationEmail,
	signIn,
	signInWithPasskey,
	signOut,
	signUp,
	terbiumAuth,
	updateProfile,
	uploadAvatar,
	type AuthOptions,
	type Me,
	type PasskeyInfo,
	type SocialProvider,
} from "../libs/auth";
import { signInViaHandoff } from "../libs/authHandoff";
import { formatCount } from "../libs/music-service";
import { useSavedStore } from "../libs/savedLibrary";
import { pendingScrobbles } from "../libs/scrobbler";
import { useTabsStore } from "../store";

interface AccountProps {
	query?: string;
}

const LASTFM_RED = "#d51007";

const PROVIDERS: Record<SocialProvider, { label: string; icon: IconDefinition; bg: string; fg: string }> = {
	google: { label: "Google", icon: faGoogle, bg: "#ffffff", fg: "#1f1f1f" },
	discord: { label: "Discord", icon: faDiscord, bg: "#5865f2", fg: "#ffffff" },
	github: { label: "GitHub", icon: faGithub, bg: "#24292f", fg: "#ffffff" },
	microsoft: { label: "Microsoft", icon: faMicrosoft, bg: "#2f2f2f", fg: "#ffffff" },
};

const errorText = (err: unknown, fallback = "Something went wrong") => (err instanceof Error && err.message ? err.message : fallback);

const LastfmButton = ({ label, busy, onClick }: { label: string; busy?: boolean; onClick: () => void }) => (
	<button className="flex items-center justify-center gap-2 w-full p-2.5 rounded-lg font-semibold text-white hover:brightness-110 disabled:opacity-60 duration-150 cursor-pointer" style={{ backgroundColor: LASTFM_RED }} disabled={busy} onClick={onClick}>
		<FontAwesomeIcon icon={faLastfm} className="size-5" />
		<HolyText text={busy ? "Waiting for Last.fm…" : label} />
	</button>
);

const Banner = ({ kind, children }: { kind: "error" | "info" | "ok"; children: React.ReactNode }) => (
	<div className={`w-full p-2 rounded-md text-sm border ${kind === "error" ? "bg-red-500/20 border-red-500/50 text-red-300" : kind === "ok" ? "bg-green-500/15 border-green-500/40 text-green-300" : "bg-white/5 border-white/15 text-(--text-secondary)"}`}>{children}</div>
);

const pill = "text-sm font-semibold px-3 py-1.5 rounded-full bg-[#ffffff15] hover:bg-[#ffffff25] disabled:opacity-50 cursor-pointer duration-150 shrink-0";

function useAuthOptions() {
	const [options, setOptions] = useState<AuthOptions | null>(null);
	useEffect(() => {
		let alive = true;
		void getAuthOptions().then(o => alive && setOptions(o));
		return () => {
			alive = false;
		};
	}, []);
	return options;
}

/** about:account — Fracital Accounts sign-in / sign-up, and account management once signed in. */
export const Account = ({ query }: AccountProps) => {
	const [me, setMe] = useState<Me | null | undefined>(undefined);
	const params = new URLSearchParams(query || "");

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

	const notice = params.has("verified") ? "verified" : params.has("verify-error") ? "verify-error" : params.has("reset-error") ? "reset-error" : undefined;
	const resetToken = params.get("reset") || undefined;

	if (me === undefined) return <div className="flex items-center justify-center size-full text-(--text-tertiary)">Loading…</div>;
	// A reset link works signed in or out.
	if (resetToken || !me) return <SignIn initialPage={resetToken ? "reset" : params.has("register") ? "register" : "login"} resetToken={resetToken} notice={notice} onSignedIn={setMe} />;
	return <Manage me={me} notice={notice} onChange={setMe} />;
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

type SignInPage = "login" | "register" | "forgot" | "reset";

const NOTICES: Record<string, { kind: "error" | "ok"; text: string }> = {
	verified: { kind: "ok", text: "Your email is verified." },
	"verify-error": { kind: "error", text: "That verification link is invalid or expired. Sign in and send a new one from your account page." },
	"reset-error": { kind: "error", text: "That reset link is invalid or expired. Ask for a new one below." },
};

/** Sign in / register with a Fracital Account. Reused by Fracital for Artists with its own branding. */
export const SignIn = ({ initialPage, resetToken, notice, onSignedIn, branding = DEFAULT_BRANDING }: { initialPage: SignInPage; resetToken?: string; notice?: string; onSignedIn: (me: Me | null) => void; branding?: SignInBranding }) => {
	const options = useAuthOptions();
	const [page, setPage] = useState<SignInPage>(notice === "reset-error" ? "forgot" : initialPage);
	const [terbium, setTerbium] = useState(false);
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [confirm, setConfirm] = useState("");
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState("");
	const [info, setInfo] = useState(notice && NOTICES[notice]?.kind === "ok" ? NOTICES[notice].text : "");
	const noticeError = notice && NOTICES[notice]?.kind === "error" ? NOTICES[notice].text : "";

	const go = (next: SignInPage) => {
		setError("");
		setInfo("");
		setPage(next);
	};

	const finish = async () => {
		const me = await refreshMe();
		onSignedIn(me);
		// Pull this account's synced settings, if it has any.
		await window.fr?.sync.get().catch(() => false);
	};

	const run = async (key: string, fn: () => Promise<void>) => {
		setError("");
		setInfo("");
		setBusy(key);
		try {
			await fn();
		} catch (err) {
			setError(errorText(err));
		} finally {
			setBusy(null);
		}
	};

	const submit = () =>
		run("email", async () => {
			if (page === "forgot") {
				if (!email) throw new Error("Enter your email");
				await requestPasswordReset(email);
				setInfo("If an account uses that email, a reset link is on its way.");
				return;
			}
			if (page === "reset") {
				if (password.length < 8) throw new Error("Use at least 8 characters");
				if (password !== confirm) throw new Error("The passwords don't match");
				await resetPassword(resetToken!, password);
				// Resetting signs out every session, this one included.
				await refreshMe();
				setPassword("");
				setConfirm("");
				window.history.replaceState(null, "", window.location.pathname);
				setPage("login");
				setInfo("Your password was changed. Sign in with the new one.");
				return;
			}
			if (!email || !password || (page === "register" && !name)) throw new Error("Please fill in all fields");
			if (terbium) {
				await terbiumAuth(email, password, "signin");
				await finish();
				return;
			}
			const res = page === "login" ? await signIn.email({ email, password }) : await signUp.email({ name, email, password });
			if (res.error) throw new Error(res.error.message || (page === "login" ? "Sign-in failed" : "Registration failed"));
			await finish();
			// A brand-new account starts syncing this device's settings.
			if (page === "register") await window.fr?.sync.set().catch(() => {});
		});

	const title = page === "register" ? branding.registerTitle : page === "forgot" ? "Reset your password" : page === "reset" ? "Choose a new password" : terbium ? "Sign in with Terbium" : branding.loginTitle;
	const subtitle = page === "forgot" ? "We'll email you a link to choose a new password." : page === "reset" ? "Use at least 8 characters." : terbium ? "Use your Terbium Account email and password." : branding.subtitle;
	const credentialsPage = page === "login" || page === "register";
	const redirectOk = !!options?.redirectOk;
	// Off the auth host, redirect-based methods sign in there through a proxy tab instead.
	const handoff = redirectOk ? null : options?.handoff || null;
	const redirectSignIn = (method: string, direct: () => Promise<void>) => (handoff ? signInViaHandoff(handoff, method) : direct());

	return (
		<div className="flex flex-col items-center justify-center min-h-full gap-5 py-6 overflow-auto">
			<div className="flex flex-col items-center gap-2">
				{branding.icon ?? <img src="/icon.svg" alt="" className="size-14" />}
				<h1 className="text-2xl font-bold">
					<HolyText text={title} />
				</h1>
				<p className="text-sm text-(--text-tertiary) text-center max-w-sm">
					<HolyText text={subtitle} />
				</p>
			</div>
			<div className="flex flex-col items-center gap-3 w-full max-w-sm">
				{noticeError && !error && !info && <Banner kind="error">{noticeError}</Banner>}
				{error && <Banner kind="error">{error}</Banner>}
				{info && <Banner kind="ok">{info}</Banner>}

				{credentialsPage && !terbium && (
					<>
						{options?.lastfm && (redirectOk || handoff) && (
							<LastfmButton label={page === "login" ? "Continue with Last.fm" : "Sign up with Last.fm"} busy={busy === "lastfm"} onClick={() => run("lastfm", async () => (await redirectSignIn("lastfm", () => connectLastfm("signin")), await finish()))} />
						)}
						{!!options?.social.length && (redirectOk || handoff) && (
							<div className="grid gap-2 w-full" style={{ gridTemplateColumns: `repeat(${Math.min(options.social.length, 3)}, minmax(0, 1fr))` }}>
								{options.social.map(p => (
									<button
										key={p}
										className="flex items-center justify-center gap-2 p-2.5 rounded-lg font-semibold text-sm hover:brightness-110 disabled:opacity-60 duration-150 cursor-pointer"
										style={{ backgroundColor: PROVIDERS[p].bg, color: PROVIDERS[p].fg }}
										disabled={!!busy}
										onClick={() => run(p, async () => (await redirectSignIn(p, () => connectSocial(p, "signin")), await finish()))}
									>
										<FontAwesomeIcon icon={PROVIDERS[p].icon} className="size-4" />
										<HolyText text={busy === p ? "Waiting…" : PROVIDERS[p].label} />
									</button>
								))}
							</div>
						)}
						{page === "login" && options && (passkeysUsable(options) || options.terbium) && (
							<div className="flex gap-2 w-full">
								{passkeysUsable(options) && (
									<button
										className="flex flex-1 items-center justify-center gap-2 p-2.5 rounded-lg font-semibold text-sm bg-[#ffffff15] hover:bg-[#ffffff25] disabled:opacity-60 cursor-pointer duration-150"
										disabled={!!busy}
										onClick={() => run("passkey", async () => (await signInWithPasskey(), await finish()))}
									>
										<FingerPrintIcon className="size-5" />
										<HolyText text={busy === "passkey" ? "Waiting…" : "Passkey"} />
									</button>
								)}
								{options.terbium && (
									<button className="flex flex-1 items-center justify-center gap-2 p-2.5 rounded-lg font-semibold text-sm bg-[#ffffff15] hover:bg-[#ffffff25] disabled:opacity-60 cursor-pointer duration-150" disabled={!!busy} onClick={() => (setTerbium(true), setError(""))}>
										<CubeTransparentIcon className="size-5" />
										<HolyText text="Terbium" />
									</button>
								)}
							</div>
						)}
						<div className="flex items-center gap-3 w-full text-xs text-(--text-tertiary)">
							<span className="flex-1 h-px bg-(--text-tertiary) opacity-30" />
							<HolyText text="or with email" />
							<span className="flex-1 h-px bg-(--text-tertiary) opacity-30" />
						</div>
					</>
				)}

				{page === "register" && <Input title="Name" type="text" value={name} onChange={e => setName(e.target.value)} />}
				{page !== "reset" && <Input title="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && page === "forgot" && submit()} />}
				{page !== "forgot" && <Input title={page === "reset" ? "New password" : "Password"} type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && page !== "reset" && submit()} />}
				{page === "reset" && <Input title="Confirm password" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} />}
				{page === "login" && !terbium && options?.mail && (
					<button className="self-end -mt-1 text-xs font-semibold text-(--text-tertiary) hover:text-(--text-primary) cursor-pointer" onClick={() => go("forgot")}>
						<HolyText text="Forgot password?" />
					</button>
				)}
				<button className="flex items-center justify-center w-full p-2.5 bg-(--accent) rounded-lg font-semibold opacity-80 hover:opacity-100 disabled:opacity-50 cursor-pointer duration-150" onClick={submit} disabled={!!busy}>
					<HolyText text={busy === "email" ? "Loading…" : page === "login" ? "Sign in" : page === "register" ? "Create account" : page === "forgot" ? "Send reset link" : "Change password"} />
				</button>
				{terbium && (
					<button className="text-sm font-semibold opacity-75 hover:opacity-100 cursor-pointer" onClick={() => (setTerbium(false), setError(""))}>
						<HolyText text="Use a Fracital Account instead" />
					</button>
				)}
			</div>
			<div className="flex items-center gap-1 text-sm">
				{page === "login" && !terbium && (
					<>
						<span className="opacity-70">
							<HolyText text="Don't have an account?" />
						</span>
						<button className="font-semibold opacity-85 hover:opacity-100 cursor-pointer duration-150" onClick={() => go("register")}>
							<HolyText text="Register" />
						</button>
					</>
				)}
				{page !== "login" && (
					<>
						<span className="opacity-70">
							<HolyText text={page === "register" ? "Have an account?" : "Remembered it?"} />
						</span>
						<button className="font-semibold opacity-85 hover:opacity-100 cursor-pointer duration-150" onClick={() => go("login")}>
							<HolyText text="Sign in" />
						</button>
					</>
				)}
			</div>
		</div>
	);
};

const Manage = ({ me, notice, onChange }: { me: Me; notice?: string; onChange: (me: Me | null) => void }) => {
	const options = useAuthOptions();
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState("");
	const [info, setInfo] = useState(notice === "verified" ? NOTICES.verified.text : "");
	const avatar = me.user.image || me.lastfm?.image;
	const providers = new Set(me.providers ?? []);
	const signInMethods = providers.size + (me.passkeys ?? 0);

	const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
		setError("");
		setInfo("");
		setBusy(key);
		try {
			await fn();
			onChange(await getMe());
			if (done) setInfo(done);
		} catch (err) {
			setError(errorText(err));
		} finally {
			setBusy(null);
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

				{notice === "verify-error" && !error && !info && <Banner kind="error">{NOTICES["verify-error"].text}</Banner>}
				{error && <Banner kind="error">{error}</Banner>}
				{info && <Banner kind="ok">{info}</Banner>}

				{me.user.email && !me.user.emailVerified && options?.mail && (
					<section className="flex items-center gap-3 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30">
						<ExclamationTriangleIcon className="size-6 shrink-0 text-amber-400" />
						<div className="flex flex-col flex-1 min-w-0 text-sm">
							<span className="font-semibold">
								<HolyText text="Verify your email" />
							</span>
							<span className="text-(--text-tertiary)">
								<HolyText text="We sent a link to your email. Verifying lets you reset your password if you forget it." />
							</span>
						</div>
						<button className={pill} disabled={!!busy} onClick={() => run("verify", () => sendVerificationEmail(me.user.email!), "Verification email sent. Check your inbox.")}>
							<HolyText text={busy === "verify" ? "Sending…" : "Resend"} />
						</button>
					</section>
				)}

				<ProfileEditor me={me} onChange={onChange} />

				<LastfmSection me={me} busy={busy} run={run} canDisconnect={signInMethods > 1 || !providers.has("lastfm")} />

				<SignInMethods me={me} options={options} busy={busy} run={run} signInMethods={signInMethods} />

				<button
					className="flex items-center justify-center gap-2 p-2.5 rounded-xl font-semibold text-(--text-secondary) bg-(--tertiary) hover:text-[#d03b3b] cursor-pointer duration-150"
					onClick={async () => {
						await signOut();
						onChange(null);
					}}
				>
					<ArrowLeftStartOnRectangleIcon className="size-5" /> <HolyText text="Sign out" />
				</button>
			</div>
		</div>
	);
};

type Run = (key: string, fn: () => Promise<unknown>, done?: string) => Promise<void>;

const LastfmSection = ({ me, busy, run, canDisconnect }: { me: Me; busy: string | null; run: Run; canDisconnect: boolean }) => {
	const newTab = useTabsStore(state => state.newTab);
	const [pending, setPending] = useState(0);
	const [importName, setImportName] = useState("");
	const lastfm = me.lastfm;

	useEffect(() => {
		void pendingScrobbles().then(setPending);
	}, [me]);

	const importLoved = (username?: string) =>
		run("import", async () => {
			const res = await importLastfmLoved(username);
			if (!res.found) throw new Error(`@${res.username} hasn't loved any songs on Last.fm yet`);
			await useSavedStore.getState().refresh();
			return res;
		}).then(() => setImportName(""));

	return (
		<section className="flex flex-col gap-3 p-4 rounded-2xl bg-(--tertiary)">
			<h2 className="font-bold">
				<HolyText text="Connected services" />
			</h2>
			<div className="flex items-center gap-3">
				<div className="flex items-center justify-center size-10 shrink-0 rounded-full text-white" style={{ backgroundColor: LASTFM_RED }}>
					<FontAwesomeIcon icon={faLastfm} className="size-5" />
				</div>
				{lastfm ? (
					<>
						<div className="flex flex-col flex-1 min-w-0">
							<span className="flex items-center gap-1.5 font-semibold">Last.fm {lastfm.needsReconnect ? <ExclamationTriangleIcon className="size-4 text-amber-400" /> : <CheckCircleIcon className="size-4 text-green-500" />}</span>
							<button className="text-left text-sm text-(--text-tertiary) hover:underline truncate cursor-pointer" onClick={() => newTab({ id: createId(), title: "Last.fm", url: lastfm.url, displayUrl: lastfm.url, icon: null, current: true })}>
								@{lastfm.username} · {formatCount(lastfm.playcount)} scrobbles
							</button>
						</div>
						{!lastfm.needsReconnect && (
							// Plain aria-label: it's this icon button's only accessible name.
							<button className={pill} disabled={!!busy} onClick={() => run("lf-refresh", refreshLastfm)} aria-label="Refresh">
								<ArrowPathIcon className={`size-4 ${busy === "lf-refresh" ? "animate-spin" : ""}`} />
							</button>
						)}
						{canDisconnect && (
							<button className={pill} disabled={!!busy} onClick={() => run("lf-off", disconnectLastfm)}>
								<HolyText text="Disconnect" />
							</button>
						)}
					</>
				) : (
					<>
						<div className="flex flex-col flex-1 min-w-0">
							<span className="font-semibold">Last.fm</span>
							<span className="text-sm text-(--text-tertiary)">
								<HolyText text="Build your library, see your play counts, and scrobble what you play." />
							</span>
						</div>
						<button
							className="text-sm font-semibold px-3 py-1.5 rounded-full text-white hover:brightness-110 disabled:opacity-50 cursor-pointer duration-150 shrink-0"
							style={{ backgroundColor: LASTFM_RED }}
							disabled={!!busy || !me.lastfmAvailable}
							onClick={() => run("lf-link", () => connectLastfm("link"))}
						>
							<HolyText text={busy === "lf-link" ? "Waiting…" : me.lastfmAvailable ? "Connect" : "Unavailable"} />
						</button>
					</>
				)}
			</div>

			{lastfm?.needsReconnect && (
				<div className="flex items-center gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-sm">
					<span className="flex-1">
						<HolyText text="Last.fm access was removed. Reconnect to keep scrobbling and liking songs — plays from meanwhile are saved and sent after you reconnect." />
					</span>
					<button className="text-sm font-semibold px-3 py-1.5 rounded-full text-white hover:brightness-110 disabled:opacity-50 cursor-pointer shrink-0" style={{ backgroundColor: LASTFM_RED }} disabled={!!busy} onClick={() => run("lf-link", () => connectLastfm("link"), "Last.fm reconnected.")}>
						<HolyText text={busy === "lf-link" ? "Waiting…" : "Reconnect"} />
					</button>
				</div>
			)}
			{pending > 0 && (
				<span className="text-xs text-(--text-tertiary)">
					<HolyText text={`${pending} ${pending === 1 ? "scrobble is" : "scrobbles are"} waiting to be sent.`} />
				</span>
			)}

			<div className="flex flex-col gap-2 pt-1 border-t border-white/10">
				<span className="text-sm font-semibold pt-2">
					<HolyText text="Import loved songs" />
				</span>
				<span className="text-xs text-(--text-tertiary)">
					<HolyText text={lastfm ? "Add your Last.fm loved songs to your library, or import from another public Last.fm profile." : "Add the loved songs from any public Last.fm profile to your library. No connection needed."} />
				</span>
				<div className="flex gap-2">
					<div className="flex flex-1 items-center gap-1 px-3 rounded-xl bg-[#ffffff10] focus-within:bg-[#ffffff18]">
						<span className="text-sm text-(--text-tertiary)">@</span>
						<input
							className="flex-1 py-2 bg-transparent outline-none text-sm min-w-0"
							maxLength={64}
							value={importName}
							placeholder={lastfm?.username ?? "username"}
							onChange={e => setImportName(e.target.value.replace(/[^\w.-]/g, ""))}
							onKeyDown={e => e.key === "Enter" && (importName || lastfm) && importLoved(importName || undefined)}
						/>
					</div>
					<button className={pill} disabled={!!busy || (!importName && !lastfm)} onClick={() => importLoved(importName || undefined)}>
						<HolyText text={busy === "import" ? "Importing…" : "Import"} />
					</button>
				</div>
			</div>
		</section>
	);
};

const MethodRow = ({ icon, label, detail, children }: { icon: React.ReactNode; label: string; detail?: string; children?: React.ReactNode }) => (
	<div className="flex items-center gap-3">
		<div className="flex items-center justify-center size-10 shrink-0 rounded-full bg-[#ffffff12]">{icon}</div>
		<div className="flex flex-col flex-1 min-w-0">
			<span className="font-semibold">
				<HolyText text={label} />
			</span>
			{detail && <span className="text-sm text-(--text-tertiary) truncate">{detail}</span>}
		</div>
		{children}
	</div>
);

const SignInMethods = ({ me, options, busy, run, signInMethods }: { me: Me; options: AuthOptions | null; busy: string | null; run: Run; signInMethods: number }) => {
	const providers = new Set(me.providers ?? []);
	const [passkeys, setPasskeys] = useState<PasskeyInfo[]>([]);
	const [terbiumForm, setTerbiumForm] = useState(false);
	const [tbEmail, setTbEmail] = useState("");
	const [tbPassword, setTbPassword] = useState("");
	const canPasskey = !!options && passkeysUsable(options);

	useEffect(() => {
		if (!canPasskey && !me.passkeys) return;
		void listPasskeys()
			.then(setPasskeys)
			.catch(() => {});
	}, [canPasskey, me.passkeys]);

	const last = signInMethods <= 1;
	const redirectOk = !!options?.redirectOk;

	return (
		<section className="flex flex-col gap-3 p-4 rounded-2xl bg-(--tertiary)">
			<h2 className="font-bold">
				<HolyText text="Sign-in methods" />
			</h2>

			{me.user.email && (
				<MethodRow icon={<KeyIcon className="size-5" />} label="Password" detail={providers.has("credential") ? me.user.email : "Not set"}>
					{options?.mail && (
						<button className={pill} disabled={!!busy} onClick={() => run("pw", () => requestPasswordReset(me.user.email!), `We emailed a link to ${me.user.email} to ${providers.has("credential") ? "change" : "set"} your password.`)}>
							<HolyText text={busy === "pw" ? "Sending…" : providers.has("credential") ? "Change" : "Set password"} />
						</button>
					)}
				</MethodRow>
			)}

			{options?.social.map(p => {
				const linked = providers.has(p);
				return (
					<MethodRow key={p} icon={<FontAwesomeIcon icon={PROVIDERS[p].icon} className="size-5" />} label={PROVIDERS[p].label} detail={linked ? "Connected" : undefined}>
						{linked ? (
							<button className={pill} disabled={!!busy || last} onClick={() => run(`off-${p}`, () => disconnectProvider(p))}>
								<HolyText text="Disconnect" />
							</button>
						) : (
							redirectOk && (
								<button className={pill} disabled={!!busy} onClick={() => run(p, () => connectSocial(p, "link"), `${PROVIDERS[p].label} connected.`)}>
									<HolyText text={busy === p ? "Waiting…" : "Connect"} />
								</button>
							)
						)}
					</MethodRow>
				);
			})}

			{(options?.terbium || providers.has("terbium")) && (
				<MethodRow icon={<CubeTransparentIcon className="size-5" />} label="Terbium" detail={providers.has("terbium") ? "Connected" : undefined}>
					{providers.has("terbium") ? (
						<button className={pill} disabled={!!busy || last} onClick={() => run("off-terbium", () => disconnectProvider("terbium"))}>
							<HolyText text="Disconnect" />
						</button>
					) : (
						!terbiumForm && (
							<button className={pill} disabled={!!busy} onClick={() => setTerbiumForm(true)}>
								<HolyText text="Connect" />
							</button>
						)
					)}
				</MethodRow>
			)}
			{terbiumForm && !providers.has("terbium") && (
				<div className="flex flex-col gap-2 pl-13">
					<Input title="Terbium email" type="email" value={tbEmail} onChange={e => setTbEmail(e.target.value)} />
					<Input title="Terbium password" type="password" value={tbPassword} onChange={e => setTbPassword(e.target.value)} />
					<div className="flex gap-2">
						<button className={pill} disabled={!!busy || !tbEmail || !tbPassword} onClick={() => run("terbium", () => terbiumAuth(tbEmail, tbPassword, "link"), "Terbium connected.").then(() => (setTbPassword(""), setTerbiumForm(false)))}>
							<HolyText text={busy === "terbium" ? "Checking…" : "Connect"} />
						</button>
						<button className={pill} onClick={() => setTerbiumForm(false)}>
							<HolyText text="Cancel" />
						</button>
					</div>
				</div>
			)}

			{(canPasskey || passkeys.length > 0) && (
				<>
					{passkeys.map(pk => (
						<MethodRow key={pk.id} icon={<FingerPrintIcon className="size-5" />} label={pk.name || "Passkey"} detail={`Added ${new Date(pk.createdAt).toLocaleDateString()}`}>
							<button className={pill} disabled={!!busy || last} onClick={() => run(`pk-${pk.id}`, async () => (await deletePasskey(pk.id), setPasskeys(await listPasskeys())))}>
								<HolyText text="Remove" />
							</button>
						</MethodRow>
					))}
					{canPasskey && (
						<MethodRow icon={<FingerPrintIcon className="size-5" />} label={passkeys.length ? "Add another passkey" : "Passkey"} detail={passkeys.length ? undefined : "Sign in with your fingerprint, face or device PIN."}>
							<button className={pill} disabled={!!busy} onClick={() => run("pk-add", async () => (await addPasskey(), setPasskeys(await listPasskeys())), "Passkey added.")}>
								<HolyText text={busy === "pk-add" ? "Waiting…" : "Add"} />
							</button>
						</MethodRow>
					)}
				</>
			)}
			{last && (passkeys.length > 0 || [...providers].some(p => p !== "credential")) && (
				<span className="text-xs text-(--text-tertiary)">
					<HolyText text="Add another sign-in method before removing this one." />
				</span>
			)}
		</section>
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
