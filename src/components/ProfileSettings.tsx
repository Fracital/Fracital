import { ArrowTopRightOnSquareIcon, ComputerDesktopIcon, MusicalNoteIcon, PhotoIcon, PlusIcon, TrashIcon, UserCircleIcon, XMarkIcon } from "@heroicons/react/24/solid";
import { useEffect, useRef, useState } from "react";
import { replaceShortcodes } from "../libs/emoji";
import { useHolyAttr } from "../libs/holy-attr";
import { type ProfileInterest, type ProfileSection, profiles, type ProfileSettings as Settings } from "../libs/profiles";
import { HolyText } from "./common/HolyText";
import { EmojiTextarea } from "./EmojiTextarea";
import { InterestChip, openProfilePage, ProfileBanner, SocialIcon, socialOf } from "./ProfileCard";

const BIO_MAX = 300;
const INTERESTS_MAX = 8;
const INTEREST_NAME_MAX = 40;
const LINKS_MAX = 6;
const COLORS = ["#7c3aed", "#db2777", "#dc2626", "#ea580c", "#ca8a04", "#16a34a", "#0891b2", "#2563eb", "#475569"];

const SECTIONS: { id: ProfileSection; label: string; note?: string }[] = [
	{ id: "comments", label: "Comments" },
	{ id: "artists", label: "Favorite artists" },
	{ id: "stats", label: "Stats and streak" },
	{ id: "playlists", label: "Playlists" },
	{ id: "listening", label: "Listening now", note: "Also needs sharing turned on in Social." },
	{ id: "discord", label: "Discord activity", note: "Also needs On Discord turned on below." },
];

const field = "min-w-0 flex-1 rounded-xl px-3 py-2 text-sm bg-[#ffffff0d] outline-none inset-shadow-[0_0_0_1.5px_#ffffff18] focus:inset-shadow-[0_0_0_1.5px_var(--accent)] duration-150";
const pill = "flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-full bg-[#ffffff15] hover:bg-[#ffffff25] disabled:opacity-50 cursor-pointer duration-150 shrink-0";

const Switch = ({ on, label, disabled, onChange }: { on: boolean; label: string; disabled?: boolean; onChange: (on: boolean) => void }) => {
	const { ref, placeholder } = useHolyAttr({ "aria-label": label });
	return (
		<button
			ref={ref}
			{...placeholder}
			type="button"
			role="switch"
			aria-checked={on}
			disabled={disabled}
			onClick={() => onChange(!on)}
			className={`relative inline-block w-12 h-7 shrink-0 rounded-full transition-colors duration-200 disabled:opacity-50 cursor-pointer ${on ? "bg-(--accent)" : "bg-[#ffffff15] hover:bg-[#ffffff25]"}`}
		>
			<span className={`absolute left-1 top-1 size-5 rounded-full bg-white shadow transition-transform duration-200 ${on ? "translate-x-5" : ""}`} />
		</button>
	);
};

const RemoveButton = ({ label, disabled, onClick, className = "" }: { label: string; disabled: boolean; onClick: () => void; className?: string }) => {
	const { ref, placeholder } = useHolyAttr({ "aria-label": label, title: label });
	return (
		<button ref={ref} {...placeholder} type="button" disabled={disabled} className={`shrink-0 rounded-full p-0.5 cursor-pointer hover:bg-[#ffffff25] disabled:opacity-50 ${className}`} onClick={onClick}>
			<XMarkIcon className="size-4" />
		</button>
	);
};

/** The chips under your name: games you play and artists you like. */
const InterestsEditor = ({ interests, busy, save }: { interests: ProfileInterest[]; busy: boolean; save: (next: ProfileInterest[]) => Promise<unknown> }) => {
	const [kind, setKind] = useState<ProfileInterest["kind"]>("game");
	const [name, setName] = useState("");
	const { ref, placeholder } = useHolyAttr({ placeholder: kind === "game" ? "A game you play" : "An artist you like", "aria-label": "Interest" });
	const add = () => {
		const trimmed = name.trim();
		if (!trimmed) return;
		void save([...interests, { kind, name: trimmed }]).then(ok => ok && setName(""));
	};
	return (
		<div className="flex flex-col gap-2">
			<HolyText as="h3" className="text-sm font-semibold text-(--text-secondary)" text="Interests" />
			{!!interests.length && (
				<div className="flex flex-wrap gap-2">
					{interests.map((interest, i) => (
						<InterestChip key={`${interest.kind}-${interest.name}`} interest={interest} className="pr-2">
							<RemoveButton label="Remove" disabled={busy} onClick={() => void save(interests.filter((_, j) => j !== i))} />
						</InterestChip>
					))}
				</div>
			)}
			{interests.length < INTERESTS_MAX && (
				<div className="flex items-center gap-2">
					<div className="flex shrink-0 rounded-full bg-[#ffffff0d] p-0.5">
						{(["game", "music"] as const).map(k => (
							<button
								key={k}
								type="button"
								aria-pressed={kind === k}
								className={`flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-semibold cursor-pointer duration-150 ${kind === k ? "bg-(--accent) text-white" : "text-(--text-secondary) hover:text-(--text-primary)"}`}
								onClick={() => setKind(k)}
							>
								{k === "game" ? <ComputerDesktopIcon className="size-3.5" /> : <MusicalNoteIcon className="size-3.5" />}
								<HolyText text={k === "game" ? "Game" : "Music"} />
							</button>
						))}
					</div>
					{/* What the user types: a form value. */}
					<input ref={ref} {...placeholder} value={name} maxLength={INTEREST_NAME_MAX} className={field} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && add()} />
					<button type="button" className={pill} disabled={busy || !name.trim()} onClick={add}>
						<PlusIcon className="size-4" />
						<HolyText text="Add" />
					</button>
				</div>
			)}
		</div>
	);
};

