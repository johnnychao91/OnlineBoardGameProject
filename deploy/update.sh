#!/usr/bin/env bash
# Standard Pi deployment: /opt/space-station, /opt/node24, space-station.service.
set -euo pipefail
umask 022

if [ "$#" != 2 ] || [ "$1" != --apache-config ]; then
  echo 'Usage: bash deploy/update.sh --apache-config /etc/apache2/sites-available/ACTUAL.conf' >&2
  exit 2
fi
station_apache_config=$2
[ "$(id -u)" -ne 0 ] || { echo 'Run as the deployment user, without sudo.' >&2; exit 2; }
cd /opt/space-station
export PATH="/opt/node24/bin:$PATH"
station_lock=$(realpath -m "$(git rev-parse --git-path space-station-maintenance.lock)")
exec 9>"$station_lock"
flock -n 9 || { echo 'Another backup or update is already running.' >&2; exit 1; }
test "$(node -p 'process.versions.node.split(".")[0]')" = 24
test -z "$(git status --porcelain)"
test "$(git branch --show-current)" = main
test -d dist
test -d node_modules
sudo test -s "$station_apache_config"
sudo systemctl is-active --quiet space-station
station_old_commit=$(git rev-parse HEAD)
git fetch origin
station_target=$(git rev-parse origin/main)
git merge-base --is-ancestor "$station_old_commit" "$station_target"
if [ "$station_target" = "$station_old_commit" ]; then
  echo 'Already at origin/main; no files or service state changed.'
  exit 0
fi

# A sibling on the same filesystem allows fast directory moves at activation.
station_stage=$(sudo mktemp -d /opt/space-station-update.XXXXXX)
sudo chown "$(id -u):$(id -g)" "$station_stage"
station_stopped=0
station_activated=0
station_finish() {
  station_result=$?
  trap - EXIT
  if [ "$station_result" -ne 0 ] && [ "$station_stopped" = 1 ] &&
     [ "$station_activated" = 0 ]; then
    # The new process has never run, so the old data still pairs with old code.
    set +e
    station_recovery=0
    for station_part in dist node_modules; do
      if [ -d "$station_stage/previous/$station_part" ]; then
        if [ -e "$station_part" ]; then
          mv -- "$station_part" "$station_stage/failed-$station_part" || station_recovery=1
        fi
        if [ ! -e "$station_part" ]; then
          mv -- "$station_stage/previous/$station_part" "$station_part" || station_recovery=1
        fi
      fi
    done
    if [ "$(git rev-parse HEAD)" != "$station_old_commit" ]; then
      git switch --detach "$station_old_commit" || station_recovery=1
    fi
    if [ "$station_recovery" = 0 ]; then
      sudo systemctl start space-station || station_recovery=1
      curl --fail --silent --show-error --retry 10 --retry-connrefused \
        --retry-delay 1 --max-time 5 http://127.0.0.1:3001/api/health || station_recovery=1
    fi
    if [ "$station_recovery" = 0 ]; then
      echo 'Update failed before activation; the previous service has been restored.' >&2
    else
      echo 'Automatic recovery failed; inspect service status and the preserved artifacts.' >&2
    fi
  elif [ "$station_result" -ne 0 ] && [ "$station_activated" = 1 ]; then
    echo 'The new process may have used the data. Inspect logs and use the paired backup for recovery; no automatic data rollback was attempted.' >&2
  fi
  printf '\nPreserved staging/previous artifacts: %s\n' "$station_stage"
  exit "$station_result"
}
trap station_finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

git archive "$station_target" | tar -x -C "$station_stage"
(
  cd "$station_stage"
  npm ci --include=dev
  npm test
  npm run build
  test -s dist/server/index.cjs
  test -s dist/client/index.html
)
mkdir "$station_stage/previous"
test -z "$(git status --porcelain)"
test "$(git rev-parse HEAD)" = "$station_old_commit"
test "$(git branch --show-current)" = main

# All installation and build work has passed while the old service stays up.
station_stopped=1
bash "$station_stage/deploy/backup.sh" --apache-config "$station_apache_config" --keep-stopped
git merge --ff-only "$station_target"
mv -- node_modules "$station_stage/previous/node_modules"
mv -- dist "$station_stage/previous/dist"
mv -- "$station_stage/node_modules" node_modules
mv -- "$station_stage/dist" dist
sudo -u space-station test -r /opt/space-station/dist/server/index.cjs
sudo -u space-station test -r /opt/space-station/dist/client/index.html

# From this point a new process could write data, even if startup fails.
station_activated=1
sudo systemctl start space-station
curl --fail --silent --show-error --retry 10 --retry-connrefused \
  --retry-delay 1 --max-time 5 http://127.0.0.1:3001/api/health
printf '\n'
git log -1 --format='%h %s'
echo 'Update activated. Check the public site, refresh clients, and test a room.'
