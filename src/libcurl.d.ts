declare module "libcurl.js/bundled" {
	export type websocketUrl = `wss://${string}` | `ws://${string}`;
	export const libcurl: {
		set_websocket: (url: websocketUrl) => void;
		load_wasm: (url: string) => Promise<void>;
		fetch: (...args) => Promise<Response>;
		ready: boolean;
		version: {
			lib: string;
			curl: string;
			ssl: string;
			brotli: string;
			nghttp2: string;
			protocols: string[];
			wisp: string;
		};
		wisp: {
			wisp_connections: Record<string, unknown>;
		};
		transport: "wisp";
		copyright: string;
		websocket_url: websocketUrl;
		events: Record<string, unknown>;
		onload: (callback: () => void) => void;
	};
}
