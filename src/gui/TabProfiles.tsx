import {
	AcademicCapIcon,
	BeakerIcon,
	BookOpenIcon,
	BriefcaseIcon,
	CameraIcon,
	ChatBubbleLeftRightIcon,
	CheckIcon,
	ChevronDownIcon,
	ChevronUpDownIcon,
	CodeBracketIcon,
	Cog6ToothIcon,
	FilmIcon,
	FireIcon,
	GlobeAltIcon,
	HeartIcon,
	HomeIcon,
	MusicalNoteIcon,
	NoSymbolIcon,
	PaintBrushIcon,
	PlusIcon,
	PuzzlePieceIcon,
	RocketLaunchIcon,
	ShoppingBagIcon,
	StarIcon,
	TrashIcon,
	ViewfinderCircleIcon,
	XMarkIcon,
} from "@heroicons/react/24/solid";
import { useEffect, useState } from "react";
import { ContextMenu, type MenuItem } from "../components/ContextMenu";
import { HolyDynamic, HolyRich } from "../components/common/HolyRich";
import { HolyText } from "../components/common/HolyText";
import { useModal } from "../components/Modal/ModalContext";
import { useHolyAttr } from "../libs/holy-attr";
import { normalizeSite } from "../libs/profileRules";
import { createProfile, deleteProfile, FOCUS_ON, focusActive, MAIN_PROFILE_ID, PROFILE_ICONS, PROFILE_NAME_MAX, PROFILES_MAX, type ProfileIcon, type SiteMode, switchProfile, type TabProfile, updateProfile, useTabProfiles } from "../libs/tabProfiles";

const field = "w-full rounded-xl px-3 py-2 text-sm bg-[#ffffff0d] outline-none inset-shadow-[0_0_0_1.5px_#ffffff18] focus:inset-shadow-[0_0_0_1.5px_var(--accent)] duration-150";

const COLORS = ["#fb74fe", "#7c3aed", "#2563eb", "#0891b2", "#16a34a", "#ca8a04", "#ea580c", "#dc2626", "#475569"];
const FOCUS_TIMES: { label: string; minutes: number | null }[] = [
	{ label: "25 min", minutes: 25 },
	{ label: "1 hour", minutes: 60 },
	{ label: "2 hours", minutes: 120 },
	{ label: "Until I turn it off", minutes: null },
];
const SITE_MODES: { mode: SiteMode; label: string; about: string }[] = [
	{ mode: "off", label: "Off", about: "Every site opens." },
	{ mode: "block", label: "Block sites", about: "The sites on the list don't open in this profile." },
	{ mode: "allow", label: "Only allow sites", about: "Only the sites on the list open in this profile. To search, add your search engine too." },
];

/** What each profile icon draws, and its name (for the picker's labels). */
const ICONS: Record<ProfileIcon, { Icon: typeof StarIcon; label: string }> = {
	school: { Icon: AcademicCapIcon, label: "School" },
	work: { Icon: BriefcaseIcon, label: "Work" },
	games: { Icon: PuzzlePieceIcon, label: "Games" },
	music: { Icon: MusicalNoteIcon, label: "Music" },
	code: { Icon: CodeBracketIcon, label: "Code" },
	reading: { Icon: BookOpenIcon, label: "Reading" },
	science: { Icon: BeakerIcon, label: "Science" },
	art: { Icon: PaintBrushIcon, label: "Art" },
	video: { Icon: FilmIcon, label: "Video" },
	shopping: { Icon: ShoppingBagIcon, label: "Shopping" },
	chat: { Icon: ChatBubbleLeftRightIcon, label: "Chat" },
	home: { Icon: HomeIcon, label: "Home" },
	heart: { Icon: HeartIcon, label: "Heart" },
	star: { Icon: StarIcon, label: "Star" },
	fire: { Icon: FireIcon, label: "Fire" },
	rocket: { Icon: RocketLaunchIcon, label: "Rocket" },
	globe: { Icon: GlobeAltIcon, label: "Globe" },
	camera: { Icon: CameraIcon, label: "Camera" },
};

