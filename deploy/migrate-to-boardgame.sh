#!/usr/bin/env bash
# One-time migration of the original Pi installation; game IDs never change.
set -euo pipefail
umask 022

if [ "$#" != 2 ] || [ "$1" != --apache-config ]; then
  echo 'Usage: bash deploy/migrate-to-boardgame.sh --apache-config /etc/apache2/sites-available/ACTUAL.conf' >&2
  exit 2
fi
[ "$(id -u)" -ne 0 ] || { echo 'Run as the deployment user, without sudo.' >&2; exit 2; }
boardgame_apache=$2
boardgame_deployer=$(id -un)
export PATH="/opt/node24/bin:$PATH"
cd /opt/space-station
test "$(pwd -P)" = /opt/space-station
boardgame_lock=$(realpath -m "$(git rev-parse --git-path space-station-maintenance.lock)")
exec 9>"$boardgame_lock"
flock -n 9 || { echo 'Another legacy backup, update, or migration is running.' >&2; exit 1; }
# This lock moves with .git and also excludes a new-name update during activation.
exec 8>"$(realpath -m "$(git rev-parse --git-path boardgame-maintenance.lock)")"
flock -n 8 || { echo 'Another boardgame maintenance command is running.' >&2; exit 1; }
test -z "$(git status --porcelain)"
test "$(git branch --show-current)" = main
test "$(node -p 'process.versions.node.split(".")[0]')" = 24
boardgame_old_commit=$(git rev-parse HEAD)
git fetch origin
boardgame_target=$(git rev-parse origin/main)
git merge-base --is-ancestor "$boardgame_old_commit" "$boardgame_target"
git cat-file -e "$boardgame_target:deploy/boardgame.service"

