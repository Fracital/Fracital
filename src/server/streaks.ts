/**
 * Active streaks: days in a row a signed-in account used the site for a while (ACTIVE_SECONDS with the app
 * visible, counted from the client's heartbeat), and the streak promo that gives the first `slots` accounts to
 * reach a `days`-day streak `reward_days` of premium. Routes live under /api/me (signed in) and /api/admin.
 */
import type { Hono } from "hono";
import type { Pool, PoolClient } from "pg";
import * as z from "zod";
import type { Env } from "./accounts";

/** Every account's day ends at midnight here, so the promo is the same race for everyone. */
const STREAK_TZ = "America/New_York";
/** Time with the app visible that makes a day count. */
const ACTIVE_SECONDS = 600;
/** What one heartbeat is worth; the client sends one a minute while the app is visible. */
const PING_CREDIT_S = 60;
/** Heartbeats closer than this (a second tab, a reload) earn nothing. */
const PING_MIN_GAP_S = 50;
/** A gap longer than this means the app was closed or hidden: the next heartbeat starts timing again. */
const PING_MAX_GAP_S = 180;
const PROMO_ID = "streak-week";
const PROMO_DEFAULTS = { slots: 20, days: 7, rewardDays: 30 };

const TODAY = `(now() at time zone '${STREAK_TZ}')::date`;

/** An account's current streak in SQL, 0 once it's broken (no counted day today or yesterday). */
export const liveStreakSql = (alias: string) => `coalesce(case when ${alias}.last_day >= ${TODAY} - 1 then ${alias}.current end, 0)`;

export async function migrateStreaks(pool: Pool) {
	await pool.query(`create table if not exists fracital_streaks (
		user_id text primary key references "user"(id) on delete cascade,
		current int not null default 0,
		best int not null default 0,
		last_day date,
		today date,
		today_seconds int not null default 0,
		last_ping_at timestamptz
	)`);
	await pool.query(`create table if not exists fracital_promos (
		id text primary key,
		starts_at timestamptz,
		ends_at timestamptz,
		filled boolean not null default false,
		slots int not null,
		days int not null,
		reward_days int not null,
		active boolean not null default false
	)`);
	await pool.query(`create table if not exists fracital_promo_winners (
		promo_id text not null references fracital_promos(id) on delete cascade,
		user_id text not null references "user"(id) on delete cascade,
		rank int not null,
		won_at timestamptz not null default now(),
		primary key (promo_id, user_id),
		-- Deferred: renumbering ranks after a revoke briefly repeats one.
		unique (promo_id, rank) deferrable initially deferred
	)`);
}

type StateRow = {
	live: number;
	best: number;
	active_today: boolean;
	today_seconds: number;
	promo_active: boolean | null;
	slots: number | null;
	days: number | null;
	reward_days: number | null;
	winners: number;
	won_at: Date | null;
	premium_until: Date | null;
	progress: number;
};

const loadState = async (db: Pool | PoolClient, userId: string) => {
	const { rows } = await db.query<StateRow>(
		`select ${liveStreakSql("s")} live, coalesce(s.best, 0) best,
			coalesce(s.last_day = d.day, false) active_today,
			case when s.today = d.day then s.today_seconds else 0 end today_seconds,
			p.active promo_active, p.slots, p.days, p.reward_days,
			(select count(*) from fracital_promo_winners pw where pw.promo_id = '${PROMO_ID}')::int winners,
			w.won_at, um.premium_until,
			-- Only days counted since the promo started: a streak from before it can't win at launch.
			case when s.last_day >= d.day - 1 and p.starts_at is not null
				then greatest(0, least(s.current, s.last_day - (p.starts_at at time zone '${STREAK_TZ}')::date + 1)) else 0 end progress
		from (select ${TODAY} as day) d
		left join fracital_streaks s on s.user_id = $1
		left join fracital_promos p on p.id = '${PROMO_ID}'
		left join fracital_promo_winners w on w.promo_id = '${PROMO_ID}' and w.user_id = $1
		left join fracital_user_meta um on um.user_id = $1`,
		[userId],
	);
	return rows[0];
};

