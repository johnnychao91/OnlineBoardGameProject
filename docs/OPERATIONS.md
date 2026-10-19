# Pi 5 日常維護：更新、備份、還原與排錯

本文件接續 [完整部署步驟](DEPLOYMENT.md)，適用於已完成部署的 Raspberry Pi OS／Debian 64 位元主機。以下指令在 Pi 的 SSH 終端機執行，使用 Bash 與具有 `sudo` 權限的原部署帳號。這些是操作程序，並不代表已在你的 Pi 上執行或驗收。

本文 `example.com` 及其子網域都是示範值。執行時在私人終端機替換為自己的網址；不要把真實站點、私有設定、備份或操作紀錄寫回公開 Git。主機上的 `/etc` 配置與 `/var/lib` 資料獨立於版本庫。

| 項目 | 本文件使用的設定 |
| --- | --- |
| 遊戲網址 | `https://boardgame.example.com` |
| 原有主網站 | `https://example.com`，保留原有設定 |
| 程式與 Git 儲存庫 | `/opt/space-station`，由 SSH 部署帳號擁有 |
| Node.js 24 | `/opt/node24/bin/node` |
| 私有環境設定 | `/etc/space-station.env` |
| 正式遊戲資料 | `/var/lib/space-station` |
| 服務設定 | `/etc/systemd/system/space-station.service` |
| Apache 遊戲站設定 | `/etc/apache2/sites-available/space-station.conf` |
| ACME 驗證目錄 | `/var/www/space-station-acme` |
| 本機備份 | `/var/backups/space-station`，僅 root 可讀 |

日常執行 Git、npm、測試與建置時使用部署帳號，不要加 `sudo`。只有服務管理、私有資料、設定檔與備份需要 `sudo`。正式服務只執行一份，請勿再以 `npm start` 或其他工具啟動第二個程序共用資料目錄。

## 1. 先確認服務狀況

```bash
sudo systemctl status space-station --no-pager
curl --fail --silent --show-error --retry 10 --retry-connrefused --retry-delay 1 --max-time 5 http://127.0.0.1:3001/api/health
curl --fail --silent --show-error --retry 10 --retry-connrefused --retry-delay 1 --max-time 5 https://boardgame.example.com/api/health
```

兩個健康檢查都應回傳 `{"status":"ok"}`。這只確認服務能回應，無法替代實際遊戲測試。也請確認主網站 `https://example.com` 仍可開啟。

## 2. 做一份停服備份

先與朋友約定維護時間，最好等所有對局結束。備份期間遊戲會暫時無法連線。回放、全站統計與已發出的邀請／回放授權都來自遊戲資料，必須一起保存。

下列整段可直接執行。它會先檢查 Git 工作目錄、記錄目前版本，再停止服務，確認程序乾淨結束後才備份。**完成後保持停服**，方便接續更新；若只做備份，請依本節最後的指令重新啟動。

```bash
(
  set -euo pipefail
  export PATH="/opt/node24/bin:$PATH"
  cd /opt/space-station

  if [ -n "$(git status --porcelain)" ]; then
    echo '程式目錄有本機修改；請先確認及保存修改，再做版本化備份。' >&2
    exit 1
  fi

  backup_commit=$(git rev-parse HEAD)
  backup_node=$(node --version)
  backup_npm=$(npm --version)

  sudo bash -s -- "$backup_commit" "$backup_node" "$backup_npm" <<'BACKUP'
set -euo pipefail
umask 077

systemctl stop space-station
test "$(systemctl show space-station --property=MainPID --value)" = '0'
test "$(systemctl show space-station --property=ActiveState --value)" = 'inactive'
test "$(systemctl show space-station --property=Result --value)" = 'success'

install -d -m 0700 /var/backups/space-station
backup_dir="/var/backups/space-station/$(date -u +%Y%m%dT%H%M%SZ)-${1:0:12}"
mkdir -m 0700 "$backup_dir"

printf '%s\n' "$1" > "$backup_dir/source-commit.txt"
printf 'Node=%s\nnpm=%s\nCreatedUTC=%s\n' "$2" "$3" "$(date -u +%FT%TZ)" \
  > "$backup_dir/runtime.txt"

tar -czf "$backup_dir/data.tar.gz" -C /var/lib space-station
tar -czf "$backup_dir/config.tar.gz" -C / \
  etc/space-station.env \
  etc/systemd/system/space-station.service \
  etc/apache2/sites-available/space-station.conf

cd "$backup_dir"
sha256sum data.tar.gz config.tar.gz source-commit.txt runtime.txt > SHA256SUMS
sha256sum --check SHA256SUMS
printf '\n備份完成：%s\n服務目前已停止。\n' "$backup_dir"
BACKUP
)
```

