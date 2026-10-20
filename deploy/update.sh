#!/usr/bin/env bash
# Standard Pi deployment: /opt/boardgame, /opt/node24, boardgame.service.
set -euo pipefail
umask 022

if [ "$#" != 2 ] || [ "$1" != --apache-config ]; then
  echo 'Usage: bash deploy/update.sh --apache-config /etc/apache2/sites-available/ACTUAL.conf' >&2
  exit 2
fi
boardgame_apache_config=$2
[ "$(id -u)" -ne 0 ] || { echo 'Run as the deployment user, without sudo.' >&2; exit 2; }
cd /opt/boardgame
export PATH="/opt/node24/bin:$PATH"
boardgame_lock=$(realpath -m "$(git rev-parse --git-path boardgame-maintenance.lock)")
exec 9>"$boardgame_lock"
flock -n 9 || { echo 'Another backup or update is already running.' >&2; exit 1; }
test "$(node -p 'process.versions.node.split(".")[0]')" = 24
test -z "$(git status --porcelain)"
test "$(git branch --show-current)" = main
test -d dist
test -d node_modules
sudo test -s "$boardgame_apache_config"
sudo systemctl is-active --quiet boardgame
boardgame_old_commit=$(git rev-parse HEAD)
git fetch origin
boardgame_target=$(git rev-parse origin/main)
git merge-base --is-ancestor "$boardgame_old_commit" "$boardgame_target"
if [ "$boardgame_target" = "$boardgame_old_commit" ]; then
  echo 'Already at origin/main; no files or service state changed.'
  exit 0
fi

# A sibling on the same filesystem allows fast directory moves at activation.
boardgame_stage=$(sudo mktemp -d /opt/boardgame-update.XXXXXX)
sudo chown "$(id -u):$(id -g)" "$boardgame_stage"
boardgame_stopped=0
boardgame_activated=0
boardgame_finish() {
  boardgame_result=$?
  trap - EXIT
  if [ "$boardgame_result" -ne 0 ] && [ "$boardgame_stopped" = 1 ] &&
     [ "$boardgame_activated" = 0 ]; then
    # The new process has never run, so the old data still pairs with old code.
    set +e
    boardgame_recovery=0
    for boardgame_part in dist node_modules; do
      if [ -d "$boardgame_stage/previous/$boardgame_part" ]; then
        if [ -e "$boardgame_part" ]; then
          mv -- "$boardgame_part" "$boardgame_stage/failed-$boardgame_part" || boardgame_recovery=1
        fi
        if [ ! -e "$boardgame_part" ]; then
          mv -- "$boardgame_stage/previous/$boardgame_part" "$boardgame_part" || boardgame_recovery=1
        fi
      fi
    done
    if [ "$(git rev-parse HEAD)" != "$boardgame_old_commit" ]; then
      git switch --detach "$boardgame_old_commit" || boardgame_recovery=1
    fi
    if [ "$boardgame_recovery" = 0 ]; then
      sudo systemctl start boardgame || boardgame_recovery=1
      curl --fail --silent --show-error --retry 10 --retry-connrefused \
        --retry-delay 1 --max-time 5 http://127.0.0.1:3001/api/health || boardgame_recovery=1
    fi
    if [ "$boardgame_recovery" = 0 ]; then
      echo 'Update failed before activation; the previous service has been restored.' >&2
    else
      echo 'Automatic recovery failed; inspect service status and the preserved artifacts.' >&2
    fi
  elif [ "$boardgame_result" -ne 0 ] && [ "$boardgame_activated" = 1 ]; then
    echo 'The new process may have used the data. Inspect logs and use the paired backup for recovery; no automatic data rollback was attempted.' >&2
  fi
  printf '\nPreserved staging/previous artifacts: %s\n' "$boardgame_stage"
  exit "$boardgame_result"
}
trap boardgame_finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

git archive "$boardgame_target" | tar -x -C "$boardgame_stage"
(
  cd "$boardgame_stage"
  npm ci --include=dev
  npm test
  npm run build
  test -s dist/server/index.cjs
  test -s dist/client/index.html
)
mkdir "$boardgame_stage/previous"
test -z "$(git status --porcelain)"
test "$(git rev-parse HEAD)" = "$boardgame_old_commit"
test "$(git branch --show-current)" = main

# All installation and build work has passed while the old service stays up.
boardgame_stopped=1
bash "$boardgame_stage/deploy/backup.sh" --apache-config "$boardgame_apache_config" --keep-stopped
git merge --ff-only "$boardgame_target"
mv -- node_modules "$boardgame_stage/previous/node_modules"
mv -- dist "$boardgame_stage/previous/dist"
mv -- "$boardgame_stage/node_modules" node_modules
mv -- "$boardgame_stage/dist" dist
sudo -u boardgame test -r /opt/boardgame/dist/server/index.cjs
sudo -u boardgame test -r /opt/boardgame/dist/client/index.html

# From this point a new process could write data, even if startup fails.
boardgame_activated=1
sudo systemctl start boardgame
curl --fail --silent --show-error --retry 10 --retry-connrefused \
  --retry-delay 1 --max-time 5 http://127.0.0.1:3001/api/health
printf '\n'
git log -1 --format='%h %s'
echo 'Update activated. Check the public site, refresh clients, and test a room.'