const stateJson = (r: StateRow) => ({
	current: r.live,
	best: Math.max(r.best, r.live),
	activeToday: r.active_today,
	todayMinutes: Math.floor(r.today_seconds / 60),
	goalMinutes: ACTIVE_SECONDS / 60,
	promo: r.slots
		? {
				active: !!r.promo_active,
				need: r.days ?? PROMO_DEFAULTS.days,
				progress: Math.min(r.progress, r.days ?? PROMO_DEFAULTS.days),
				slotsLeft: Math.max(0, r.slots - r.winners),
				rewardDays: r.reward_days ?? PROMO_DEFAULTS.rewardDays,
				won: !!r.won_at,
				premiumUntil: r.won_at && r.premium_until ? r.premium_until.toISOString() : null,
			}
		: null,
});

const transaction = async <T>(pool: Pool, work: (db: PoolClient) => Promise<T>): Promise<T> => {
	const db = await pool.connect();
	try {
		await db.query("begin");
		const result = await work(db);
		await db.query("commit");
		return result;
	} catch (e) {
		await db.query("rollback").catch(() => undefined);
		throw e;
	} finally {
		db.release();
	}
};

/** Credits one heartbeat; counts the day once it reaches ACTIVE_SECONDS. */
const creditPing = (pool: Pool, userId: string) =>
	transaction(pool, async db => {
		await db.query("insert into fracital_streaks (user_id) values ($1) on conflict do nothing", [userId]);
		const { rows } = await db.query<{ current: number; best: number; last_day: string | null; today: string | null; today_seconds: number; since: number | null; day: string; yesterday: string }>(
			`select current, best, to_char(last_day, 'YYYY-MM-DD') last_day, to_char(today, 'YYYY-MM-DD') today, today_seconds,
				extract(epoch from now() - last_ping_at)::float8 since,
				to_char(${TODAY}, 'YYYY-MM-DD') as day, to_char(${TODAY} - 1, 'YYYY-MM-DD') as yesterday
			from fracital_streaks where user_id = $1 for update`,
			[userId],
		);
		const r = rows[0];
		if (r.since !== null && r.since < PING_MIN_GAP_S) return;
		let seconds = r.today === r.day ? r.today_seconds : 0;
		// The first heartbeat after a break only starts the clock.
		if (r.since !== null && r.since <= PING_MAX_GAP_S) seconds += PING_CREDIT_S;
		let { current, best, last_day } = r;
		if (seconds >= ACTIVE_SECONDS && last_day !== r.day) {
			current = last_day === r.yesterday ? current + 1 : 1;
			best = Math.max(best, current);
			last_day = r.day;
		}
		await db.query("update fracital_streaks set today = $2::date, today_seconds = $3, last_ping_at = now(), current = $4, best = $5, last_day = $6::date where user_id = $1", [userId, r.day, Math.min(seconds, 86_400), current, best, last_day]);
	});

/** Gives this account a promo slot if one is left. True when it just won. */
const claimPromo = (pool: Pool, userId: string) =>
	transaction(pool, async db => {
		// One claim at a time, so two accounts qualifying together can't both take the last slot.
		await db.query("select pg_advisory_xact_lock(hashtext('fracital-streak-promo'))");
		const { rows } = await db.query<{ active: boolean; slots: number; reward_days: number }>("select active, slots, reward_days from fracital_promos where id = $1", [PROMO_ID]);
		const promo = rows[0];
		if (!promo?.active) return false;
		const { rows: won } = await db.query<{ count: number; mine: boolean }>("select count(*)::int count, bool_or(user_id = $2) mine from fracital_promo_winners where promo_id = $1", [PROMO_ID, userId]);
		const taken = won[0]?.count ?? 0;
		if (won[0]?.mine || taken >= promo.slots) return false;
		await db.query("insert into fracital_promo_winners (promo_id, user_id, rank) values ($1, $2, $3)", [PROMO_ID, userId, taken + 1]);
		await db.query("insert into fracital_user_meta (user_id) values ($1) on conflict do nothing", [userId]);
		await db.query("update fracital_user_meta set premium_until = greatest(coalesce(premium_until, now()), now()) + make_interval(days => $2) where user_id = $1", [userId, promo.reward_days]);
		if (taken + 1 >= promo.slots) await db.query("update fracital_promos set active = false, filled = true, ends_at = now() where id = $1", [PROMO_ID]);
		return true;
	});