請記下最後印出的完整備份路徑。時間戳記使用 UTC，與臺灣時間相差 8 小時。`SHA256SUMS` 用於偵測備份損壞；它不是來源簽章，只還原你自己管理、可信任的備份。

任何步驟報錯都先停止後續更新。若停止服務逾時、`Result` 不是 `success`，查看 `sudo journalctl -u space-station -n 100 --no-pager`，不要把那次資料宣稱為乾淨的一致性備份。備份中途磁碟滿或壓縮失敗時，留下的目錄也不能當成成功備份；須有完整檔案且雜湊驗證通過。

單純備份且整段成功時，重新啟動原版本：

```bash
sudo systemctl start space-station
sudo systemctl status space-station --no-pager
curl --fail --silent --show-error --retry 10 --retry-connrefused --retry-delay 1 --max-time 5 http://127.0.0.1:3001/api/health
```

備份不包含 Node 安裝檔、`node_modules`、建置產物或 HTTPS 私鑰；程式可按記錄的提交版本重新取得及建置。憑證與其他主機設定請另外納入你原有的系統備份。ACME 驗證目錄不是遊戲資料。

### 備份保存方式

`data.tar.gz` 含隱藏角色、牌面、回放與玩家憑證；`config.tar.gz` 含建房密鑰。它們不能放進 Git、Apache 網頁目錄、公開雲端連結或傳給朋友。

只留在同一張 SD 卡／SSD 上的備份無法應付磁碟故障。請另留一份在受保護的外接儲存裝置或私人備份主機，並驗證複製後的雜湊。若用 Linux 檔案系統外接磁碟，先確認它確實已掛載，再把選定備份整個目錄以 `sudo cp -a` 複製過去；FAT／exFAT 的權限保護方式不同，應先加密備份再搬移。不要為了方便下載而把備份開成網站網址。

建議至少保留最近 7 份日常備份與最近一次升級前備份，並定期做隔離還原驗證。本專案沒有啟用自動備份或自動清理排程；本文件也不會替你新增排程。

## 3. 從 GitHub 更新

先完整執行第 2 節，取得成功備份並保持停服。若上一節已重新啟動，必須再停止並重新備份，才能確保更新前的最新狀態已保存。

以下流程使用既有 Git remote，僅允許 fast-forward 更新，保留 `/etc/space-station.env` 與正式資料。`--include=dev` 是必要的：測試、TypeScript 與前端建置都需要開發依賴。

```bash
(
  set -euo pipefail
  export PATH="/opt/node24/bin:$PATH"
  cd /opt/space-station

  test "$(sudo systemctl show space-station --property=MainPID --value)" = '0'
  test "$(sudo systemctl show space-station --property=ActiveState --value)" = 'inactive'
  test "$(sudo systemctl show space-station --property=Result --value)" = 'success'
  test -z "$(git status --porcelain)"
  test "$(git branch --show-current)" = 'main'

  git pull --ff-only
  npm ci --include=dev
  npm test
  npm run build

  sudo systemctl start space-station
  sudo systemctl status space-station --no-pager
  curl --fail --silent --show-error --retry 10 --retry-connrefused --retry-delay 1 --max-time 5 http://127.0.0.1:3001/api/health
  curl --fail --silent --show-error --retry 10 --retry-connrefused --retry-delay 1 --max-time 5 https://boardgame.example.com/api/health
  git log -1 --format='%h %s'
)
```

`set -e` 使安裝、測試或建置失敗時立即停止，**不會繼續啟動半成品**。如果失敗發生在服務已啟動之後，先執行 `sudo systemctl stop space-station`，檢查日誌，再依下節回退；不要持續反覆啟動未知狀態的版本。

更新成功後，請所有玩家重新整理頁面。再開一個測試房，確認加入、4 人開始、斷線重連、觀戰、賽後回放及圖片下載。GitHub 的 Windows／Linux CI 成功，仍不等於這部 ARM64 Pi 與 Apache 的驗收已通過。

通常應用程式更新不需要修改或重新載入 Apache。若新版明確要求更新 `deploy/` 範本，先比對差異，再保留本機網域、Node 路徑與憑證路徑套用；不要直接覆蓋現有設定。變更 systemd 後需 `sudo systemctl daemon-reload`，變更 Apache 後須先 `sudo apachectl configtest`，通過才 `sudo systemctl reload apache2`。

## 4. 失敗回退與還原

有兩種情況：

