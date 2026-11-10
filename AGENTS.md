# AGENTS.md — Fracital

Guidance for AI coding agents working in this repository. Read this fully
before making changes. When a section conflicts with a habit, follow the
section.

## What this project is

Fracital is a web proxy and games/app site for home use, served by one Node
server (`tsx backend.ts`) that hosts a React + Vite SPA, wisp, scramjet, and
the music/library APIs.

It ships in two forms:

- The real app on direct hosts (`fracital.xyz` etc.), behind the study-guide
  cover (`CloakGate`, Ctrl+E to enter).
- A cloak fleet: decoy organization sites (from the sibling
  `~/src/cloaks-fracital` checkout) served on their own domains. On those hosts
  the decoy page is all a plain page load returns; Ctrl+E loads the app into a
  closed shadow root on top. See "Cloak system" below.

## Hard rules (read first)

### Git commits and pushes

- **Never run `git commit` or `git push`** (or stage files for committing)
  unless the user explicitly asks for it **in the current turn of the current
  session**.
- Authorization is **per-turn, never assumed**. A commit or push request in one
  turn does **not** carry over to any later turn, even within the same session.
- When in doubt, **do not commit**. State what is uncommitted and stop.
- Never rewrite or force-push `main`. If the live checkout on terp has commits
  that are not on GitHub, merge them forward; do not rebase them away.

### Deployments and servers

- **The AI does not deploy, period.** Deployment happens via CI/CD
  (`.github/workflows/deploy.yml`) after a push to `main` — the user pushes,
  or explicitly asks for a push this turn.
- Do not run deploy scripts (`deploy/*.sh`), trigger CI/CD manually, or
  otherwise push to production.
- **Only touch servers the way the user explicitly tells you to.** Interactive
  SSH work for diagnosis or a specifically authorized change is different from
  deployment — but never treat "look at a server" as license to mutate
  production. When in doubt, ask before changing anything on a live host.

### Config parity

CI ships code, never `.env`. The live copy on terp
(`/opt/fracital/repo/.env`) is the source of truth for secrets and runtime
flags; `.env.example` in the repo is structure only.

A change that adds, renames, repurposes, or re-values an env key leaves terp
**out of parity** until someone edits its `.env` by hand.

**When you cause drift, say so.** End your hand-off with a `Config parity owed`
list. For each host, give the exact keys and values to set, with secrets
elided. List anything that only takes effect once CI deploys the matching code.
Also update `.env.example` (structure only).

