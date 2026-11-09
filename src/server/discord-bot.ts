/**
 * The bot behind "On Discord" on the account page. Discord doesn't let a website read a user's
 * activity, but a bot sharing a server with them sees it, so this keeps the gateway's presence and
 * voice state in memory, keyed by Discord user ID.
 *
 * Env: DISCORD_BOT_TOKEN (off when unset). The Bot page needs the Presence and Server Members
 * intents on, and the bot must be in the server(s).
 */

const GATEWAY = "wss://gateway.discord.gg/?v=10&encoding=json";
// GUILDS | GUILD_MEMBERS | GUILD_VOICE_STATES | GUILD_PRESENCES
const INTENTS = (1 << 0) | (1 << 1) | (1 << 7) | (1 << 8);
/** Close codes that won't get better by reconnecting: bad token, bad or unapproved intents. */
const FATAL_CLOSES = new Set([4004, 4010, 4011, 4012, 4013, 4014]);

export const discordBotToken = () => process.env.DISCORD_BOT_TOKEN?.trim() || "";

interface RawActivity {
	type: number;
	name: string;
	details?: string | null;
	state?: string | null;
	url?: string | null;
	application_id?: string;
	timestamps?: { start?: number; end?: number };
	assets?: { large_image?: string; large_text?: string };
	emoji?: { name?: string; id?: string; animated?: boolean } | null;
}
interface RawPresence {
	user: { id: string };
	guild_id?: string;
	status: string;
	activities?: RawActivity[];
}
interface RawVoiceState {
	user_id: string;
	guild_id?: string;
	channel_id: string | null;
	self_video?: boolean;
	self_stream?: boolean;
	self_mute?: boolean;
	self_deaf?: boolean;
	mute?: boolean;
	deaf?: boolean;
}

/** The fields of gateway events this file reads. */
interface GatewayData {
	id: string;
	name: string;
	guild_id: string;
	session_id: string;
	resume_gateway_url: string;
	user?: { id: string; username?: string };
	guilds?: unknown[];
	large?: boolean;
	member_count?: number;
	channels?: { id: string; name: string }[];
	threads?: { id: string; name: string }[];
	members?: { user?: { id: string } }[];
	presences?: RawPresence[];
	voice_states?: RawVoiceState[];
}

export interface DiscordActivity {
	/** 0 Playing, 1 Streaming, 2 Listening, 3 Watching, 4 Custom status, 5 Competing. */
	type: number;
	name: string;
	details?: string;
	state?: string;
	/** Unix ms. */
	start?: number;
	end?: number;
	image?: string;
	imageText?: string;
	/** Custom status: a unicode emoji, or an image URL for a server emoji. */
	emoji?: string;
	url?: string;
}

export interface DiscordPresence {
	status: "online" | "idle" | "dnd" | "offline";
	activities: DiscordActivity[];
	voice: { guild: string; channel: string; video: boolean; stream: boolean; muted: boolean; deafened: boolean } | null;
}


const presences = new Map<string, { status: string; activities: RawActivity[] }>();
/** The servers each user is a member of (offline members have no presence but are still members). */
const memberGuilds = new Map<string, Set<string>>();
const voice = new Map<string, RawVoiceState>();
const guildNames = new Map<string, string>();
const channelNames = new Map<string, string>();

function resetState() {
	presences.clear();
	memberGuilds.clear();
	voice.clear();
	guildNames.clear();
	channelNames.clear();
}

function addMember(userId: string, guildId: string) {
	const guilds = memberGuilds.get(userId) ?? new Set<string>();
	guilds.add(guildId);
	memberGuilds.set(userId, guilds);
}

function setPresence(p: RawPresence, guildId: string) {
	presences.set(p.user.id, { status: p.status, activities: p.activities ?? [] });
	addMember(p.user.id, guildId);
}

/** Leaving one server keeps what another shared server still shows. */
function dropMember(userId: string, guildId: string) {
	const guilds = memberGuilds.get(userId);
	guilds?.delete(guildId);
	if (!guilds?.size) {
		presences.delete(userId);
		memberGuilds.delete(userId);
	}
	if (voice.get(userId)?.guild_id === guildId) voice.delete(userId);
}

function setVoice(v: RawVoiceState, guildId: string) {
	if (v.channel_id) voice.set(v.user_id, { ...v, guild_id: guildId });
	else voice.delete(v.user_id);
}