/** A profile's icon in its color (white on its own colored chip), or a dot when it has none. */
const ProfileMark = ({ profile, onColor = false, size = "dot" }: { profile: Pick<TabProfile, "color" | "icon">; onColor?: boolean; size?: "dot" | "rail" }) => {
	const style = onColor ? undefined : profile.color ? { color: profile.color } : undefined;
	if (profile.icon && ICONS[profile.icon]) {
		const { Icon } = ICONS[profile.icon];
		return <Icon className={`${size === "rail" ? "size-4.5" : "size-4"} shrink-0 ${onColor || profile.color ? "" : "text-(--accent)"}`} style={style} />;
	}
	if (onColor) return null;
	return <span className={`${size === "rail" ? "size-3" : "size-2.5"} shrink-0 rounded-full ${profile.color ? "" : "bg-(--accent)"}`} style={profile.color ? { background: profile.color } : undefined} />;
};

/** One choice in the icon picker. */
const IconChoice = ({ icon, on, onPick }: { icon: ProfileIcon | null; on: boolean; onPick: () => void }) => {
	const label = icon ? ICONS[icon].label : "No icon";
	const { ref, placeholder } = useHolyAttr({ "aria-label": label, title: label });
	const Icon = icon ? ICONS[icon].Icon : null;
	return (
		<button ref={ref} {...placeholder} type="button" aria-pressed={on} className={`flex size-8 items-center justify-center rounded-lg cursor-pointer duration-150 ${on ? "bg-(--accent) text-white" : "bg-[#ffffff10] text-(--text-secondary) hover:bg-[#ffffff1c] hover:text-(--text-primary)"}`} onClick={onPick}>
			{Icon ? <Icon className="size-4.5" /> : <span className="size-2.5 rounded-full bg-current" />}
		</button>
	);
};

const section = "flex flex-col gap-2";
const choice = (on: boolean) => `px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer duration-150 ${on ? "bg-(--accent) text-white" : "bg-[#ffffff10] hover:bg-[#ffffff1c]"}`;

/** Minutes left in a timed focus session, rounded up. */
const minutesLeft = (until: number) => Math.max(1, Math.ceil((until - Date.now()) / 60_000));

/** What ProfileOptions edits: everything about a profile but its id and name. */
type ProfileOptionValues = Pick<TabProfile, "color" | "icon" | "focusUntil" | "siteMode" | "sites">;