/** Your accounts elsewhere, shown as their icons in the banner's corner. */
const LinksEditor = ({ links, busy, save }: { links: string[]; busy: boolean; save: (next: string[]) => Promise<unknown> }) => {
	const [url, setUrl] = useState("");
	const { ref, placeholder } = useHolyAttr({ placeholder: "instagram.com/you", "aria-label": "Link" });
	const add = () => {
		const trimmed = url.trim();
		if (!trimmed) return;
		void save([...links, /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`]).then(ok => ok && setUrl(""));
	};
	return (
		<div className="flex flex-col gap-2">
			<HolyText as="h3" className="text-sm font-semibold text-(--text-secondary)" text="Links" />
			{!!links.length && (
				<ul className="flex flex-col gap-1">
					{links.map(link => (
						<li key={link} className="flex items-center gap-2.5 rounded-xl bg-[#ffffff0d] px-3 py-2 text-sm">
							<SocialIcon url={link} className="size-5 shrink-0" />
							{/* The site's name and the link: data values. */}
							<span className="shrink-0 font-semibold">{socialOf(link).name}</span>
							<span className="min-w-0 flex-1 truncate text-(--text-tertiary)">{link.replace(/^https:\/\/(www\.)?/, "")}</span>
							<RemoveButton label="Remove" disabled={busy} onClick={() => void save(links.filter(l => l !== link))} />
						</li>
					))}
				</ul>
			)}
			{links.length < LINKS_MAX && (
				<div className="flex items-center gap-2">
					{/* What the user types: a form value. */}
					<input ref={ref} {...placeholder} type="url" value={url} className={field} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === "Enter" && add()} />
					<button type="button" className={pill} disabled={busy || !url.trim()} onClick={add}>
						<PlusIcon className="size-4" />
						<HolyText text="Add" />
					</button>
				</div>
			)}
			<HolyText as="p" className="text-xs text-(--text-tertiary)" text="Instagram, Spotify, YouTube, TikTok and more show their own icon." />
		</div>
	);
};

/** The Account page's "Public profile" card: bio, banner, and who sees what. */
export const ProfileSettings = ({ user }: { user: { id: string; name: string; username: string | null } }) => {
	const [settings, setSettings] = useState<Settings | null>(null);
	const [bio, setBio] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const file = useRef<HTMLInputElement>(null);
	const { ref: bioRef, placeholder: bioAttrs } = useHolyAttr({ placeholder: "Tell people a little about yourself", "aria-label": "Bio" });
	const { ref: colorRef, placeholder: colorAttrs } = useHolyAttr({ title: "Custom color", "aria-label": "Custom banner color" });

	useEffect(() => {
		profiles.settings().then(
			s => {
				setSettings(s);
				setBio(s.bio);
			},
			(e: Error) => setError(e.message),
		);
	}, []);

	const run = async (action: () => Promise<Settings>) => {
		setBusy(true);
		setError(null);
		try {
			const next = await action();
			setSettings(next);
			return next;
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setBusy(false);
		}
	};

	const upload = (picked: File | undefined) => {
		if (picked) void run(() => profiles.uploadBanner(picked));
		if (file.current) file.current.value = "";
	};

	return (
		<section className="flex flex-col gap-4 p-4 rounded-2xl bg-(--tertiary)">
			<div className="flex items-center gap-2">
				<UserCircleIcon className="size-5 text-(--text-secondary)" />
				<HolyText as="h2" className="font-bold flex-1" text="Public profile" />
				<button type="button" className={pill} onClick={() => openProfilePage(user)}>
					<HolyText text="View" />
					<ArrowTopRightOnSquareIcon className="size-4" />
				</button>
			</div>

			{/* The server's message: a data value. */}
			{error && <p className="text-sm text-red-400">{error}</p>}

			{!settings ? (
				!error && <div className="h-40 rounded-xl bg-[#ffffff0d] animate-pulse" aria-hidden="true" />
			) : (
				<>
					<div className="flex flex-col gap-2">
						<HolyText as="h3" className="text-sm font-semibold text-(--text-secondary)" text="Banner" />
						<ProfileBanner profile={settings} className="h-31 w-full rounded-xl" />
						<div className="flex flex-wrap items-center gap-2">
							<input ref={file} type="file" accept="image/*" className="hidden" onChange={e => upload(e.target.files?.[0])} />
							<button type="button" className={pill} disabled={busy} onClick={() => file.current?.click()}>
								<PhotoIcon className="size-4" />
								<HolyText text={busy ? "Uploading…" : settings.banner ? "Change image" : "Upload image"} />
							</button>
							{settings.banner && (
								<button type="button" className={pill} disabled={busy} onClick={() => void run(profiles.removeBanner)}>
									<TrashIcon className="size-4" />
									<HolyText text="Remove image" />
								</button>
							)}
							<div className="flex items-center gap-1.5">
								{COLORS.map(color => (
									<button
										key={color}
										type="button"
										// The color's hex code: a data value.
										aria-label={color}
										aria-pressed={settings.bannerColor === color}
										disabled={busy}
										className={`size-6 rounded-full cursor-pointer duration-150 hover:scale-110 ${settings.bannerColor === color ? "ring-2 ring-white ring-offset-2 ring-offset-(--tertiary)" : ""}`}
										style={{ background: color }}
										onClick={() => void run(() => profiles.save({ bannerColor: settings.bannerColor === color ? "" : color }))}
									/>
								))}
								<input ref={colorRef} {...colorAttrs} type="color" value={settings.bannerColor ?? "#7c3aed"} className="size-6 cursor-pointer rounded-full border-0 bg-transparent p-0" onChange={e => void run(() => profiles.save({ bannerColor: e.target.value }))} />
							</div>
						</div>
						<HolyText as="p" className="text-xs text-(--text-tertiary)" text="An image shows over the color. Big images are shrunk before they upload." />
					</div>

					<div className="flex flex-col gap-2">
						<HolyText as="h3" className="text-sm font-semibold text-(--text-secondary)" text="Bio" />
						{/* What the user types: a form value. */}
						<EmojiTextarea
							inputRef={bioRef}
							{...bioAttrs}
							rows={3}
							maxLength={BIO_MAX}
							value={bio}
							onValueChange={setBio}
							className="w-full resize-none rounded-xl px-3 py-2 pr-9 text-sm bg-[#ffffff0d] outline-none inset-shadow-[0_0_0_1.5px_#ffffff18] focus:inset-shadow-[0_0_0_1.5px_var(--accent)] duration-150"
						/>
						<div className="flex items-center justify-end gap-2">
							{/* Characters left: a data value. */}
							<span className="mr-auto text-xs text-(--text-tertiary)">{BIO_MAX - bio.length}</span>
							{bio !== settings.bio && (
								<>
									<button type="button" className={pill} disabled={busy} onClick={() => setBio(settings.bio)}>
										<HolyText text="Cancel" />
									</button>
									<button type="button" className="text-sm font-semibold px-3 py-1.5 rounded-full bg-(--accent) text-white disabled:opacity-50 cursor-pointer" disabled={busy} onClick={() => void run(() => profiles.save({ bio: replaceShortcodes(bio) })).then(s => s && setBio(s.bio))}>
										<HolyText text="Save" />
									</button>
								</>
							)}
						</div>
					</div>

					<InterestsEditor interests={settings.interests} busy={busy} save={interests => run(() => profiles.save({ interests }))} />
					<LinksEditor links={settings.links} busy={busy} save={links => run(() => profiles.save({ links }))} />

					<div className="flex flex-col gap-3">
						<div className="flex items-center gap-3">
							<div className="flex flex-1 flex-col">
								<HolyText className="text-sm font-semibold" text="Private profile" />
								<HolyText className="text-xs text-(--text-tertiary)" text="Others only see your name and picture." />
							</div>
							<Switch on={settings.private} label="Private profile" disabled={busy} onChange={on => void run(() => profiles.save({ private: on }))} />
						</div>
						<div className={`flex flex-col gap-3 duration-150 ${settings.private ? "opacity-50" : ""}`}>
							<HolyText as="h3" className="text-sm font-semibold text-(--text-secondary)" text="Show on your profile" />
							{SECTIONS.map(section => {
								const shown = !settings.hidden.includes(section.id);
								return (
									<div key={section.id} className="flex items-center gap-3">
										<div className="flex flex-1 flex-col">
											<HolyText className="text-sm" text={section.label} />
											{section.note && <HolyText className="text-xs text-(--text-tertiary)" text={section.note} />}
										</div>
										<Switch on={shown} label={`Show ${section.label.toLowerCase()}`} disabled={busy || settings.private} onChange={on => void run(() => profiles.save({ hidden: on ? settings.hidden.filter(s => s !== section.id) : [...settings.hidden, section.id] }))} />
									</div>
								);
							})}
						</div>
					</div>
				</>
			)}
		</section>
	);
};
