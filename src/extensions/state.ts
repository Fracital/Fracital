import { useSettingsStore } from "../store";
import { SettingsPath } from "../types";
import type { Extension, ExtensionSettings } from "./types";

/** Every extension's settings live under this key of settings.json (so they sync with the account), by extension id. */
export const EXTENSIONS_SETTING = "extensions";

/** An extension's settings: what's saved, over its defaults (so new options get theirs). */
export const extensionSettings = <S extends ExtensionSettings>(extension: Extension<S>, all: Record<string, unknown> = useSettingsStore.getState().settings): S => {
	const saved = (all[EXTENSIONS_SETTING] as Record<string, Partial<S>> | undefined)?.[extension.id];
	return { ...extension.defaults, ...(saved ?? {}) };
};

/** An extension's settings, kept current. */
export const useExtensionSettings = <S extends ExtensionSettings>(extension: Extension<S>): S => {
	const saved = useSettingsStore(state => state.settings[EXTENSIONS_SETTING]);
	return extensionSettings(extension, { [EXTENSIONS_SETTING]: saved });
};

/** Saves changes to an extension's settings, in settings.json and the store. */
export const saveExtensionSettings = async <S extends ExtensionSettings>(extension: Extension<S>, changes: Partial<S>) => {
	const { settings, setSettings } = useSettingsStore.getState();
	const all = { ...((settings[EXTENSIONS_SETTING] as Record<string, unknown> | undefined) ?? {}), [extension.id]: { ...extensionSettings(extension, settings), ...changes } };
	await window.fr.fs.promises.writeFile(SettingsPath, JSON.stringify({ ...settings, [EXTENSIONS_SETTING]: all }, null, 4), "utf-8");
	setSettings(EXTENSIONS_SETTING, all);
};