/** A profile's color, icon, focus mode and site rules: in its settings (saved as they change) and when creating it. */
const ProfileOptions = ({ value, onChange }: { value: ProfileOptionValues; onChange: (changes: Partial<ProfileOptionValues>) => void }) => {
	const [site, setSite] = useState("");
	const [siteError, setSiteError] = useState(false);
	const { ref: siteRef, placeholder: siteAttrs } = useHolyAttr({ placeholder: "youtube.com", "aria-label": "Site" });
	const mode = value.siteMode ?? "off";
	const sites = value.sites ?? [];
	const focusing = focusActive(value as TabProfile);

	const addSite = () => {
		const host = normalizeSite(site);
		if (!host) return setSiteError(true);
		if (!sites.includes(host)) onChange({ sites: [...sites, host] });
		setSite("");
	};

	return (
		<>
			<div className={section}>
				<HolyText as="h3" className="text-sm font-semibold text-(--text-secondary)" text="Color" />
				<div className="flex flex-wrap items-center gap-2">
					{COLORS.map((color, i) => {
						const on = (value.color ?? COLORS[0]) === color;
						return (
							<button
								key={color}
								type="button"
								// The color's hex code: a data value.
								aria-label={color}
								aria-pressed={on}
								className={`size-7 rounded-full cursor-pointer duration-150 hover:scale-110 ${on ? "ring-2 ring-white ring-offset-2 ring-offset-(--secondary)" : ""}`}
								style={{ background: color }}
								onClick={() => onChange({ color: i === 0 ? undefined : color })}
							/>
						);
					})}
				</div>
			</div>

			<div className={section}>
				<HolyText as="h3" className="text-sm font-semibold text-(--text-secondary)" text="Icon" />
				<div className="flex flex-wrap gap-1.5">
					<IconChoice icon={null} on={!value.icon} onPick={() => onChange({ icon: undefined })} />
					{PROFILE_ICONS.map(icon => (
						<IconChoice key={icon} icon={icon} on={value.icon === icon} onPick={() => onChange({ icon })} />
					))}
				</div>
			</div>

			<div className={section}>
				<div className="flex items-center gap-2">
					<ViewfinderCircleIcon className="size-4.5 text-(--text-secondary)" />
					<HolyText as="h3" className="text-sm font-semibold text-(--text-secondary)" text="Focus mode" />
				</div>
				<HolyText as="p" className="text-xs text-(--text-tertiary)" text="Blocks video, social and game sites, and the Games, Chat and Social pages here." />
				{focusing ? (
					<div className="flex items-center gap-3 rounded-xl bg-(--accent)/15 px-3 py-2">
						{value.focusUntil === FOCUS_ON ? (
							<HolyText className="flex-1 text-sm font-semibold" text="On until you turn it off" />
						) : (
							<HolyRich className="flex-1 text-sm font-semibold">
								On, <HolyDynamic>{minutesLeft(value.focusUntil ?? 0)}</HolyDynamic> min left
							</HolyRich>
						)}
						<button type="button" className={choice(false)} onClick={() => onChange({ focusUntil: null })}>
							<HolyText text="Turn off" />
						</button>
					</div>
				) : (
					<div className="flex flex-wrap gap-1.5">
						{FOCUS_TIMES.map(t => (
							<button key={t.label} type="button" className={choice(false)} onClick={() => onChange({ focusUntil: t.minutes === null ? FOCUS_ON : Date.now() + t.minutes * 60_000 })}>
								<HolyText text={t.label} />
							</button>
						))}
					</div>
				)}
			</div>

			<div className={section}>
				<div className="flex items-center gap-2">
					<NoSymbolIcon className="size-4.5 text-(--text-secondary)" />
					<HolyText as="h3" className="text-sm font-semibold text-(--text-secondary)" text="Site rules" />
				</div>
				<div className="flex flex-wrap gap-1.5">
					{SITE_MODES.map(m => (
						<button key={m.mode} type="button" aria-pressed={mode === m.mode} className={choice(mode === m.mode)} onClick={() => onChange({ siteMode: m.mode })}>
							<HolyText text={m.label} />
						</button>
					))}
				</div>
				<HolyText as="p" className="text-xs text-(--text-tertiary)" text={SITE_MODES.find(m => m.mode === mode)?.about ?? ""} />
				{mode !== "off" && (
					<>
						{/* Not a <form>: the create dialog is one, and forms can't nest. */}
						<div className="flex items-center gap-2">
							{/* What the user types: a form value. */}
							<input
								ref={siteRef}
								{...siteAttrs}
								value={site}
								className={`${field} ${siteError ? "inset-shadow-[0_0_0_1.5px_#f87171]" : ""}`}
								onChange={e => {
									setSite(e.target.value);
									setSiteError(false);
								}}
								onKeyDown={e => {
									if (e.key !== "Enter") return;
									e.preventDefault();
									addSite();
								}}
							/>
							<button type="button" disabled={!site.trim()} className="flex shrink-0 items-center gap-1 px-3 py-2 rounded-xl text-sm font-semibold bg-[#ffffff15] hover:bg-[#ffffff25] disabled:opacity-50 cursor-pointer" onClick={addSite}>
								<PlusIcon className="size-4" />
								<HolyText text="Add" />
							</button>
						</div>
						{siteError && <HolyText as="p" className="text-xs text-red-400" text="That doesn't look like a site. Try something like youtube.com." />}
						{!!sites.length && (
							<div className="flex flex-wrap gap-1.5">
								{sites.map(host => (
									<span key={host} className="flex items-center gap-1 rounded-full bg-[#ffffff10] py-1 pl-3 pr-1 text-xs font-semibold">
										{/* The site: a data value. */}
										{host}
										<SiteRemove onClick={() => onChange({ sites: sites.filter(s => s !== host) })} />
									</span>
								))}
							</div>
						)}
					</>
				)}
			</div>
		</>
	);
};

