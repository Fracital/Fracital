import { MusicalNoteIcon, PaperAirplaneIcon, UserCircleIcon } from "@heroicons/react/24/solid";
import { createId } from "@paralleldrive/cuid2";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { HolyText } from "../components/common/HolyText";
import { NameStreak } from "../components/StreakBadge";
import { openLibraryPage } from "../libs/aboutPages";
import { getMe, type Me } from "../libs/auth";
import { useHolyAttr } from "../libs/holy-attr";
import { openProfileCard } from "../libs/profiles";
import { type Listening, type SocialMessage, type SocialUser, social } from "../libs/social";
import { useTabsStore } from "../store";

const MESSAGES_POLL_MS = 4000;
const LISTENING_POLL_MS = 15_000;

// A member's picture and name open their profile card.
const Avatar = ({ user, size = "size-9" }: { user: SocialUser; size?: string }) => (
	<button type="button" className="h-fit shrink-0 rounded-full cursor-pointer hover:brightness-110" onClick={e => openProfileCard(user, e.currentTarget)}>
		{user.image ? <img src={user.image} alt="" className={`${size} rounded-full object-cover bg-(--tertiary)`} /> : <UserCircleIcon className={`${size} text-(--text-tertiary)`} />}
	</button>
);

// The member's own name and handle: data values.
const Name = ({ user }: { user: SocialUser }) => (
	<span className="flex items-baseline gap-1.5 min-w-0">
		<button type="button" className="font-semibold truncate hover:underline cursor-pointer" onClick={e => openProfileCard(user, e.currentTarget)}>
			{user.name}
		</button>
		<NameStreak streak={user.streak} />
		{user.username && <span className="text-xs text-(--text-tertiary) truncate">@{user.username}</span>}
	</span>
);

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

const Social = ({ className }: { className?: string }) => {
	const [me, setMe] = useState<Me | null | undefined>(undefined);
	useEffect(() => {
		const load = () => void getMe().then(setMe);
		load();
		window.addEventListener("account-upd", load);
		return () => window.removeEventListener("account-upd", load);
	}, []);

	return <div className={`size-full overflow-hidden ${className ?? ""}`}>{me === undefined ? null : me ? <Room me={me} /> : <SignedOut />}</div>;
};

const SignedOut = () => {
	const newTab = useTabsStore(state => state.newTab);
	return (
		<div className="flex flex-col items-center justify-center gap-3 size-full p-6 text-center">
			<HolyText as="h1" className="text-2xl font-bold" text="Social" />
			<HolyText as="p" className="text-(--text-secondary) max-w-sm" text="Talk with other members and see what they're listening to. Sign in to join." />
			<button className="px-4 py-2 rounded-full bg-(--accent) text-white font-semibold cursor-pointer" onClick={() => newTab({ id: createId(), url: "about:account", displayUrl: "about:account", title: "Fracital Account", icon: null, current: true })}>
				<HolyText text="Sign in" />
			</button>
		</div>
	);
};

