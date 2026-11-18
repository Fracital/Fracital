/**
 * Hourly user activity for the admin dashboard: which signed-in accounts were around in each hour (one row per
 * account per hour, written from the streak heartbeat), joined with music plays, listeners and account signups
 * into one hourly series. Hours are labelled in SITE_TZ so the dashboard's clock matches the streak day.
 */
import type { Hono } from "hono";
import type { Pool } from "pg";
import type { Env } from "./accounts.ts";

/** The site's clock for day and hour labels: streak days end at midnight here, and the admin activity chart uses it too. */
export const SITE_TZ = "America/New_York";

/** Hourly buckets the admin endpoint returns: 28 days. */
const HOURS = 28 * 24;
/** Rows older than this are pruned; a little past the window so the oldest bucket stays complete. */
const KEEP_DAYS = 35;

export async function migrateActivity(pool: Pool) {
	await pool.query(`create table if not exists fracital_activity_hours (
		user_id text not null references "user"(id) on delete cascade,
		hour timestamptz not null,
		primary key (user_id, hour)
	)`);
	await pool.query("create index if not exists fracital_activity_hours_hour on fracital_activity_hours (hour)");
}

/** Marks the account active in the current hour. A repeat within the hour is a no-op. */
export const recordActivity = (pool: Pool, userId: string) => pool.query("insert into fracital_activity_hours (user_id, hour) values ($1, date_trunc('hour', now())) on conflict do nothing", [userId]);

export function registerActivityRoutes(app: Hono<Env>) {
	// Guarded by the /api/admin/* admin middleware registered with the artist routes.
	app.get("/api/admin/activity", async c => {
		const pool = c.get("pool");
		await pool.query(`delete from fracital_activity_hours where hour < now() - make_interval(days => ${KEEP_DAYS})`);
		const { rows } = await pool.query(
			`with h as (
				select generate_series(date_trunc('hour', now()) - make_interval(hours => ${HOURS - 1}), date_trunc('hour', now()), interval '1 hour') as ts
			),
			a as (select hour, count(*) as n from fracital_activity_hours where hour >= (select min(ts) from h) group by hour),
			m as (select date_trunc('hour', at) as hour, count(*) as plays, count(distinct listener) as listeners from music_play_events where at >= (select min(ts) from h) group by 1),
			u as (select date_trunc('hour', "createdAt") as hour, count(*) as n from "user" where "createdAt" >= (select min(ts) from h) group by 1)
			select h.ts as at,
				to_char(h.ts at time zone $1, 'YYYY-MM-DD') as day,
				extract(isodow from h.ts at time zone $1)::int as dow,
				extract(hour from h.ts at time zone $1)::int as hour,
				coalesce(a.n, 0)::int as active,
				coalesce(m.listeners, 0)::int as listeners,
				coalesce(m.plays, 0)::int as plays,
				coalesce(u.n, 0)::int as signups
			from h left join a on a.hour = h.ts left join m on m.hour = h.ts left join u on u.hour = h.ts
			order by h.ts`,
			[SITE_TZ],
		);
		return c.json({ tz: SITE_TZ, hours: rows.map(r => ({ ...r, at: (r.at as Date).toISOString() })) });
	});
}
