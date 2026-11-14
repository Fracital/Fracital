/**
 * Tab profiles: separate sets of open tabs (and their groups) to switch between, like "School" and "Games". The
 * active profile's tabs are the tabs store's; the others' wait in snapshots. Snapshots follow the Persistent Tabs
 * setting: in localStorage while it's on (they outlive a reload, like the active profile's tabs), else in memory.
 * Only the tabs are a profile's own: logins, site data and history are shared by all of them. Each profile also has
 * its own settings (a color, site rules and focus mode; profileRules.ts enforces them while it's active).
 */
import { createId } from "@paralleldrive/cuid2";
import { create } from "zustand";
import { PERSIST_FLAG, useTabsStore } from "../store";

/** Which sites a profile's rules cover: none, the listed ones (blocked), or all but the listed ones (blocked). */
export type SiteMode = "off" | "block" | "allow";

export interface TabProfile {
	id: string;
	name: string;
	/** The chip's color (hex); the accent color when unset. */
	color?: string;
	/** One of PROFILE_ICONS, shown in the profile's color; a dot when unset. */
	icon?: ProfileIcon;
	siteMode?: SiteMode;
	/** Hostnames ("youtube.com" covers its subdomains too). */
	sites?: string[];
	/** Focus mode: on until this time (ms since epoch), FOCUS_ON (until turned off), or off when unset or past. */
	focusUntil?: number | null;
}

/** The icons a profile can have (TabProfiles.tsx draws them). */
export const PROFILE_ICONS = ["school", "work", "games", "music", "code", "reading", "science", "art", "video", "shopping", "chat", "home", "heart", "star", "fire", "rocket", "globe", "camera"] as const;
export type ProfileIcon = (typeof PROFILE_ICONS)[number];

/** focusUntil for focus mode that stays on until it's turned off. */
export const FOCUS_ON = -1;
export const focusActive = (profile: TabProfile, now = Date.now()) => profile.focusUntil === FOCUS_ON || (typeof profile.focusUntil === "number" && profile.focusUntil > now);

/** The profile everyone starts in; it can't be renamed or deleted. */
export const MAIN_PROFILE_ID = "main";
const MAIN: TabProfile = { id: MAIN_PROFILE_ID, name: "Main" };
const PROFILES_KEY = "fracital:tab-profiles";
const snapshotKey = (id: string) => `fracital:profile-tabs:${id}`;
export const PROFILE_NAME_MAX = 24;
export const PROFILES_MAX = 12;

type TabsState = ReturnType<typeof useTabsStore.getState>;
type Snapshot = Pick<TabsState, "tabs" | "groups" | "groupsOrdered" | "layout">;

const persistOn = () => {
	try {
		return localStorage.getItem(PERSIST_FLAG) === "true";
	} catch {
		return false;
	}
};