/** New profile: its name, and (optionally, before it's made) its color, focus mode and site rules. */
const CreateProfile = ({ onDone }: { onDone: () => void }) => {
	const [name, setName] = useState("");
	const [options, setOptions] = useState<ProfileOptionValues>({});
	const { ref, placeholder } = useHolyAttr({ placeholder: "Name, like School or Games", "aria-label": "Profile name" });
	return (
		<form
			className="flex max-h-[80dvh] flex-col gap-5 overflow-y-auto p-1"
			onSubmit={e => {
				e.preventDefault();
				if (createProfile(name, options)) onDone();
			}}
		>
			<div className="flex flex-col gap-2">
				<HolyText as="h2" className="text-lg font-bold" text="New tab profile" />
				{/* What the user types: a form value. */}
				<input ref={ref} {...placeholder} autoFocus value={name} maxLength={PROFILE_NAME_MAX} className={field} onChange={e => setName(e.target.value)} />
				<HolyText as="p" className="text-xs text-(--text-secondary)" text="It has its own tabs and groups. Logins, site data and history are shared with your other profiles. Everything below can be changed later." />
			</div>
			<ProfileOptions value={options} onChange={changes => setOptions(o => ({ ...o, ...changes }))} />
			<div className="flex justify-end gap-2">
				<button type="button" className="px-3 py-1.5 rounded-lg text-sm font-semibold text-(--text-secondary) hover:text-(--text-primary) cursor-pointer" onClick={onDone}>
					<HolyText text="Cancel" />
				</button>
				<button type="submit" disabled={!name.trim()} className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-(--accent) text-white disabled:opacity-50 cursor-pointer">
					<HolyText text="Create" />
				</button>
			</div>
		</form>
	);
};

/** A profile's settings: its name, color, focus mode and site rules. Each change applies right away. */
export const ProfileSettingsDialog = ({ id, onDone }: { id: string; onDone: () => void }) => {
	const profile = useTabProfiles(state => state.profiles.find(p => p.id === id));
	const [name, setName] = useState(profile?.name ?? "");
	const { ref: nameRef, placeholder: nameAttrs } = useHolyAttr({ "aria-label": "Profile name" });
	if (!profile) return null;

	const saveName = () => {
		if (name.trim() && name.trim() !== profile.name) updateProfile(id, { name });
		else setName(profile.name);
	};

	return (
		<div className="flex max-h-[80dvh] flex-col gap-5 overflow-y-auto p-1">
			<div className="flex items-center gap-2">
				<Cog6ToothIcon className="size-5 text-(--text-secondary)" />
				<HolyText as="h2" className="flex-1 text-lg font-bold" text="Profile settings" />
				<button type="button" className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-(--accent) text-white cursor-pointer" onClick={onDone}>
					<HolyText text="Done" />
				</button>
			</div>
			{profile.id !== MAIN_PROFILE_ID && (
				<div className={section}>
					<HolyText as="h3" className="text-sm font-semibold text-(--text-secondary)" text="Name" />
					{/* What the user types: a form value. */}
					<input ref={nameRef} {...nameAttrs} value={name} maxLength={PROFILE_NAME_MAX} className={field} onChange={e => setName(e.target.value)} onBlur={saveName} onKeyDown={e => e.key === "Enter" && e.currentTarget.blur()} />
				</div>
			)}
			<ProfileOptions value={profile} onChange={changes => updateProfile(id, changes)} />
		</div>
	);
};

const SiteRemove = ({ onClick }: { onClick: () => void }) => {
	const { ref, placeholder } = useHolyAttr({ "aria-label": "Remove", title: "Remove" });
	return (
		<button ref={ref} {...placeholder} type="button" className="rounded-full p-0.5 hover:bg-[#ffffff20] cursor-pointer" onClick={onClick}>
			<XMarkIcon className="size-3.5" />
		</button>
	);
};

