#!/usr/bin/env bash
# Run as the deployment user; sudo is used only for private data and systemd.
set -euo pipefail

boardgame_apache_config=''
boardgame_keep_stopped=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --apache-config)
      [ "$#" -ge 2 ] || { echo 'Missing --apache-config path.' >&2; exit 2; }
      boardgame_apache_config=$2
      shift 2
      ;;
    --keep-stopped)
      boardgame_keep_stopped=1
      shift
      ;;
    *)
      echo 'Usage: bash deploy/backup.sh --apache-config /etc/apache2/sites-available/ACTUAL.conf [--keep-stopped]' >&2
      exit 2
      ;;
  esac
done

[ -n "$boardgame_apache_config" ] || { echo 'Specify the actual Apache configuration file with --apache-config.' >&2; exit 2; }
[ "$(id -u)" -ne 0 ] || { echo 'Run this script as the deployment user, without sudo.' >&2; exit 2; }
boardgame_repo=$(git rev-parse --show-toplevel)
cd "$boardgame_repo"
boardgame_lock=$(realpath -m "$(git rev-parse --git-path boardgame-maintenance.lock)")
if [ "$(readlink "/proc/$$/fd/9" 2>/dev/null || true)" != "$boardgame_lock" ]; then
  exec 9>"$boardgame_lock"
fi
flock -n 9 || { echo 'Another backup or update is already running.' >&2; exit 1; }
test -z "$(git status --porcelain)" || { echo 'Save local repository changes before backing up.' >&2; exit 1; }
export PATH="/opt/node24/bin:$PATH"
boardgame_commit=$(git rev-parse HEAD)
boardgame_node=$(node --version)
boardgame_npm=$(npm --version)

sudo bash -s -- "$boardgame_commit" "$boardgame_node" "$boardgame_npm" \
  "$boardgame_apache_config" "$boardgame_keep_stopped" <<'BACKUP'
set -euo pipefail
umask 077
boardgame_apache=$(realpath -e -- "$4")
case "$boardgame_apache" in
  /etc/apache2/sites-available/*.conf) ;;
  *) echo 'Apache configuration must be inside /etc/apache2/sites-available.' >&2; exit 1 ;;
esac
test -s "$boardgame_apache"
test -s /etc/boardgame.env
test -s /etc/systemd/system/boardgame.service
test -d /var/lib/boardgame
test ! -L /var/lib/boardgame
boardgame_prior_state=$(systemctl show boardgame --property=ActiveState --value)
case "$boardgame_prior_state" in
  active|inactive) ;;
  *) echo 'Service is not in a stable active/inactive state; inspect its logs first.' >&2; exit 1 ;;
esac

install -d -o root -g root -m 0700 /var/backups/boardgame
boardgame_backup=$(mktemp -d "/var/backups/boardgame/$(date -u +%Y%m%dT%H%M%SZ)-${1:0:12}.XXXXXX")
boardgame_stopped=0
boardgame_complete=0
boardgame_keep_stopped=$5
boardgame_finish() {
  boardgame_result=$?
  trap - EXIT
  if [ "$boardgame_stopped" = 1 ] && [ "$boardgame_prior_state" = active ] &&
     { [ "$boardgame_complete" != 1 ] || [ "$boardgame_keep_stopped" != 1 ]; }; then
    if ! systemctl start boardgame; then
      echo 'Could not restart the original service; inspect systemctl status boardgame.' >&2
      boardgame_result=1
    elif ! curl --fail --silent --show-error --retry 10 --retry-connrefused \
      --retry-delay 1 --max-time 5 http://127.0.0.1:3001/api/health >/dev/null; then
      echo 'The restarted service did not pass its health check.' >&2
      boardgame_result=1
    fi
  fi
  if [ "$boardgame_complete" != 1 ]; then
    printf 'Backup incomplete; do not restore from: %s\n' "$boardgame_backup" >&2
  fi
  exit "$boardgame_result"
}
trap boardgame_finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

printf '%s\n' "$1" > "$boardgame_backup/source-commit.txt"
printf 'Node=%s\nnpm=%s\nCreatedUTC=%s\n' "$2" "$3" "$(date -u +%FT%TZ)" > "$boardgame_backup/runtime.txt"
printf '%s\n' "$boardgame_apache" > "$boardgame_backup/apache-config-path.txt"
boardgame_config_files=(
  etc/boardgame.env \
  etc/systemd/system/boardgame.service \
  "${boardgame_apache#/}"
)
for boardgame_hook in \
  /etc/letsencrypt/renewal-hooks/deploy/boardgame-reload-apache \
  /etc/letsencrypt/renewal-hooks/deploy/boardgame-apache; do
  if [ -f "$boardgame_hook" ]; then
    boardgame_config_files+=("${boardgame_hook#/}")
  fi
done
tar -czf "$boardgame_backup/config.tar.gz" -C / "${boardgame_config_files[@]}"

# Mark this before stop so even a failed/partial stop attempts recovery.
boardgame_stopped=1
systemctl stop boardgame
test "$(systemctl show boardgame --property=MainPID --value)" = 0
test "$(systemctl show boardgame --property=ActiveState --value)" = inactive
test "$(systemctl show boardgame --property=Result --value)" = success
tar -czf "$boardgame_backup/data.tar.gz" -C /var/lib boardgame
(
  cd "$boardgame_backup"
  sha256sum data.tar.gz config.tar.gz source-commit.txt runtime.txt apache-config-path.txt > SHA256SUMS
  sha256sum --check SHA256SUMS
)
boardgame_complete=1
printf '\nBackup verified: %s\n' "$boardgame_backup"
if [ "$boardgame_keep_stopped" = 1 ] || [ "$boardgame_prior_state" = inactive ]; then
  printf '%s\n' 'Service remains stopped.'
else
  printf '%s\n' 'Restarting the original service.'
fi
BACKUP