/** A saved profile, kept to the fields it can have (older saves carried a "kind"). */
const readProfile = (p: TabProfile): TabProfile => ({
	id: p.id,
	name: p.id === MAIN.id ? MAIN.name : p.name,
	...(typeof p.color === "string" && /^#[0-9a-f]{6}$/i.test(p.color) ? { color: p.color } : {}),
	...((PROFILE_ICONS as readonly string[]).includes(p.icon ?? "") ? { icon: p.icon } : {}),
	...(p.siteMode === "block" || p.siteMode === "allow" ? { siteMode: p.siteMode } : {}),
	...(Array.isArray(p.sites) ? { sites: p.sites.filter(s => typeof s === "string") } : {}),
	...(typeof p.focusUntil === "number" ? { focusUntil: p.focusUntil } : {}),
});

const readSaved = (): { profiles: TabProfile[]; activeId: string } => {
	try {
		const saved = JSON.parse(localStorage.getItem(PROFILES_KEY) || "null");
		const profiles: TabProfile[] = Array.isArray(saved?.profiles) ? saved.profiles.filter((p: TabProfile) => p && typeof p.id === "string" && typeof p.name === "string").map(readProfile) : [];
		// Main is always first; saves from before its settings existed leave it out.
		const all = [profiles.find(p => p.id === MAIN.id) ?? MAIN, ...profiles.filter(p => p.id !== MAIN.id)];
		return { profiles: all, activeId: all.some(p => p.id === saved?.activeId) ? saved.activeId : MAIN.id };
	} catch {
		return { profiles: [MAIN], activeId: MAIN.id };
	}
};

export const useTabProfiles = create<{ profiles: TabProfile[]; activeId: string }>(() => (typeof window === "undefined" ? { profiles: [MAIN], activeId: MAIN.id } : readSaved()));

if (typeof window !== "undefined") {
	useTabProfiles.subscribe(({ profiles, activeId }) => {
		try {
			localStorage.setItem(PROFILES_KEY, JSON.stringify({ profiles, activeId }));
		} catch {
			// Storage unavailable: profiles last for this visit.
		}
	});
}

// React icon nodes aren't serializable; drop them (the tab re-derives them), as the tabs persistence does.
const serialize = (value: unknown) => JSON.stringify(value, (key, v) => (key === "icon" && typeof v !== "string" ? undefined : v));

/** Snapshots kept in memory while Persistent Tabs is off. */
const memory = new Map<string, Snapshot>();

const saveSnapshot = (id: string, snapshot: Snapshot) => {
	memory.set(id, snapshot);
	if (!persistOn()) return;
	try {
		localStorage.setItem(snapshotKey(id), serialize(snapshot));
	} catch {
		// Storage full: the snapshot stays in memory for this visit.
	}
};

const readSnapshot = (id: string): Snapshot | null => {
	const kept = memory.get(id);
	if (kept) return kept;
	if (!persistOn()) return null;
	try {
		const saved = JSON.parse(localStorage.getItem(snapshotKey(id)) || "null");
		return saved && Array.isArray(saved.tabs) ? saved : null;
	} catch {
		return null;
	}
};

const dropSnapshot = (id: string) => {
	memory.delete(id);
	try {
		localStorage.removeItem(snapshotKey(id));
	} catch {}
};

const freshTabs = (): Snapshot => {
	const id = createId();
	return { tabs: [{ id, title: "New Tab", url: "about:newtab", displayUrl: "about:newtab", current: true }], groups: [], groupsOrdered: false, layout: [] };
};

/** Puts the active profile's tabs away and brings out `id`'s (a new tab, the first time). */
export const switchProfile = (id: string) => {
	const { activeId, profiles } = useTabProfiles.getState();
	if (id === activeId || !profiles.some(p => p.id === id)) return;
	const { tabs, groups, groupsOrdered, layout } = useTabsStore.getState();
	saveSnapshot(activeId, { tabs, groups, groupsOrdered, layout });
	const next = readSnapshot(id) ?? freshTabs();
	// A snapshot from storage lost its layout's keys only if it was written by hand; the tabs store tolerates both.
	useTabsStore.setState({ tabs: next.tabs.length ? next.tabs : freshTabs().tabs, groups: next.groups ?? [], groupsOrdered: !!next.groupsOrdered, layout: next.layout ?? [] });
	useTabProfiles.setState({ activeId: id });
};

/** A new profile (with any settings chosen while creating it), switched to. */
export const createProfile = (name: string, settings: Partial<Omit<TabProfile, "id" | "name">> = {}) => {
	const trimmed = name.trim().slice(0, PROFILE_NAME_MAX);
	const { profiles } = useTabProfiles.getState();
	if (!trimmed || profiles.length >= PROFILES_MAX) return null;
	const profile: TabProfile = { ...settings, id: createId(), name: trimmed };
	useTabProfiles.setState({ profiles: [...profiles, profile] });
	switchProfile(profile.id);
	return profile;
};

/** Changes a profile's settings; Main keeps its name. */
export const updateProfile = (id: string, changes: Partial<Omit<TabProfile, "id">>) => {
	const next = { ...changes };
	if (next.name !== undefined) {
		const trimmed = next.name.trim().slice(0, PROFILE_NAME_MAX);
		if (!trimmed || id === MAIN.id) delete next.name;
		else next.name = trimmed;
	}
	useTabProfiles.setState(({ profiles }) => ({ profiles: profiles.map(p => (p.id === id ? { ...p, ...next } : p)) }));
};

export const activeProfile = () => {
	const { profiles, activeId } = useTabProfiles.getState();
	return profiles.find(p => p.id === activeId) ?? MAIN;
};

/** Deletes a profile and its tabs; deleting the active one goes back to Main. Main can't be deleted. */
export const deleteProfile = (id: string) => {
	if (id === MAIN.id) return;
	if (useTabProfiles.getState().activeId === id) {
		switchProfile(MAIN.id);
	}
	dropSnapshot(id);
	useTabProfiles.setState(({ profiles }) => ({ profiles: profiles.filter(p => p.id !== id) }));
};
