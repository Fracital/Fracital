#!/bin/bash
# The root half of Fracital's deploy on terp. Installed by hand (never by CI) as
# /usr/local/sbin/fracital-deploy-root, root-owned 0755, and allowed to the deploy user with exactly
# these arguments by /etc/sudoers.d/deploy:
#
#   deploy ALL=(root) NOPASSWD: /usr/local/sbin/fracital-deploy-root prepare, \
#     /usr/local/sbin/fracital-deploy-root restart fracital, /usr/local/sbin/fracital-deploy-root restart fracital-dev, \
#     /usr/local/sbin/fracital-deploy-root logs fracital, /usr/local/sbin/fracital-deploy-root logs fracital-dev
#
#   prepare          the checkouts, stages, $CLOAKS, the state dir and the log are deploy's; the live
#                    checkouts are root:deploy 1775 so deploy cannot rename or replace root's .env
#                    files, which stay root 600. Re-owns whatever root wrote since (pm2's apps, a
#                    commit made on terp).
#   restart <app>    pm2 restart one of the two Fracital apps.
#   logs <app>       its last 40 log lines, for a failed health check.
#
# It takes no other input: the app names and paths are fixed here, not by the caller.
set -euo pipefail
# pm2 is root's (pm2-root.service); sudo resets the environment, so name its home.
export HOME=/root PM2_HOME=/root/.pm2

LIVE=(/opt/fracital/repo /opt/fracital/dev)
STAGES=(/opt/fracital/stage /opt/fracital/dev-stage)
CLOAKS=/opt/cloaks-fracital
STATE=/var/lib/fracital-deploy
LOG=/var/log/fracital-deploy.log

reown() {
	# -P and -h: never follow a link, so one planted in the tree cannot hand deploy a file elsewhere.
	# .env* at the top of a checkout is root's and stays out (except the tracked .env.example).
	find -P "$1" \( -path "$1/.env*" ! -name '*.example' \) -prune -o \( ! -user deploy -o ! -group deploy \) -exec chown -h deploy:deploy {} +
}

prepare() {
	shopt -s nullglob
	install -d -o deploy -g deploy -m 755 "$STATE"
	[[ -e $LOG ]] || install -o deploy -g deploy -m 644 /dev/null "$LOG"
	chown deploy:deploy "$LOG"
	local d f
	for d in "${STAGES[@]}" "$CLOAKS"; do
		[[ -d $d && ! -L $d ]] || continue
		reown "$d"
	done
	for d in "${LIVE[@]}"; do
		[[ -d $d && ! -L $d ]] || continue
		reown "$d"
		chown root:deploy "$d"
		chmod 1775 "$d"
		for f in "$d"/.env*; do
			[[ $f == *.example ]] && continue
			chown -h root:root "$f"
			chmod 600 "$f"
		done
	done
}

case "${1:-}:${2:-}" in
prepare:) prepare ;;
restart:fracital | restart:fracital-dev) pm2 restart "$2" --update-env ;;
logs:fracital | logs:fracital-dev) pm2 logs "$2" --nostream --lines 40 ;;
*)
	echo "usage: fracital-deploy-root prepare | restart|logs fracital|fracital-dev" >&2
	exit 64
	;;
esac
