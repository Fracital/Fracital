import { getCloakShadowRoot } from "./cloak";

/** "system" follows the OS "reduce motion" preference; "on"/"off" override it. */
export type MotionSetting = "system" | "on" | "off";

export const MOTION_SETTING = "reduced-motion";

const query = typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
let setting: MotionSetting = "system";
let listening = false;

export const isMotionSetting = (value: unknown): value is MotionSetting => value === "system" || value === "on" || value === "off";

/** Whether motion should be reduced right now (the setting, or the OS preference under "system"). */
export const reducedMotion = () => setting === "on" || (setting === "system" && !!query?.matches);

/** For scrollTo/scrollBy: CSS scroll-behavior doesn't cover scripted smooth scrolling. */
export const scrollBehavior = (): ScrollBehavior => (reducedMotion() ? "auto" : "smooth");

/**
 * The element whose subtree the reduced-motion CSS covers: the cloak's shadow #root on decoy hosts (the
 * app and its portals live there), otherwise <html> (so portals into <body> are covered too).
 */
const target = () => getCloakShadowRoot()?.getElementById("root") ?? document.documentElement;

const apply = () => {
	const el = target();
	if (reducedMotion()) el.setAttribute("data-motion", "reduce");
	else el.removeAttribute("data-motion");
};

/** Applies the user's choice; under "system" it also follows changes to the OS preference. */
export const applyMotionSetting = (value: unknown) => {
	setting = isMotionSetting(value) ? value : "system";
	if (!listening && query) {
		query.addEventListener("change", apply);
		listening = true;
	}
	apply();
};