/** An activity's picture as a URL (Discord sends several shorthand forms). */
function assetUrl(a: RawActivity): string | undefined {
	const img = a.assets?.large_image;
	if (!img) return undefined;
	if (img.startsWith("mp:")) return `https://media.discordapp.net/${img.slice(3)}`;
	if (img.startsWith("spotify:")) return `https://i.scdn.co/image/${img.slice(8)}`;
	if (img.startsWith("youtube:")) return `https://i.ytimg.com/vi/${img.slice(8)}/hqdefault.jpg`;
	if (/^\d+$/.test(img) && a.application_id) return `https://cdn.discordapp.com/app-assets/${a.application_id}/${img}.png`;
	return undefined;
}

const text = (v: string | null | undefined) => (v ? v.slice(0, 200) : undefined);

function activity(a: RawActivity): DiscordActivity {
	const emoji = a.emoji?.id ? `https://cdn.discordapp.com/emojis/${a.emoji.id}.${a.emoji.animated ? "gif" : "png"}` : a.emoji?.name;
	return {
		type: a.type,
		name: a.name.slice(0, 128),
		details: text(a.details),
		state: text(a.state),
		start: a.timestamps?.start,
		end: a.timestamps?.end,
		image: assetUrl(a),
		imageText: text(a.assets?.large_text),
		emoji: emoji || undefined,
		url: a.type === 1 && a.url?.startsWith("https://") ? a.url : undefined,
	};
}

/** What a Discord user is doing, as far as the bot can see; null when it doesn't share a server with them. */
export function discordPresenceFor(userId: string): DiscordPresence | null {
	const p = presences.get(userId);
	const v = voice.get(userId);
	if (!p && !v && !memberGuilds.has(userId)) return null;
	const status = (["online", "idle", "dnd"].includes(p?.status ?? "") ? p!.status : "offline") as DiscordPresence["status"];
	return {
		status,
		activities: status === "offline" ? [] : (p?.activities ?? []).slice(0, 5).map(activity),
		voice: v?.channel_id
			? {
					guild: guildNames.get(v.guild_id ?? "") ?? "",
					channel: channelNames.get(v.channel_id) ?? "",
					video: !!v.self_video,
					stream: !!v.self_stream,
					muted: !!(v.self_mute || v.mute),
					deafened: !!(v.self_deaf || v.deaf),
				}
			: null,
	};
}


type State = "off" | "connecting" | "ready" | "failed";
let state: State = "off";
let failure = "";
let ws: WebSocket | null = null;
let seq: number | null = null;
let sessionId = "";
let resumeUrl = "";
let heartbeat: ReturnType<typeof setInterval> | undefined;
let acked = true;
let retries = 0;
let started = false;

/** Whether the bot is connected and has its servers loaded; `failure` explains a permanent stop. */
export const discordBotStatus = () => ({ state, failure: failure || undefined });

const send = (op: number, d: unknown) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ op, d }));

