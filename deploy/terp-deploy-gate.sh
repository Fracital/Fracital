#!/bin/bash
# Forced command for the CI deploy keys on terp (/usr/local/sbin/fracital-deploy-gate).
# authorized_keys fixes the mode per key: `app` (deploy <sha>) or `cloaks` (rsync into $CLOAKS, reload).
set -euo pipefail
umask 022

REPO=/opt/fracital/repo
STAGE=/opt/fracital/stage
# dev.fracit.al: the `dev` branch, own checkout and pm2 app (fracital-dev on :8090), prod database.
DEV_REPO=/opt/fracital/dev
DEV_STAGE=/opt/fracital/dev-stage
DEV_PORT=8090
CLOAKS=/opt/cloaks-fracital
UPSTREAM=https://github.com/Fracital/Fracital.git
LOG=/var/log/fracital-deploy.log
STATE=/var/lib/fracital-deploy

mode=${1:-}
read -r -a cmd <<<"${SSH_ORIGINAL_COMMAND:-}"

log() { printf '%s [%s] %s\n' "$(date -u +%FT%TZ)" "$mode" "$*" | tee -a "$LOG" >&2; }

exec 9>/run/lock/fracital-deploy.lock
flock -w 900 9

healthcheck() {
	local port=${1:-8080}
	for _ in $(seq 1 30); do
		curl -fsS -o /dev/null -m 5 "http://127.0.0.1:$port/" && return 0
		sleep 1
	done
	return 1
}

restart_app() {
	local name=${1:-fracital} port=${2:-8080}
	pm2 restart "$name" --update-env >/dev/null
	if ! healthcheck "$port"; then
		log "health check failed after restarting $name"
		pm2 logs "$name" --nostream --lines 40 >&2 || true
		return 1
	fi
}

# Build $1 in the stage checkout, then move the live checkout, deps and dist to it.
build_and_sync() {
	local sha=$1 repo=${2:-$REPO} stage=${3:-$STAGE}
	[[ -d $stage/.git ]] || git clone -q "$UPSTREAM" "$stage"
	git -C "$stage" fetch -q "$UPSTREAM" "$sha" || git -C "$stage" fetch -q "$repo" "$sha"
	git -C "$stage" checkout -q --force --detach "$sha"
	git -C "$stage" clean -qfdx -e node_modules
	(cd "$stage" && npm ci --no-audit --no-fund --loglevel=error && npm run build) >&2
	git -C "$repo" fetch -q "$stage" "$sha"
	git -C "$repo" reset -q --keep "$sha"
	rsync -a --delete "$stage/node_modules/" "$repo/node_modules/"
	rsync -a --delete "$stage/dist/" "$repo/dist/"
}

# dev.fracit.al: no ancestry/clean-tree guards (dev is disposable and may be force-pushed).
deploy_dev() {
	local sha=${1:-}
	[[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo "usage: deploy-dev <40-hex sha>" >&2; exit 64; }
	[[ -d $DEV_REPO/.git && -f $DEV_REPO/.env ]] || { log "refusing dev $sha: $DEV_REPO is not set up"; exit 1; }
	local live
	live=$(git -C "$DEV_REPO" rev-parse HEAD)
	log "deploying dev $sha (live $live)"
	git -C "$DEV_REPO" checkout -q --force --detach "$live"
	build_and_sync "$sha" "$DEV_REPO" "$DEV_STAGE"
	if ! restart_app fracital-dev "$DEV_PORT"; then
		log "dev $sha is unhealthy (left running for debugging)"
		exit 1
	fi
	log "deployed dev $sha"
}

deploy_app() {
	local sha=${1:-}
	[[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo "usage: deploy <40-hex sha>" >&2; exit 64; }
	local live
	live=$(git -C "$REPO" rev-parse HEAD)
	if [[ $live == "$sha" && -f $REPO/dist/index.html ]]; then
		log "already at $sha"
		return
	fi
	# Commits are sometimes made directly on terp: never overwrite unpushed or uncommitted work.
	if [[ -n $(git -C "$REPO" status --porcelain --untracked-files=no) ]]; then
		log "refusing $sha: $REPO has uncommitted changes to tracked files"
		exit 1
	fi
	git -C "$REPO" fetch -q "$UPSTREAM" "$sha"
	if ! git -C "$REPO" merge-base --is-ancestor "$live" "$sha"; then
		log "refusing $sha: live HEAD $live has commits that are not on GitHub; push them first"
		exit 1
	fi
	log "deploying $sha (live $live)"
	build_and_sync "$sha"
	if ! restart_app; then
		log "rolling back to $live"
		build_and_sync "$live"
		restart_app || log "rollback to $live is unhealthy too"
		exit 1
	fi
	log "deployed $sha"
}

# The cloak router reads the domain list at startup: restart only when the set changes.
reload_cloaks() {
	mkdir -p "$STATE"
	local now
	now=$(find "$CLOAKS" -mindepth 3 -maxdepth 3 -path '*/dist/index.html' -printf '%P\n' 2>/dev/null | cut -d/ -f1 | sort)
	if [[ $now == "$(cat "$STATE/cloaks.set" 2>/dev/null)" ]]; then
		log "cloak set unchanged ($(grep -c . <<<"$now") domains)"
		return
	fi
	log "cloak set changed ($(grep -c . <<<"$now") domains), restarting fracital"
	restart_app
	printf '%s\n' "$now" >"$STATE/cloaks.set"
}

case "$mode:${cmd[0]:-}" in
app:deploy) deploy_app "${cmd[1]:-}" ;;
app:deploy-dev) deploy_dev "${cmd[1]:-}" ;;
cloaks:rsync)
	mkdir -p "$CLOAKS"
	exec /usr/bin/rrsync "$CLOAKS"
	;;
cloaks:reload) reload_cloaks ;;
*)
	echo "denied: '${SSH_ORIGINAL_COMMAND:-}' (mode '$mode')" >&2
	exit 126
	;;
esac
