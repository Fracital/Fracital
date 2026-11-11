import { runtimeGlobal } from "./proxyGlobals";
import { useStompStore } from "./stompEngine";
import type { ProxyEngine } from "../types";

/** UV's version label (shown in the engine selector). */
export const UV_VERSION = "v3.2.10";

/** Each engine's version as shown to the user; empty until the engine reports one. */
export const useEngineVersions = (): Record<ProxyEngine, string> => {
	const runtime = runtimeGlobal();
	const stompBuild = useStompStore(state => state.build) ?? "";
	return { sj: runtime?.versionInfo?.version ? `v${runtime.versionInfo.version}` : "", uv: UV_VERSION, st: stompBuild };
};