- 新版從未啟動，只在安裝、測試或建置失敗：資料未被新版服務使用，可先照 4.3 回到備份的程式版本、重新建置，成功後啟動。
- 新版已啟動、需要還原歷史資料，或無法確定資料是否改變：以同一份備份配對程式版本和資料，依 4.1～4.4 完整還原。

還原到舊備份會失去備份之後的新對局和進度。先停止服務並保留目前資料；不要直接覆寫、合併或刪除正在使用的資料目錄。程式碼回退不會自動回退資料格式。

### 4.1 選擇並驗證備份，解包到新目錄

列出備份，選擇已成功完成的那一份：

```bash
sudo ls -1 /var/backups/space-station
```

把下一段第一行換成實際備份路徑。預備目錄 `/var/lib/space-station-restore` 必須尚不存在；若以前做過還原，先確認並保存它，或在整份程序一致使用另一個新的預備目錄，不要直接刪除舊目錄。

```bash
restore_backup='/var/backups/space-station/請替換成實際備份目錄'

sudo bash -s -- "$restore_backup" <<'PREPARE'
set -euo pipefail
umask 077
test -d "$1"
cd "$1"
sha256sum --check SHA256SUMS
test ! -e /var/lib/space-station-restore
mkdir -m 0700 /var/lib/space-station-restore
mkdir -m 0700 /var/lib/space-station-restore/config
tar -xzf data.tar.gz -C /var/lib/space-station-restore
tar -xzf config.tar.gz -C /var/lib/space-station-restore/config
install -m 0600 source-commit.txt /var/lib/space-station-restore/source-commit.txt
install -m 0600 runtime.txt /var/lib/space-station-restore/runtime.txt
PREPARE
```

這一步尚未變更正式資料或正式設定。接著檢查資料能解析，且房間索引對應的對局檔存在；不印出牌面或憑證：

```bash
sudo /opt/node24/bin/node - /var/lib/space-station-restore/space-station <<'CHECK'
const fs = require('node:fs');
const path = require('node:path');
const root = process.argv[2];
if (!fs.statSync(root).isDirectory()) throw new Error('缺少資料目錄');
const matches = path.join(root, 'matches');
if (!fs.statSync(matches).isDirectory()) throw new Error('缺少 matches 目錄');
const index = path.join(root, 'rooms.json');
const rooms = fs.existsSync(index) ? JSON.parse(fs.readFileSync(index, 'utf8')) : [];
if (!Array.isArray(rooms)) throw new Error('房間索引格式錯誤');
let count = 0;
for (const file of fs.readdirSync(matches)) {
  if (!file.endsWith('.json')) continue;
  const entry = JSON.parse(fs.readFileSync(path.join(matches, file), 'utf8'));
  if (entry.schemaVersion !== 1) throw new Error('發現其他資料格式，需另行驗證相容性');
  count++;
}
for (const room of rooms) {
  if (!/^[A-Za-z0-9_-]{16}$/.test(room.roomId) ||
      !fs.existsSync(path.join(matches, room.roomId + '.json'))) {
    throw new Error('房間索引與對局檔不一致');
  }
}
if (!fs.existsSync(index) && count > 0) throw new Error('有對局但缺少房間索引');
console.log(`基本檢查通過：${rooms.length} 間房、${count} 份對局檔。`);
CHECK
```

此檢查只驗證 JSON、schema 版本及基本檔案關聯，無法證明每場遊戲規則或全部權限都正確。保留未改動的原始備份，再做後面的啟動與遊玩驗收；不要為了讓檢查通過而手改 JSON。

### 4.2 停服並保存目前狀態

在替換前，若目前服務能正常啟動、停止，先用第 2 節另外做一份備份並保持停服。這份備份應與你選來還原的舊備份不同。若新版已啟動失敗、無法通過乾淨停服檢查，不能宣稱已做一致性備份；下面仍會在確認沒有程序後保留現況的整份資料、設定和停止結果，供後續排查。

下段會把目前整個資料目錄改名保留，再把已驗證的隔離資料放到正式位置。正式 `DATA_DIR` 路徑不變，因此不需變動 service 的 `ReadWritePaths`。

