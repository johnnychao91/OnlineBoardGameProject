#!/usr/bin/env bash
# Run as the deployment user; sudo is used only for private data and systemd.
set -euo pipefail

station_apache_config=''
station_keep_stopped=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --apache-config)
      [ "$#" -ge 2 ] || { echo 'Missing --apache-config path.' >&2; exit 2; }
      station_apache_config=$2
      shift 2
      ;;
    --keep-stopped)
      station_keep_stopped=1
      shift
      ;;
    *)
      echo 'Usage: bash deploy/backup.sh --apache-config /etc/apache2/sites-available/ACTUAL.conf [--keep-stopped]' >&2
      exit 2
      ;;
  esac
done

[ -n "$station_apache_config" ] || { echo 'Specify the actual Apache configuration file with --apache-config.' >&2; exit 2; }
[ "$(id -u)" -ne 0 ] || { echo 'Run this script as the deployment user, without sudo.' >&2; exit 2; }
station_repo=$(git rev-parse --show-toplevel)
cd "$station_repo"
station_lock=$(realpath -m "$(git rev-parse --git-path space-station-maintenance.lock)")
if [ "$(readlink "/proc/$$/fd/9" 2>/dev/null || true)" != "$station_lock" ]; then
  exec 9>"$station_lock"
fi
flock -n 9 || { echo 'Another backup or update is already running.' >&2; exit 1; }
test -z "$(git status --porcelain)" || { echo 'Save local repository changes before backing up.' >&2; exit 1; }
export PATH="/opt/node24/bin:$PATH"
station_commit=$(git rev-parse HEAD)
station_node=$(node --version)
station_npm=$(npm --version)

sudo bash -s -- "$station_commit" "$station_node" "$station_npm" \
  "$station_apache_config" "$station_keep_stopped" <<'BACKUP'
set -euo pipefail
umask 077
station_apache=$(realpath -e -- "$4")
case "$station_apache" in
  /etc/apache2/sites-available/*.conf) ;;
  *) echo 'Apache configuration must be inside /etc/apache2/sites-available.' >&2; exit 1 ;;
esac
test -s "$station_apache"
test -s /etc/space-station.env
test -s /etc/systemd/system/space-station.service
test -d /var/lib/space-station
test ! -L /var/lib/space-station
station_prior_state=$(systemctl show space-station --property=ActiveState --value)
case "$station_prior_state" in
  active|inactive) ;;
  *) echo 'Service is not in a stable active/inactive state; inspect its logs first.' >&2; exit 1 ;;
esac

install -d -o root -g root -m 0700 /var/backups/space-station
station_backup=$(mktemp -d "/var/backups/space-station/$(date -u +%Y%m%dT%H%M%SZ)-${1:0:12}.XXXXXX")
station_stopped=0
station_complete=0
station_keep_stopped=$5
station_finish() {
  station_result=$?
  trap - EXIT
  if [ "$station_stopped" = 1 ] && [ "$station_prior_state" = active ] &&
     { [ "$station_complete" != 1 ] || [ "$station_keep_stopped" != 1 ]; }; then
    if ! systemctl start space-station; then
      echo 'Could not restart the original service; inspect systemctl status space-station.' >&2
      station_result=1
    elif ! curl --fail --silent --show-error --retry 10 --retry-connrefused \
      --retry-delay 1 --max-time 5 http://127.0.0.1:3001/api/health >/dev/null; then
      echo 'The restarted service did not pass its health check.' >&2
      station_result=1
    fi
  fi
  if [ "$station_complete" != 1 ]; then
    printf 'Backup incomplete; do not restore from: %s\n' "$station_backup" >&2
  fi
  exit "$station_result"
}
trap station_finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

printf '%s\n' "$1" > "$station_backup/source-commit.txt"
printf 'Node=%s\nnpm=%s\nCreatedUTC=%s\n' "$2" "$3" "$(date -u +%FT%TZ)" > "$station_backup/runtime.txt"
printf '%s\n' "$station_apache" > "$station_backup/apache-config-path.txt"
station_config_files=(
  etc/space-station.env \
  etc/systemd/system/space-station.service \
  "${station_apache#/}"
)
for station_hook in \
  /etc/letsencrypt/renewal-hooks/deploy/space-station-reload-apache \
  /etc/letsencrypt/renewal-hooks/deploy/space-station-apache; do
  if [ -f "$station_hook" ]; then
    station_config_files+=("${station_hook#/}")
  fi
done
tar -czf "$station_backup/config.tar.gz" -C / "${station_config_files[@]}"

# Mark this before stop so even a failed/partial stop attempts recovery.
station_stopped=1
systemctl stop space-station
test "$(systemctl show space-station --property=MainPID --value)" = 0
test "$(systemctl show space-station --property=ActiveState --value)" = inactive
test "$(systemctl show space-station --property=Result --value)" = success
tar -czf "$station_backup/data.tar.gz" -C /var/lib space-station
(
  cd "$station_backup"
  sha256sum data.tar.gz config.tar.gz source-commit.txt runtime.txt apache-config-path.txt > SHA256SUMS
  sha256sum --check SHA256SUMS
)
station_complete=1
printf '\nBackup verified: %s\n' "$station_backup"
if [ "$station_keep_stopped" = 1 ] || [ "$station_prior_state" = inactive ]; then
  printf '%s\n' 'Service remains stopped.'
else
  printf '%s\n' 'Restarting the original service.'
fi
BACKUP