const Room = ({ me }: { me: Me }) => {
	const [messages, setMessages] = useState<SocialMessage[]>([]);
	const [listening, setListening] = useState<Listening[]>([]);
	const [share, setShare] = useState<boolean | null>(null);
	const [text, setText] = useState("");
	const [error, setError] = useState("");
	const [sending, setSending] = useState(false);
	const listRef = useRef<HTMLDivElement>(null);
	const lastId = useRef(0);
	const { ref: inputRef, placeholder: inputAttrs } = useHolyAttr({ placeholder: "Say something", "aria-label": "Message" });

	const add = (incoming: SocialMessage[]) => {
		if (!incoming.length) return;
		lastId.current = Math.max(lastId.current, ...incoming.map(m => m.id));
		setMessages(prev => {
			const seen = new Set(prev.map(m => m.id));
			return [...prev, ...incoming.filter(m => !seen.has(m.id))].slice(-200);
		});
	};

	useEffect(() => {
		void social
			.messages()
			.then(add)
			.catch(() => {});
		void social
			.listening()
			.then(setListening)
			.catch(() => {});
		void social
			.share()
			.then(setShare)
			.catch(() => setShare(false));
		// Only while the page is in view.
		const messagesTimer = window.setInterval(() => {
			if (document.visibilityState === "visible")
				void social
					.messages(lastId.current || undefined)
					.then(add)
					.catch(() => {});
		}, MESSAGES_POLL_MS);
		const listeningTimer = window.setInterval(() => {
			if (document.visibilityState === "visible")
				void social
					.listening()
					.then(setListening)
					.catch(() => {});
		}, LISTENING_POLL_MS);
		return () => {
			window.clearInterval(messagesTimer);
			window.clearInterval(listeningTimer);
		};
	}, []);

	// Follow new messages when already at the bottom.
	const atBottom = useRef(true);
	useLayoutEffect(() => {
		const list = listRef.current;
		if (list && atBottom.current) list.scrollTop = list.scrollHeight;
	}, [messages]);

	const send = async () => {
		const body = text.trim();
		if (!body || sending) return;
		setSending(true);
		setError("");
		try {
			add([await social.send(body)]);
			setText("");
			atBottom.current = true;
		} catch (err) {
			setError(err instanceof Error ? err.message : "Couldn't send that");
		} finally {
			setSending(false);
		}
	};

	const remove = async (id: number) => {
		await social.remove(id).catch(() => {});
		setMessages(prev => prev.filter(m => m.id !== id));
	};

	const toggleShare = async () => {
		const next = !share;
		setShare(next);
		await social.setShare(next).catch(() => setShare(!next));
	};

	return (
		<div className="flex flex-col lg:flex-row gap-3 size-full p-3">
			<section className="flex flex-col flex-1 min-h-0 min-w-0 rounded-2xl bg-(--tertiary)">
				<div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
					<HolyText as="h1" className="text-xl font-bold" text="Social" />
				</div>
				<div
					ref={listRef}
					className="flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto px-4 py-2"
					onScroll={e => {
						const el = e.currentTarget;
						atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
					}}
				>
					{messages.length === 0 && <HolyText as="p" className="m-auto text-(--text-tertiary)" text="No messages yet. Say hi!" />}
					{messages.map(m => (
						<div key={m.id} className="group flex gap-2.5">
							<Avatar user={m.user} />
							<div className="flex flex-col min-w-0 flex-1">
								<div className="flex items-baseline gap-2 min-w-0">
									<Name user={m.user} />
									<span className="text-xs text-(--text-tertiary) shrink-0">{time(m.at)}</span>
									{(m.user.id === me.user.id || me.isAdmin) && (
										<button className="ml-auto text-xs text-(--text-tertiary) hover:text-[#ff6b6b] opacity-0 group-hover:opacity-100 cursor-pointer duration-150" onClick={() => void remove(m.id)}>
											<HolyText text="Delete" />
										</button>
									)}
								</div>
								{/* What a member wrote: a data value. */}
								<p className="whitespace-pre-wrap break-words text-(--text-primary)">{m.body}</p>
							</div>
						</div>
					))}
				</div>
				<form
					className="flex flex-col gap-1 p-3"
					onSubmit={e => {
						e.preventDefault();
						void send();
					}}
				>
					<div className="flex items-center gap-2 px-3 rounded-full bg-(--secondary) inset-shadow-(--inset-shadow-secondary) focus-within:inset-shadow-(--inset-shadow-accent) duration-200">
						<input ref={inputRef} {...inputAttrs} value={text} maxLength={500} onChange={e => setText(e.target.value)} className="flex-1 min-w-0 py-2.5 bg-transparent outline-none" />
						<button type="submit" disabled={!text.trim() || sending} className="p-1.5 rounded-full text-(--text-secondary) hover:text-(--text-primary) disabled:opacity-40 cursor-pointer duration-150">
							<PaperAirplaneIcon className="size-5" />
						</button>
					</div>
					{error && <span className="px-3 text-sm text-[#ff6b6b]">{error}</span>}
				</form>
			</section>

			<aside className="flex flex-col gap-3 lg:w-80 shrink-0 max-h-[45%] lg:max-h-none min-h-0 rounded-2xl bg-(--tertiary) p-4">
				<div className="flex items-center gap-2">
					<MusicalNoteIcon className="size-5 text-(--text-secondary)" />
					<HolyText as="h2" className="font-bold" text="Listening now" />
				</div>
				<label className="flex items-center justify-between gap-3 cursor-pointer select-none text-sm text-(--text-secondary)">
					<HolyText text="Show what I'm listening to" />
					<input type="checkbox" className="sr-only peer" checked={!!share} disabled={share === null} onChange={() => void toggleShare()} />
					<span className={`relative inline-block w-10 h-6 shrink-0 rounded-full duration-200 ${share ? "bg-(--accent)" : "bg-[#ffffff18]"}`}>
						<span className={`absolute left-1 top-1 size-4 rounded-full bg-white duration-200 ${share ? "translate-x-4" : ""}`} />
					</span>
				</label>
				<div className="flex flex-col gap-2 overflow-y-auto min-h-0">
					{listening.length === 0 && <HolyText as="p" className="text-sm text-(--text-tertiary)" text="Nobody is sharing what they're listening to right now." />}
					{listening.map(l => (
						<div key={l.user.id} className="flex items-center gap-2.5 p-2 rounded-xl bg-(--secondary)">
							{l.song.artwork ? <img src={l.song.artwork} alt="" className="size-11 shrink-0 rounded-md object-cover bg-(--tertiary)" onError={e => (e.currentTarget.style.visibility = "hidden")} /> : <Avatar user={l.user} size="size-11" />}
							<div className="flex flex-col min-w-0 flex-1 text-sm">
								<Name user={l.user} />
								{/* The song and artist: data values, each opening its page in the music library. */}
								<button className="text-left truncate hover:underline cursor-pointer" onClick={() => openLibraryPage(new URLSearchParams({ track: l.song.title, by: l.song.artist }).toString(), l.song.title)}>
									{l.song.title}
								</button>
								<button className="text-left truncate text-(--text-tertiary) hover:underline cursor-pointer" onClick={() => openLibraryPage(new URLSearchParams({ artistName: l.song.artist.split(", ")[0] }).toString(), l.song.artist)}>
									{l.song.artist}
								</button>
							</div>
						</div>
					))}
				</div>
			</aside>
		</div>
	);
};

export default Social;