```bash
sudo bash <<'RESTORE_DATA'
set -euo pipefail
umask 077
systemctl stop space-station
test "$(systemctl show space-station --property=MainPID --value)" = '0'
case "$(systemctl show space-station --property=ActiveState --value)" in
  inactive|failed) ;;
  *) echo '服務尚未停止，不能替換資料。' >&2; exit 1 ;;
esac
test -d /var/lib/space-station-restore/space-station
test ! -L /var/lib/space-station
test ! -L /var/lib/space-station-restore/space-station
previous_data="/var/lib/space-station-before-restore-$(date -u +%Y%m%dT%H%M%SZ)"
test ! -e "$previous_data"
mkdir -m 0700 "${previous_data}-config"
cp -a /etc/space-station.env "${previous_data}-config/space-station.env"
cp -a /etc/systemd/system/space-station.service "${previous_data}-config/space-station.service"
cp -a /etc/apache2/sites-available/space-station.conf "${previous_data}-config/space-station.conf"
systemctl show space-station --property=MainPID,ActiveState,Result \
  > "${previous_data}-config/stopped-status.txt"
mv -T /var/lib/space-station "$previous_data"
mv -T /var/lib/space-station-restore/space-station /var/lib/space-station
chown -R space-station:space-station /var/lib/space-station
find /var/lib/space-station -type d -exec chmod 0700 {} +
find /var/lib/space-station -type f -exec chmod 0600 {} +
printf '原資料完整保留在：%s\n服務仍停止，請繼續恢復程式及設定。\n' "$previous_data"
RESTORE_DATA
```

原設定另外保存在同名加上 `-config` 的 root 私有目錄。若其中 `stopped-status.txt` 的 `Result` 不是 `success`，這是故障現況保存，不能視為乾淨備份。如果第二個 `mv` 失敗，立即停止後續步驟；原資料仍保存在印出或可由目錄名稱找到的 `space-station-before-restore-*` 位置。不要建立空資料目錄後貿然啟動服務。

### 4.3 回到備份配對的程式版本

讀取備份的提交版本，但以部署帳號操作 Git，避免 root 的 Git 所有權檢查問題。下面使用 detached HEAD 保留 `main`，不使用強制 reset，也不丟棄本機修改。

完整還原時，執行：

```bash
(
  set -euo pipefail
  export PATH="/opt/node24/bin:$PATH"
  cd /opt/space-station
  test "$(sudo systemctl show space-station --property=MainPID --value)" = '0'
  test -z "$(git status --porcelain)"
  rollback_commit=$(sudo cat /var/lib/space-station-restore/source-commit.txt)
  git cat-file -e "${rollback_commit}^{commit}"
  git switch --detach "$rollback_commit"
  npm ci --include=dev
  npm test
  npm run build
)
```

若只回退程式、沒有執行 4.1，請將 `rollback_commit` 那一行改為讀取選定備份的 `/var/backups/space-station/實際備份目錄/source-commit.txt`。若提交物件不存在，先確認 remote，再以一般部署帳號 `git fetch origin`，不要換成不相關版本。

建置失敗就保持停服。另比對 `runtime.txt`：本專案要求 Node 24.x；若同時更動過 Node，應依 [部署文件](DEPLOYMENT.md) 重新準備相容版本。不要用其他主版本勉強啟動。

### 4.4 恢復設定並驗收

完整還原時，先確認第 4.2 節已保存目前設定，再將同份備份的設定放回。若你後來改過網域、憑證或目錄，先在私有終端機檢查差異，調整成有效設定後才套用；不要把密鑰內容貼到公開對話或 Issue。

```bash
sudo install -m 0600 /var/lib/space-station-restore/config/etc/space-station.env \
  /etc/space-station.env
sudo install -m 0644 /var/lib/space-station-restore/config/etc/systemd/system/space-station.service \
  /etc/systemd/system/space-station.service
sudo install -m 0644 /var/lib/space-station-restore/config/etc/apache2/sites-available/space-station.conf \
  /etc/apache2/sites-available/space-station.conf
```

只回退程式且設定未變時，略過上述設定還原。接著執行：

```bash
(
  set -euo pipefail
  sudo apachectl configtest
  sudo systemctl daemon-reload
  sudo systemctl start space-station
  curl --fail --silent --show-error --retry 10 --retry-connrefused --retry-delay 1 --max-time 5 http://127.0.0.1:3001/api/health
  sudo systemctl reload apache2
  curl --fail --silent --show-error --retry 10 --retry-connrefused --retry-delay 1 --max-time 5 https://boardgame.example.com/api/health
)
```

確認原有房主與玩家使用原瀏覽器能回到備份當時的座位、角色與進度，並檢查觀戰、回放及全站統計。資料還原不會復原已過期的邀請或分享期限，也不能召回已下載的戰報圖。玩家在瀏覽器內的身份憑證不會因伺服器備份而移到另一個裝置，請不要清除網站儲存空間來測試還原。