**Applying parity to a server needs explicit authorization in the current
turn.** Any clear instruction counts ("set it on terp", "add CLOAKS_DIR and
restart"). Once you have it, do the work; don't re-ask. Without it, give the
parity list and the one line the user needs to say.

**How to apply.**

1. Back up first: `cp -p .env .env.bak-<topic>-$(date +%Y%m%d%H%M%S)`.
2. Edit only the affected keys in place. Never rewrite the whole file.
3. Restart only the services that read the changed keys (`pm2 restart fracital
   --update-env`).
4. Verify the live behavior through the real endpoint.

### Secrets

- Never print, log, or commit plaintext secrets. `.env` is gitignored and must
  stay that way.
- GitHub Actions secrets (`TERP_DEPLOY_KEY`, `CLOUDFLARE_API_TOKEN`, and
  `TERP_CLOAKS_KEY` on `y9x/cloaks-fracital`) are set with `gh secret set` and
  never echoed. `CLOUDFLARE_API_TOKEN` powers the post-deploy cache purge
  (`scripts/cloudflare-purge.mjs`, runs in the deploy job).

## Cloak system (do not regress)

The decoy domains must never reveal Fracital on a plain page load. Any change
that leaks app identity, app JS, or the unlock mechanism into a decoy page is a
regression, even if the site still works.

- Decoy discovery: one folder per domain in `CLOAKS_DIR` (default
  `~/src/cloaks-fracital`), each with a `dist/` build. `src/server/
  cloak-routing.ts` serves those files for matching `Host` headers, in both
  the vite plugin (dev/preview) and the production `cloakMiddleware`.
- Loader and app URLs are **per-domain** and derived from the hostname
  (`src/server/cloak-endpoints.ts`). Never reintroduce a single shared literal
  path, and never name anything `uncloak`, `cloak`, `fracital`, or `proxy` in
  what the decoy page requests.
- The client (`src/server/uncloak-client.js`) mounts the app into a closed
  shadow root and keeps the decoy's title/favicon while open. Keep it
  dependency-free and framework-free; it is served raw to decoy pages.
- After adding a new decoy domain to `CLOAKS_DIR`, Fracital must be restarted
  (the host list is read once at startup). Content-only updates need no
  restart.
- `CLOAK_DIRECT_HOSTS` always serves the real app; never put a decoy domain in
  it.
- The ad partner's tag is written server-side per request hostname
  (`src/server/ad-tag.ts`): `//js.rev.iq/<hostname>` in the app shell on every
  host and in every decoy page, keyed by that page's own hostname (no `www.`).
  The static tag in `index.html` is only the fallback for a request with no
  usable hostname. A decoy page must never request another site's tag, and
  the decoy loader skips a script the page already loaded, so opening the app
  does not load the tag twice.

## Verification before you hand work off

- `npm run build` must succeed — this includes the full protection pipeline
  (prune → obfuscate → canary check → dist-refs check), which hard-fails on any
  leak. A build that skips `npm run protect` is not shippable.
- `npx tsc -p tsconfig.json --noEmit` should not add errors beyond the current
  baseline.
- If you touched the cloak system: run the backend on a spare port with
  `CLOAKS_DIR` set, then check with curl that a decoy `Host` returns the decoy
  page with the loader injected, that the loader and app shell return 200, and
  that a direct host still returns the real app.
- If you touched the client bundle shape: run `node scripts/boot-check.mjs
  http://localhost:<port>/` against a production build served by the backend.
  It must render (rootBytes > 2000) with zero shield errors.

## Obfuscation and security (mandatory for all changes)

The client is protected on purpose. Every change must preserve this. A change
that adds a plaintext path is a regression, even if it works.

Limits to keep in mind: obfuscation raises the cost of reading the code and
text. It does not make anything secret from a user with devtools, and TLS is
the only transport protection. Do not describe the DOM or the bundle as secret
in any user-facing copy.

**Builds stay in compile mode, and the guardrail is always on.**

- The shield VM (`src/server/shield/`) compiles every compilable chunk to
  encrypted bytecode by default. Never set `SHIELD_MODE=manifest` in a
  committed file, CI workflow, or deploy script; it is a local debug opt-out
  only.
- Every build must pass `scripts/check-plaintext-leaks.mjs` (canary scan, exit
  2 on any hit) and `scripts/check-dist-refs.mjs`. There is no flag to disable
  either. The canary list is `scripts/canary-list.json`; add any newly
  user-visible sensitive literal to it. It lives in `scripts/` so it is never
  itself emitted into the bundle.
- Chunk and asset names are content hashes only (`assets/[hash]`). Never add a
  fixed or module-derived bundle name; `check-dist-refs.mjs` hard-fails on one.
- The vendored proxy runtimes ship only as renamed files under `dist/vendor/`:
  Scramjet's five files, and the stomp engine's files under `dist/vendor/rt/`
  (see vite.config.ts; `src/libs/stompEngine.ts` tells stomp those names
  through its `assets` option). Both engine names are in the proxy
  transform's rename list and the canary list; stomp's error page
  (`src/stomp/error.html`) reads a global minted per build, never the
  engine's default name, and the adapter imports the controller as the
  module's default export. The transform maps wasm only inside import/export
  names, data segments and custom sections (`wasmNameRanges` in
  `scripts/obfuscate-build.mjs`), never code: a name list entry can match
  bytes in any vendored wasm (Ruffle's data spells `stomP`), and
  `WebAssembly.validate` depends on the build host's CPU (terp has no SSE4.1,
  so V8 rejects Ruffle's SIMD build there). Never reintroduce a `/scramjet/`, `/stomp/`,
  `/controller/`, or similar fingerprint path, and never ship `.map`/`.d.ts`
  artifacts (`scripts/prune-dist.mjs` removes them; if it removed something,
  find out what shipped them).
- Do not hand-edit anything under `dist/`; it is generated.

**Every new user-visible string is wrapped.** Follow
`src/components/common/HOLYTEXT.md`.

- Static text: `<HolyText text="…">` (`ellipsis` for truncated labels). Mixed
  static/dynamic: `<HolyRich>` with `<HolyDynamic>`. Legal/selectable prose:
  `<HolyProse>`.
- Attributes (`aria-label`, `title`, `placeholder`, `alt`): `useHolyAttr` from
  `src/libs/holy-attr.ts`. Never write a plain static attribute.
- A new identifying string (brand, product, community) also goes in
  `src/server/obfuscation-strings.ts` so the registry covers it.
- A string left plain needs a reason next to it. Valid reasons: it is a data
  value, a form value the user must read, or a sole accessible name where
  obfuscation would break assistive tech. "It was easier" is not a reason.

**Every new network path is gated or sealed.**

- The relay is plain wisp over TLS behind the `WISP_GATE_KEY` path gate
  (`/pipe/<key>/`, see `src/server/relay-gate.ts`). Never add a relay path or
  socket that skips the gate, and never name `wisp` in a URL.
- `/api/*` JSON responses are sealed for negotiating clients by the
  `sealApiResponses()` middleware and `cryptoFetch` (`src/libs/api-crypto-fetch.ts`).
  New API call sites use `cryptoFetch`, not bare `fetch`. New server endpoints
  under `/api/*` are sealed automatically; do not bypass the middleware.
- A new JS asset that bypasses the obfuscation pipeline needs a documented,
  specific reason in the pipeline itself.

**Anti-tamper policy.** Wipe-on-detect is only for high-confidence checks: the
bytecode integrity hash and the `toString` guard. Timing and environment checks
(`isLikelyBot`, timing, mutation) only flag. Never make them wipe or block a
user.

## Discord verification and link dispenser (lives in abulxt)

Fracital's Discord server is served by the abulxt community bot
(`~/src/abulxt/main/src/server/community-service.ts`, relayed by holt), not by
anything in this repo. It is the `fracital` **brand** in abulxt's
`config.js` `discord.brands[]` (`~/src/abulxt/main/src/server/discord-brands.ts`):
its own verified/alt/muted roles, its own link pool and monthly allowance, kept
apart from Abstract's. Staff seed the pool in the Fracital server with
`/linkadmin add <urls>` (the cloak domains from `~/src/cloaks-fracital` and the
direct hosts), post the panel with `/linkadmin panel`, and members draw with
`/links get`. Every draw tells the member to press Ctrl+E on the page, which is
how `CloakGate` and the decoy loader open the app. Nothing here needs to change
to add or rotate links; see "Discord brands" in `~/src/abulxt/AGENTS.md`.

## Repository layout

| Path                               | What it is                                                                                                                                                                                                                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `backend.ts`                       | The whole server: Hono app, wisp, scramjet, music/library APIs, static serving, cloak middleware.                                                                                                                                                                                                      |
| `src/`                             | React app (client) + `src/server/` server-side TypeScript.                                                                                                                                                                                                                                             |
| `src/server/cloak-routing.ts`      | Decoy host discovery + serving (vite plugin and production middleware).                                                                                                                                                                                                                                |
| `src/server/cloak-endpoints.ts`    | Per-domain loader/app URL derivation and HTML injection.                                                                                                                                                                                                                                               |
| `src/server/uncloak-client.js`     | Raw client that opens the app on decoy domains.                                                                                                                                                                                                                                                        |
| `deploy/terp-deploy-gate.sh`       | Source of `/usr/local/sbin/fracital-deploy-gate` on terp (installs by hand; CI never updates it).                                                                                                                                                                                                      |
| `.github/workflows/deploy.yml`     | Build + deploy to terp on push to `main`.                                                                                                                                                                                                                                                              |
| `.github/workflows/deploy-dev.yml` | Build + deploy the `dev` branch to dev.fracit.al (pm2 `fracital-dev`, :8090, `/opt/fracital/dev`, shares the prod database; owner-only cookie lock in OpenResty `conf.d/20-fracital-dev.conf`). Reached directly from Cloudflare on terp :8443 (ufw: Cloudflare ranges only), not via the abulxt edge. |

Related checkouts (siblings, separate repos): `~/src/cloaks-fracital` (the
decoy sites) and `~/src/cloaks-abulxt` (abulxt's decoys — do not serve those
here).