export function registerStreakRoutes(app: Hono<Env>) {
	app.get("/api/me/streak", async c => c.json(stateJson(await loadState(c.get("pool"), c.get("user").id))));

	// The client's heartbeat while the app is visible.
	app.post("/api/me/activity", async c => {
		const pool = c.get("pool");
		const userId = c.get("user").id;
		await creditPing(pool, userId);
		let state = await loadState(pool, userId);
		let wonPromo = false;
		if (state.promo_active && !state.won_at && state.days && state.progress >= state.days) {
			wonPromo = await claimPromo(pool, userId);
			if (wonPromo) state = await loadState(pool, userId);
		}
		return c.json({ ...stateJson(state), wonPromo });
	});

	app.get("/api/admin/promo", async c => {
		const pool = c.get("pool");
		const { rows: promo } = await pool.query("select starts_at, ends_at, filled, slots, days, reward_days, active from fracital_promos where id = $1", [PROMO_ID]);
		const { rows: winners } = await pool.query(
			`select w.user_id, w.rank, w.won_at, u.name, u.email, um.username, um.premium_until, ${liveStreakSql("s")} streak
			from fracital_promo_winners w join "user" u on u.id = w.user_id
			left join fracital_user_meta um on um.user_id = w.user_id left join fracital_streaks s on s.user_id = w.user_id
			where w.promo_id = $1 order by w.rank`,
			[PROMO_ID],
		);
		const p = promo[0];
		return c.json({
			promo: p ? { active: p.active, startsAt: p.starts_at, endsAt: p.ends_at, filled: p.filled, slots: p.slots, days: p.days, rewardDays: p.reward_days } : { active: false, startsAt: null, endsAt: null, filled: false, ...PROMO_DEFAULTS },
			winners: winners.map(w => ({ userId: w.user_id, rank: w.rank, wonAt: w.won_at, name: w.name, email: w.email, username: w.username, premiumUntil: w.premium_until, streak: w.streak })),
		});
	});

	// Start (counting from now) or stop the promo. Winners stay winners either way.
	app.post("/api/admin/promo", async c => {
		const body = z.object({ action: z.enum(["start", "stop"]), slots: z.number().int().min(1).max(1000).optional(), days: z.number().int().min(1).max(365).optional(), rewardDays: z.number().int().min(1).max(365).optional() }).safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: "Invalid request" }, 400);
		const pool = c.get("pool");
		const { action, slots = PROMO_DEFAULTS.slots, days = PROMO_DEFAULTS.days, rewardDays = PROMO_DEFAULTS.rewardDays } = body.data;
		if (action === "start")
			await pool.query(
				`insert into fracital_promos (id, starts_at, ends_at, filled, slots, days, reward_days, active) values ($1, now(), null, false, $2, $3, $4, true)
				on conflict (id) do update set starts_at = now(), ends_at = null, filled = false, slots = $2, days = $3, reward_days = $4, active = true`,
				[PROMO_ID, slots, days, rewardDays],
			);
		else await pool.query("update fracital_promos set active = false, ends_at = now() where id = $1 and active", [PROMO_ID]);
		return c.json({ ok: true });
	});

	// Takes a slot back (an alt account, say): ends its promo premium and, if the promo had filled, reopens it.
	app.delete("/api/admin/promo/winners/:userId", async c => {
		const pool = c.get("pool");
		const userId = c.req.param("userId");
		const removed = await transaction(pool, async db => {
			await db.query("select pg_advisory_xact_lock(hashtext('fracital-streak-promo'))");
			const { rowCount } = await db.query("delete from fracital_promo_winners where promo_id = $1 and user_id = $2", [PROMO_ID, userId]);
			if (!rowCount) return false;
			await db.query("update fracital_user_meta set premium_until = null where user_id = $1", [userId]);
			// Ranks stay 1..n so the next winner takes the free number.
			await db.query("update fracital_promo_winners w set rank = r.n from (select user_id, row_number() over (order by rank)::int n from fracital_promo_winners where promo_id = $1) r where w.promo_id = $1 and w.user_id = r.user_id and w.rank <> r.n", [PROMO_ID]);
			await db.query("update fracital_promos set active = true, filled = false, ends_at = null where id = $1 and filled", [PROMO_ID]);
			return true;
		});
		return removed ? c.json({ ok: true }) : c.json({ error: "Not a winner" }, 404);
	});
}
