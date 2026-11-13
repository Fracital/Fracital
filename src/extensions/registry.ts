import { adblock } from "./adblock";
import type { Extension } from "./types";

/**
 * Every extension Fracital has, in the order about:extensions lists them. Adding one is adding it here. Each has its
 * own settings type; the runtime only ever hands an extension its own settings, so the list holds them loosely.
 */
// biome-ignore lint/suspicious/noExplicitAny: a list of extensions with different settings types.
export const EXTENSIONS: Extension<any>[] = [adblock];