function connect() {
	const token = discordBotToken();
	if (!token) return;
	state = "connecting";
	const socket = new WebSocket(sessionId && resumeUrl ? `${resumeUrl}/?v=10&encoding=json` : GATEWAY);
	ws = socket;

	socket.addEventListener("message", event => {
		const msg = JSON.parse(String(event.data)) as { op: number; d: unknown; s: number | null; t: string | null };
		if (typeof msg.s === "number") seq = msg.s;
		switch (msg.op) {
			case 10: {
				// Hello: heartbeat on Discord's interval (the first one jittered), then identify or resume.
				const interval = (msg.d as { heartbeat_interval: number }).heartbeat_interval;
				clearInterval(heartbeat);
				acked = true;
				const beat = () => {
					if (!acked) return socket.close(4000, "missed heartbeat ack"); // a zombie connection: reconnect
					acked = false;
					send(1, seq);
				};
				setTimeout(() => {
					if (ws !== socket) return;
					beat();
					heartbeat = setInterval(beat, interval);
				}, interval * Math.random());
				if (sessionId) send(6, { token, session_id: sessionId, seq });
				else send(2, { token, intents: INTENTS, large_threshold: 250, properties: { os: "linux", browser: "fracital", device: "fracital" } });
				break;
			}
			case 11:
				acked = true;
				break;
			case 1:
				send(1, seq);
				break;
			case 7: // Discord asks for a reconnect; the session resumes.
				socket.close(4000, "reconnect requested");
				break;
			case 9: // Invalid session: resume when Discord says it can, else start over.
				if (!msg.d) {
					sessionId = "";
					resetState();
				}
				setTimeout(() => socket.close(4000, "invalid session"), 1000 + Math.random() * 4000);
				break;
			case 0:
				dispatch(msg.t ?? "", msg.d as GatewayData);
				break;
		}
	});

	socket.addEventListener("close", event => {
		if (ws !== socket) return;
		clearInterval(heartbeat);
		ws = null;
		if (FATAL_CLOSES.has(event.code)) {
			state = "failed";
			failure = event.code === 4004 ? "DISCORD_BOT_TOKEN was rejected" : event.code === 4014 ? "turn on the Presence and Server Members intents on the bot's page in the Developer Portal" : `Discord closed the connection (${event.code} ${event.reason})`;
			console.error(`Discord bot stopped: ${failure}`);
			resetState();
			return;
		}
		state = "connecting";
		// Back off on repeated failures; Discord limits how often a bot can start sessions.
		const delay = Math.min(60_000, 1000 * 2 ** retries++) + Math.random() * 1000;
		setTimeout(connect, delay);
	});
	socket.addEventListener("error", () => {
		// The close event follows and handles reconnecting.
	});
}

function dispatch(type: string, d: GatewayData) {
	switch (type) {
		case "READY":
			sessionId = d.session_id;
			resumeUrl = d.resume_gateway_url;
			resetState();
			state = "ready";
			retries = 0;
			failure = "";
			console.log(`Discord bot connected as ${d.user?.username} (${d.guilds?.length ?? 0} servers)`);
			break;
		case "RESUMED":
			state = "ready";
			retries = 0;
			break;
		case "GUILD_CREATE":
		case "GUILD_UPDATE":
			guildNames.set(d.id, d.name);
			for (const c of [...(d.channels ?? []), ...(d.threads ?? [])]) channelNames.set(c.id, c.name);
			for (const m of d.members ?? []) if (m.user?.id) addMember(m.user.id, d.id);
			for (const p of (d.presences ?? []) as RawPresence[]) setPresence(p, d.id);
			for (const v of (d.voice_states ?? []) as RawVoiceState[]) setVoice(v, d.id);
			// Large servers only send some members up front; ask for the full list (members only, no presences).
			if (type === "GUILD_CREATE" && (d.large || (d.member_count ?? 0) > (d.members?.length ?? 0))) send(8, { guild_id: d.id, query: "", limit: 0 });
			break;
		case "GUILD_MEMBERS_CHUNK":
			for (const m of d.members ?? []) if (m.user?.id) addMember(m.user.id, d.guild_id);
			break;
		case "GUILD_MEMBER_ADD":
			if (d.user?.id) addMember(d.user.id, d.guild_id);
			break;
		case "GUILD_DELETE":
			for (const userId of [...memberGuilds.keys()]) dropMember(userId, d.id);
			for (const [userId, v] of voice) if (v.guild_id === d.id) voice.delete(userId);
			guildNames.delete(d.id);
			break;
		case "CHANNEL_CREATE":
		case "CHANNEL_UPDATE":
		case "THREAD_CREATE":
		case "THREAD_UPDATE":
			channelNames.set(d.id, d.name);
			break;
		case "CHANNEL_DELETE":
		case "THREAD_DELETE":
			channelNames.delete(d.id);
			break;
		case "PRESENCE_UPDATE":
			if (d.guild_id) setPresence(d as unknown as RawPresence, d.guild_id);
			break;
		case "GUILD_MEMBER_REMOVE":
			if (d.user) dropMember(d.user.id, d.guild_id);
			break;
		case "VOICE_STATE_UPDATE":
			if (d.guild_id) setVoice(d as unknown as RawVoiceState, d.guild_id);
			break;
	}
}

/** Connects the bot (once) when DISCORD_BOT_TOKEN is set. */
export function startDiscordBot() {
	if (started || !discordBotToken()) return;
	if (typeof WebSocket === "undefined") {
		console.error("Discord bot needs a Node.js with a global WebSocket (22+)");
		return;
	}
	started = true;
	connect();
}