/** A profile's own menu (right-clicking it, here or in the side panel): its settings, and deleting it (not Main). */
const profileActions = (profile: TabProfile, openModal: (content: React.ReactNode) => void, closeModal: () => void): MenuItem[] => [
	{ title: <HolyText text="Settings" />, icon: <Cog6ToothIcon className="size-4.5" />, onClick: () => openModal(<ProfileSettingsDialog id={profile.id} onDone={closeModal} />) },
	...(profile.id === MAIN_PROFILE_ID ? [] : [{ title: <HolyText text="Delete profile and its tabs" />, icon: <TrashIcon className="size-4.5" />, onClick: () => deleteProfile(profile.id) }]),
];

/** The tab view's profiles: one chip each (the active one lit, with its menu), and a button for a new one. */
export const ProfileStrip = () => {
	const profiles = useTabProfiles(state => state.profiles);
	const activeId = useTabProfiles(state => state.activeId);
	const { openModal, closeModal } = useModal();
	const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
	const { ref: addRef, placeholder: addAttrs } = useHolyAttr({ "aria-label": "New tab profile", title: "New tab profile" });

	// Re-render as timed focus sessions run down (and end).
	const timed = profiles.some(p => typeof p.focusUntil === "number" && p.focusUntil > Date.now());
	const [, setTick] = useState(0);
	useEffect(() => {
		if (!timed) return;
		const timer = window.setInterval(() => setTick(t => t + 1), 30_000);
		return () => window.clearInterval(timer);
	}, [timed]);

	const openMenu = (profile: TabProfile, x: number, y: number) => setMenu({ x, y, items: profileActions(profile, openModal, closeModal) });

	return (
		<div className="flex min-w-0 items-center gap-1.5">
			{profiles.map(profile => {
				const active = profile.id === activeId;
				const focusing = focusActive(profile);
				return (
					<div
						key={profile.id}
						className={`flex shrink-0 items-center h-9 rounded-xl text-sm font-semibold duration-150 ${active ? `${profile.color ? "" : "bg-(--accent)"} text-white` : "text-(--text-secondary) inset-shadow-[0_0_0_1.5px_#ffffff30] hover:inset-shadow-[0_0_0_1.5px_#ffffff60] hover:text-(--text-primary)"}`}
						style={active && profile.color ? { background: profile.color } : undefined}
					>
						<button
							type="button"
							aria-pressed={active}
							className={`flex h-full max-w-44 items-center gap-1.5 cursor-pointer ${active ? "pl-3 pr-1" : "px-3"}`}
							onClick={() => switchProfile(profile.id)}
							onContextMenu={e => {
								e.preventDefault();
								openMenu(profile, e.clientX, e.clientY);
							}}
						>
							{(profile.icon || (!active && profile.color)) && <ProfileMark profile={profile} onColor={active} />}
							{focusing && <ViewfinderCircleIcon className="size-4 shrink-0" />}
							{/* Main's name is ours; the others are the user's own (data values). */}
							<span className="truncate">{profile.id === MAIN_PROFILE_ID ? <HolyText text="Main" /> : profile.name}</span>
						</button>
						{active && (
							<button
								type="button"
								aria-haspopup="menu"
								className="flex h-full items-center pr-2 pl-0.5 cursor-pointer"
								onClick={e => {
									const r = e.currentTarget.getBoundingClientRect();
									openMenu(profile, r.left, r.bottom + 4);
								}}
							>
								<ChevronDownIcon className="size-4" />
							</button>
						)}
					</div>
				);
			})}
			{profiles.length < PROFILES_MAX && (
				<button
					ref={addRef}
					{...addAttrs}
					type="button"
					className="flex shrink-0 items-center justify-center size-9 rounded-xl text-(--text-secondary) inset-shadow-[0_0_0_1.5px_#ffffff30] hover:inset-shadow-[0_0_0_1.5px_#ffffff60] hover:text-(--text-primary) cursor-pointer duration-150"
					onClick={() => openModal(<CreateProfile onDone={closeModal} />)}
				>
					<PlusIcon className="size-4.5" />
				</button>
			)}
			{menu && <ContextMenu items={menu.items} position={{ x: menu.x, y: menu.y }} onClose={() => setMenu(null)} />}
		</div>
	);
};

