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
- GitHub Actions secrets (`TERP_DEPLOY_KEY`, and `TERP_CLOAKS_KEY` on
  `y9x/cloaks-fracital`) are set with `gh secret set` and never echoed.

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

## Verification before you hand work off

- `npm run build` must succeed.
- `npx tsc -p tsconfig.json --noEmit` should not add errors beyond the current
  baseline.
- If you touched the cloak system: run the backend on a spare port with
  `CLOAKS_DIR` set, then check with curl that a decoy `Host` returns the decoy
  page with the loader injected, that the loader and app shell return 200, and
  that a direct host still returns the real app.

## Repository layout

| Path | What it is |
|------|-----------|
| `backend.ts` | The whole server: Hono app, wisp, scramjet, music/library APIs, static serving, cloak middleware. |
| `src/` | React app (client) + `src/server/` server-side TypeScript. |
| `src/server/cloak-routing.ts` | Decoy host discovery + serving (vite plugin and production middleware). |
| `src/server/cloak-endpoints.ts` | Per-domain loader/app URL derivation and HTML injection. |
| `src/server/uncloak-client.js` | Raw client that opens the app on decoy domains. |
| `deploy/terp-deploy-gate.sh` | Source of `/usr/local/sbin/fracital-deploy-gate` on terp (installs by hand; CI never updates it). |
| `.github/workflows/deploy.yml` | Build + deploy to terp on push to `main`. |

Related checkouts (siblings, separate repos): `~/src/cloaks-fracital` (the
decoy sites) and `~/src/cloaks-abulxt` (abulxt's decoys — do not serve those
here).