# Run twice: before the slow build, and immediately before the root transaction.
# Values in /etc/*.env are treated as text, never evaluated as shell commands.
boardgame_root_migrate() {
  set -euo pipefail
  umask 077
  # Each invocation has its own root shell. Keep recovery state at shell scope:
  # Bash can unwind function locals before running an EXIT trap on errexit.
  mode=$1 stage=$2 old_commit=$3 target=$4 apache_config=$5 deployer=$6
  backup='' stopped=0 started=0
  config_files=() renewal_files=() hook_files=()
  apache=$(realpath -e -- "$apache_config")
  case "$apache" in
    /etc/apache2/sites-available/*.conf) ;;
    *) echo 'Apache config must be inside /etc/apache2/sites-available.' >&2; return 1 ;;
  esac
  test -s "$apache"
  for file in /opt/space-station /var/lib/space-station /etc/space-station.env \
    /etc/systemd/system/space-station.service; do
    test -e "$file"
    test ! -L "$file"
  done
  for file in /opt/boardgame /var/lib/boardgame /etc/boardgame.env \
    /etc/systemd/system/boardgame.service /var/backups/boardgame \
    /var/www/boardgame-acme; do
    if [ -e "$file" ] || [ -L "$file" ]; then
      printf 'Destination already exists; inspect an earlier migration before retrying: %s\n' "$file" >&2
      return 1
    fi
  done
  if getent passwd boardgame >/dev/null || getent group boardgame >/dev/null; then
    echo 'The boardgame user or group already exists; inspect it before migration.' >&2
    return 1
  fi
  old_uid=$(id -u space-station)
  old_gid=$(id -g space-station)
  group_name=$(getent group "$old_gid" | cut -d: -f1)
  test "$group_name" = space-station
  old_home=$(getent passwd space-station | cut -d: -f6)
  test "$old_home" = /var/lib/space-station
  test "$(stat -c %u /opt/space-station)" = "$(id -u "$deployer")"
  test "$(stat -c %u /var/lib/space-station)" = "$old_uid"
  test -z "$(systemctl show space-station --property=DropInPaths --value)"
  test "$(systemctl show space-station --property=FragmentPath --value)" = /etc/systemd/system/space-station.service
  test "$(systemctl show boardgame --property=LoadState --value)" = not-found
  systemctl is-active --quiet space-station
  old_enabled=$(systemctl is-enabled space-station)
  test "$old_enabled" = enabled
  # Reject customized service layouts instead of guessing how to move them.
  grep -qx 'User=space-station' /etc/systemd/system/space-station.service
  grep -qx 'Group=space-station' /etc/systemd/system/space-station.service
  grep -qx 'WorkingDirectory=/opt/space-station' /etc/systemd/system/space-station.service
  grep -qx 'EnvironmentFile=/etc/space-station.env' /etc/systemd/system/space-station.service
  test "$(grep -c '^DATA_DIR=' /etc/space-station.env)" = 1
  grep -qx 'DATA_DIR=/var/lib/space-station' /etc/space-station.env
  grep -qx 'HOST=127.0.0.1' /etc/space-station.env
  grep -qx 'PORT=3001' /etc/space-station.env
  test -d /opt/space-station/node_modules
  test -s /opt/space-station/dist/server/index.cjs
  for file in /var/backups/space-station /var/www/space-station-acme; do
    if [ -e "$file" ] || [ -L "$file" ]; then
      test -d "$file"
      test ! -L "$file"
    fi
  done
  for site in /etc/apache2/sites-available/*.conf /etc/apache2/conf-enabled/*.conf; do
    [ -f "$site" ] || continue
    if [ "$(realpath -e -- "$site")" != "$apache" ] &&
       grep -qF /var/www/space-station-acme "$site"; then
      echo 'The old ACME webroot is referenced by another Apache configuration; review that shared setup before migration.' >&2
      return 1
    fi
  done
  config_files=(etc/space-station.env etc/systemd/system/space-station.service "${apache#/}")
  for hook in space-station-reload-apache space-station-apache; do
    file="/etc/letsencrypt/renewal-hooks/deploy/$hook"
    test ! -e "${file/space-station/boardgame}"
    test ! -L "${file/space-station/boardgame}"
    if [ -e "$file" ] || [ -L "$file" ]; then
      test -f "$file"
      test ! -L "$file"
      hook_files+=("$file")
      config_files+=("${file#/}")
    fi
  done
  for renewal in /etc/letsencrypt/renewal/*.conf; do
    [ -f "$renewal" ] || continue
    if grep -qF /var/www/space-station-acme "$renewal"; then
      test ! -L "$renewal"
      renewal_files+=("$renewal")
      config_files+=("${renewal#/}")
    fi
  done
  /usr/sbin/apache2ctl configtest
  if [ "$mode" = check ]; then
    echo 'Legacy installation preflight passed.'
    return
  fi
  test "$mode" = migrate
  case "$stage" in /opt/boardgame-migrate.*) ;; *) return 1 ;; esac
  test ! -L "$stage"
  test "$(realpath -e -- "$stage")" = "$stage"
  test -s "$stage/dist/server/index.cjs"
  test -s "$stage/dist/client/index.html"
  test -s "$stage/deploy/boardgame.service"
  test -d "$stage/previous"
  test "$(sudo -u "$deployer" git -C /opt/space-station rev-parse HEAD)" = "$old_commit"
  test -z "$(sudo -u "$deployer" git -C /opt/space-station status --porcelain)"
  test "$(sudo -u "$deployer" git -C /opt/space-station branch --show-current)" = main

  boardgame_migration_finish() {
    result=$?
    trap - EXIT
    set +e
    if [ "$result" -ne 0 ] && [ "$started" = 1 ]; then
      # A new process may already have written: preserve that data, never replace it.
      systemctl stop boardgame
      echo 'New service startup was attempted. Current data and all backups are preserved; inspect journalctl -u boardgame before any manual recovery.' >&2
    elif [ "$result" -ne 0 ] && [ "$stopped" = 1 ]; then
      recovery=0
      systemctl disable boardgame >/dev/null 2>&1
      if [ -e /etc/systemd/system/boardgame.service ]; then
        mv /etc/systemd/system/boardgame.service "$backup/failed-boardgame.service" || recovery=1
      fi
      if getent group boardgame >/dev/null; then
        groupmod -n space-station boardgame || recovery=1
      fi
      if getent passwd boardgame >/dev/null; then
        usermod -l space-station -d "$old_home" boardgame || recovery=1
      fi
      if [ -d /opt/boardgame ] && [ ! -e /opt/space-station ]; then
        mv /opt/boardgame /opt/space-station || recovery=1
      fi
      if [ -d /var/lib/boardgame ] && [ ! -e /var/lib/space-station ]; then
        mv /var/lib/boardgame /var/lib/space-station || recovery=1
      fi
      if [ -f /etc/boardgame.env ] && [ ! -e /etc/space-station.env ]; then
        mv /etc/boardgame.env /etc/space-station.env || recovery=1
      fi
      if [ -d /var/www/boardgame-acme ] && [ ! -e /var/www/space-station-acme ]; then
        mv /var/www/boardgame-acme /var/www/space-station-acme || recovery=1
      fi
      if [ -d /var/backups/boardgame/legacy-space-station ] && [ ! -e /var/backups/space-station ]; then
        mv /var/backups/boardgame/legacy-space-station /var/backups/space-station || recovery=1
      fi
      for hook in "${hook_files[@]}"; do
        if [ -e "${hook/space-station/boardgame}" ]; then
          mv "${hook/space-station/boardgame}" "$hook" || recovery=1
        fi
      done
      tar -xzf "$backup/config.tar.gz" -C / || recovery=1
      for file in dist node_modules; do
        if [ -d "$stage/previous/$file" ]; then
          if [ -e "/opt/space-station/$file" ]; then
            mv "/opt/space-station/$file" "$stage/failed-$file" || recovery=1
          fi
          mv "$stage/previous/$file" "/opt/space-station/$file" || recovery=1
        fi
      done
      if [ "$(sudo -u "$deployer" git -C /opt/space-station rev-parse HEAD)" != "$old_commit" ]; then
        sudo -u "$deployer" bash -c 'umask 022; exec git "$@"' bash \
          -C /opt/space-station switch --detach "$old_commit" || recovery=1
      fi
      sudo -u space-station test -r /opt/space-station/package.json || recovery=1
      systemctl daemon-reload || recovery=1
      /usr/sbin/apache2ctl configtest || recovery=1
      if [ "$recovery" = 0 ]; then
        systemctl reload apache2 || recovery=1
        systemctl enable --now space-station || recovery=1
        curl --fail --silent --show-error --retry 10 --retry-connrefused \
          --retry-delay 1 --max-time 5 http://127.0.0.1:3001/api/health || recovery=1
      fi
      if [ "$recovery" = 0 ]; then
        echo 'Migration failed before new-service startup; the original service and paths were restored.' >&2
      else
        echo 'Recovery needs attention; inspect the preserved backup and both service statuses.' >&2
      fi
    fi
    printf '\nMigration backup: %s\nPreserved staging: %s\n' "$backup" "$stage"
    if [ "$result" -ne 0 ]; then
      echo 'Do not rerun blindly: the destination backup directory intentionally remains as evidence of this attempt.' >&2
    fi
    exit "$result"
  }
  install -d -o root -g root -m 0700 /var/backups/boardgame
  backup=$(mktemp -d "/var/backups/boardgame/migration-$(date -u +%Y%m%dT%H%M%SZ)-${old_commit:0:12}.XXXXXX")
  trap boardgame_migration_finish EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  printf '%s\n' "$old_commit" > "$backup/source-commit.txt"
  printf 'Node=%s\nCreatedUTC=%s\nMigrationTarget=%s\n' \
    "$(/opt/node24/bin/node --version)" "$(date -u +%FT%TZ)" "$target" > "$backup/runtime.txt"
  printf '%s\n' "$apache" > "$backup/apache-config-path.txt"
  printf 'User=space-station\nUID=%s\nGID=%s\nHome=%s\nEnabled=%s\n' \
    "$old_uid" "$old_gid" "$old_home" "$old_enabled" > "$backup/deployment-state.txt"
  tar -czf "$backup/config.tar.gz" -C / "${config_files[@]}"

  stopped=1
  systemctl stop space-station
  test "$(systemctl show space-station --property=MainPID --value)" = 0
  test "$(systemctl show space-station --property=ActiveState --value)" = inactive
  test "$(systemctl show space-station --property=Result --value)" = success
  if pgrep -u "$old_uid" >/dev/null; then
    echo 'Other processes still use the service account; migration stopped.' >&2
    exit 1
  fi
  tar -czf "$backup/data.tar.gz" -C /var/lib space-station
  (
    cd "$backup"
    sha256sum data.tar.gz config.tar.gz source-commit.txt runtime.txt \
      apache-config-path.txt deployment-state.txt > SHA256SUMS
    sha256sum --check SHA256SUMS
  )
  touch "$backup/BACKUP_COMPLETE"

  # The existing account keeps its numeric IDs and all file ownership.
  usermod -l boardgame -d /var/lib/boardgame space-station
  groupmod -n boardgame space-station
  mv /var/lib/space-station /var/lib/boardgame
  mv /etc/space-station.env /etc/boardgame.env
  sed -i 's|^DATA_DIR=/var/lib/space-station$|DATA_DIR=/var/lib/boardgame|' /etc/boardgame.env
  chmod 0600 /etc/boardgame.env
  chown root:root /etc/boardgame.env
  if [ -d /var/backups/space-station ]; then
    mv /var/backups/space-station /var/backups/boardgame/legacy-space-station
  fi
  if [ -d /var/www/space-station-acme ]; then
    mv /var/www/space-station-acme /var/www/boardgame-acme
  fi
  for renewal in "${renewal_files[@]}"; do
    sed -i 's|/var/www/space-station-acme|/var/www/boardgame-acme|g' "$renewal"
  done
  for hook in "${hook_files[@]}"; do
    mv "$hook" "${hook/space-station/boardgame}"
    # Certificate lineage/domain comparisons inside existing hooks stay intact.
    sed -i 's|/var/www/space-station-acme|/var/www/boardgame-acme|g' "${hook/space-station/boardgame}"
  done
  sed -i \
    -e 's|/var/www/space-station-acme|/var/www/boardgame-acme|g' \
    -e 's|/var/log/apache2/space-station-|/var/log/apache2/boardgame-|g' "$apache"
  /usr/sbin/apache2ctl configtest

  # Public checkout files must remain readable by the separate service account.
  # Set this inside the target user's shell; sudo may retain the root 077 umask.
  sudo -u "$deployer" bash -c 'umask 022; exec git "$@"' bash \
    -C /opt/space-station merge --ff-only "$target"
  mv /opt/space-station/node_modules "$stage/previous/node_modules"
  mv /opt/space-station/dist "$stage/previous/dist"
  mv "$stage/node_modules" /opt/space-station/node_modules
  mv "$stage/dist" /opt/space-station/dist
  mv /opt/space-station /opt/boardgame
  sudo -u boardgame test -r /opt/boardgame/package.json
  sudo -u boardgame test -r /opt/boardgame/dist/server/index.cjs
  sudo -u boardgame test -r /opt/boardgame/dist/client/index.html
  install -o root -g root -m 0644 "$stage/deploy/boardgame.service" /etc/systemd/system/boardgame.service
  systemctl disable space-station
  mv /etc/systemd/system/space-station.service "$backup/retired-space-station.service"
  systemctl daemon-reload
  systemctl enable boardgame
  systemctl reload apache2
  # Set this BEFORE start: even a failed start might have modified persisted data.
  started=1
  systemctl start boardgame
  curl --fail --silent --show-error --retry 10 --retry-connrefused \
    --retry-delay 1 --max-time 5 http://127.0.0.1:3001/api/health
  touch "$backup/MIGRATION_COMPLETE"
  echo 'Migration activated. Use /opt/boardgame and systemctl status boardgame.'
  exit 0
}

# The function runs in a new root shell, with no secret config printed to stdout.
boardgame_run_root() {
  {
    declare -f boardgame_root_migrate
    printf 'boardgame_root_migrate "$@"\n'
  } | sudo bash -s -- "$1" "${boardgame_stage:-}" "$boardgame_old_commit" \
    "$boardgame_target" "$boardgame_apache" "$boardgame_deployer"
}
boardgame_run_root check
boardgame_stage=$(sudo mktemp -d /opt/boardgame-migrate.XXXXXX)
sudo chown "$(id -u):$(id -g)" "$boardgame_stage"
printf 'Preparing migration in: %s\n' "$boardgame_stage"
git archive "$boardgame_target" | tar -x -C "$boardgame_stage"
(
  cd "$boardgame_stage"
  npm ci --include=dev
  npm test
  npm run build
)
mkdir "$boardgame_stage/previous"
boardgame_run_root migrate
# The inherited working directory has been renamed; select the canonical path.
cd /opt/boardgame
git log -1 --format='%h %s'
echo 'Refresh browser clients, check the public site, and test one room.'