/** A profile's name (Main's is ours; the others are the user's own, data values). */
const profileName = (profile: TabProfile) => (profile.id === MAIN_PROFILE_ID ? <HolyText text="Main" /> : profile.name);

/**
 * The side panel's profile switcher (the tab view has ProfileStrip): the active profile, and a menu to switch, make a
 * new one or change this one's settings; right-clicked, the profile's own menu, as in the tab view. In the compact rail it's just the profile's mark (ringed while focus mode is on).
 */
export const ProfileSwitcher = ({ rail = false }: { rail?: boolean }) => {
	const profiles = useTabProfiles(state => state.profiles);
	const active = useTabProfiles(state => state.profiles.find(p => p.id === state.activeId) ?? state.profiles[0]);
	const { openModal, closeModal } = useModal();
	const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
	const { ref, placeholder } = useHolyAttr({ title: "Tab profiles", "aria-label": "Tab profiles" });

	const switchItems: MenuItem[] = [
		{ isHeader: true, title: <HolyText text="Tab profiles" />, icon: null, onClick: () => undefined },
		...profiles.map(profile => ({
			title: (
				<span className="flex min-w-0 items-center gap-2">
					<ProfileMark profile={profile} />
					<span className="truncate">{profileName(profile)}</span>
					{focusActive(profile) && <ViewfinderCircleIcon className="size-4 shrink-0 text-(--text-tertiary)" />}
				</span>
			),
			icon: profile.id === active.id ? <CheckIcon className="size-4.5" /> : null,
			onClick: () => switchProfile(profile.id),
		})),
		...(profiles.length < PROFILES_MAX ? [{ title: <HolyText text="New profile" />, icon: <PlusIcon className="size-4.5" />, onClick: () => openModal(<CreateProfile onDone={closeModal} />) }] : []),
		{ title: <HolyText text="Profile settings" />, icon: <Cog6ToothIcon className="size-4.5" />, onClick: () => openModal(<ProfileSettingsDialog id={active.id} onDone={closeModal} />) },
	];

	return (
		<>
			<button
				ref={ref}
				{...placeholder}
				type="button"
				aria-haspopup="menu"
				aria-expanded={!!menu}
				// The collapsed side panel opens itself on a click inside it (App.tsx); not on this one.
				data-profile-switcher
				className={
					rail
						? `flex size-8 items-center justify-center rounded-full hover:bg-[#ffffff10] cursor-pointer duration-200 ${focusActive(active) ? "ring-2 ring-(--accent)" : ""}`
						: "flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-2 text-sm font-semibold text-(--text-secondary) hover:bg-[#ffffff10] hover:text-(--text-primary) cursor-pointer duration-200"
				}
				onClick={e => {
					const r = e.currentTarget.getBoundingClientRect();
					setMenu({ x: r.right, y: r.top, items: switchItems });
				}}
				// Right-click: the profile's own menu, as on its chip in the tab view.
				onContextMenu={e => {
					e.preventDefault();
					setMenu({ x: e.clientX, y: e.clientY, items: profileActions(active, openModal, closeModal) });
				}}
			>
				<ProfileMark profile={active} size={rail ? "rail" : "dot"} />
				{!rail && (
					<>
						<span className="max-w-24 truncate">{profileName(active)}</span>
						{focusActive(active) && <ViewfinderCircleIcon className="size-4 shrink-0" />}
						<ChevronUpDownIcon className="size-4 shrink-0" />
					</>
				)}
			</button>
			{menu && <ContextMenu items={menu.items} position={{ x: menu.x, y: menu.y }} align="end" onClose={() => setMenu(null)} />}
		</>
	);
};