驗收失敗先停服，保留目前還原資料和日誌。先前 `space-station-before-restore-*` 的整份資料與第 4.2 節的備份都還在；依同樣的停服、隔離驗證、配對程式與設定程序回復，勿將兩套 `rooms.json`／`matches` 混在一起。

回退後 Git 會停在 detached HEAD。確認後續新版可用時，先做停服備份，再以部署帳號 `git switch main`，接續第 3 節的更新、測試與建置程序。

## 5. 日誌與常見問題

常用檢查指令：

```bash
sudo journalctl -u space-station -n 100 --no-pager
sudo journalctl -u space-station --since '30 minutes ago' --no-pager
sudo tail -n 100 /var/log/apache2/space-station-error.log
sudo apachectl configtest
sudo apachectl -S
sudo ss -ltnp 'sport = :3001'
df -h /var/lib/space-station /var/backups/space-station
sudo du -sh /var/lib/space-station /var/backups/space-station
```

需要即時跟隨應用程式日誌可用 `sudo journalctl -u space-station -f`，按 `Ctrl+C` 結束觀看；這不會停止服務。對外求助前先移除密鑰、憑證、邀請及分享內容，不要張貼完整環境設定或資料 JSON。

| 現象 | 檢查與處理 |
| --- | --- |
| Apache 回傳 502／503 | 先查 service 狀態與本機健康檢查；確認 Node 只監聽 `127.0.0.1:3001`，Apache 指向相同埠。 |
| `203/EXEC` 或 Node 找不到 | 檢查 `/opt/node24/bin/node --version` 與 unit 的 `ExecStart`；服務有 `ProtectHome=true`，不能改用家目錄的 nvm。 |
| `EACCES`／唯讀檔案系統 | 核對資料目錄擁有者、`DATA_DIR=/var/lib/space-station` 及 unit 的 `ReadWritePaths=/var/lib/space-station`；勿以關閉全部隔離權限代替修正路徑。 |
| API 403「來源不被允許」 | 核對 `PUBLIC_ORIGIN=https://boardgame.example.com`，不能有尾斜線，也不要從 IP、http 或其他子網域玩；Apache 應保留原來的 `Origin`。 |
| 網頁可開啟，遊戲無法同步 | 檢查 Apache 的 `proxy`／`proxy_http`、`upgrade=websocket` 及 `ProxyTimeout 90`；瀏覽器網路工具應能看到 Socket.IO polling 或 WebSocket 正常連線。 |
| npm 找不到／缺少 Vite、TypeScript | 先 `export PATH="/opt/node24/bin:$PATH"`，使用 `npm ci --include=dev`；不要以 root 執行 npm。 |
| Git 拒絕更新／工作目錄有修改 | 用 `git status` 檢視並保存本機修改。不要直接 `reset --hard`、刪除檔案或設定全域信任所有 Git 路徑。 |
| 網址或憑證錯誤 | 查 DNS 的 A／AAAA、`apachectl -S` 與憑證涵蓋網域；主網域憑證不一定包含 `boardgame` 子網域。 |
| 同一 Wi-Fi 出現 429 | 暫停重複刷新並等一分鐘，再檢查輪詢與代理 IP 設定；不要直接取消所有流量限制。 |
| 舊邀請／回放連結失效 | 邀請預設 24 小時，回放分享 7 天；可由房主重設邀請或在完整終局回放重新分享。已撤銷或過期的連結不能靠重啟服務恢復。 |

資料不會在邀請或分享過期後自動刪除，逐步回放也會持續占用磁碟。先監控容量與備份，再規劃資料保存政策；目前沒有單房刪除 API，請勿手動只刪一份對局檔或 `rooms.json`。

## 6. 憑證續期與相容性提醒

沿用部署時的 Certbot／既有憑證管理方式。若是依本專案的 Certbot webroot 程序部署，可定期手動驗證：

```bash
sudo certbot renew --dry-run
```

此命令驗證本機已登記的續期設定，可能涵蓋其他網站；失敗時先確認 DNS、80 埠、ACME webroot 例外路徑和憑證管理設定。不要為更新遊戲而停用既有憑證續期排程。應用程式、Apache、OS 與 Node 安全更新是不同工作，各自需要保留可回復版本與驗收結果。

目前資料使用 schema 1。0.1 的既有對局可載入，但缺少逐步快照的舊局不會補造完整回放；更新後才開始的新局才有完整記錄。這不包含更早的 boardgame.io FlatFile 格式，後者沒有自動遷移。未來遊戲規則或資料格式變更時，請先查看對應版本的遷移說明，再決定能否沿用既有對局。
