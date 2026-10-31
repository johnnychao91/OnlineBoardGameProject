# 將既有 Pi 部署改名為 boardgame

平台可容納多款遊戲，正式服務及部署目錄統一使用 `boardgame`。「太空維修站」的遊戲 ID `space-station`、Socket.IO namespace、既有房間與回放內容保留，讓朋友原有的身份與連結繼續使用。這份遷移只處理平台部署名稱，同時安裝要部署的新版程式。

**本文件適用於目前使用 `/opt/space-station`、`space-station.service` 的標準部署，且 Git 歷史與目前 GitHub 儲存庫相同。** 全新安裝直接看 [部署手冊](DEPLOYMENT.md)。已完成改名後使用 [維運手冊](OPERATIONS.md)；不需要重複執行遷移。

所有命令在 Pi 的 SSH 終端機執行，使用原本的部署帳號。實際網域、Apache 設定路徑與密鑰都留在 Pi；範例網域 `boardgame.example.com` 不是真實部署值，不要把私人設定寫回公開 Git。

## 遷移結果

| 項目 | 原本 | 完成後 |
| --- | --- | --- |
| 程式與 Git clone | `/opt/space-station` | `/opt/boardgame` |
| systemd 服務 | `space-station.service` | `boardgame.service` |
| 服務帳號／群組 | `space-station` | `boardgame`，保留原 UID／GID |
| 私有環境設定 | `/etc/space-station.env` | `/etc/boardgame.env` |
| 遊戲資料 | `/var/lib/space-station` | `/var/lib/boardgame` |
| 新備份位置 | `/var/backups/space-station` | `/var/backups/boardgame` |
| 已存在的舊備份 | `/var/backups/space-station/*` | `/var/backups/boardgame/legacy-space-station/*`，封存內容不改寫 |
| ACME webroot（原本有使用時） | `/var/www/space-station-acme` | `/var/www/boardgame-acme` |
| 已知的 Apache 續期 hook | `space-station-reload-apache`／`space-station-apache` | `boardgame-reload-apache`／`boardgame-apache` |
| 遊戲 Apache 新寫入的日誌 | `/var/log/apache2/space-station-*.log` | `/var/log/apache2/boardgame-*.log` |

`PUBLIC_ORIGIN`、私有房間暗語設定與實際憑證不重新建立；env 內的 `DATA_DIR` 改成 `/var/lib/boardgame`。Node 24 仍位於 `/opt/node24`，監聽位址仍為 `127.0.0.1:3001`。其他遊戲之後可以共用平台服務，不需要各自再設一份 `space-station` 服務。

所指定 Apache vhost 的檔名保留，腳本只修改其中已知的舊 ACME 及日誌路徑；其他站台設定、`ServerName`、憑證名稱及監聽埠保留。如果原本使用 ACME webroot，會一併備份並修改引用該舊目錄的 Certbot renewal 設定；原本採 standalone 的部署仍使用 standalone。已知 hook 改檔名但保留其內容與憑證範圍判斷。自訂其他名稱的維護腳本或外部排程請自行檢查是否引用舊服務或路徑。

歷史日誌、之前更新留下的暫存目錄及原備份內容會保留原名稱，以免破壞排錯與回復依據；正式執行的服務、資料和新產生的備份使用新名稱。這些歷史副本不是仍在執行的第二套平台。

## 在舊部署執行一次

先等對局結束，確認備份磁碟有足夠空間。遷移會先在獨立目錄下載、安裝、測試與建置；完成後才停服、備份與切換。不要同時執行其他更新、備份或還原程序。

**不要先 `git pull`，也不要先手動 `mv` 目錄或重建設定。** 舊 clone 可能尚未有遷移腳本；以下先 fetch，再直接讀取目標提交內的腳本，因此原本運作的程式不會提前改變。先確認目標版本已推上 GitHub 且 CI 通過。

```bash
(
  set -euo pipefail
  export PATH="/opt/node24/bin:$PATH"
  cd /opt/space-station

  test -z "$(git status --porcelain)"
  test "$(git branch --show-current)" = main
  git fetch origin
  git log -1 --format='%h %s' origin/main

  read -r -p 'Apache 遊戲站設定的完整路徑：' boardgame_apache_config
  sudo test -s "$boardgame_apache_config"
  sudo -v

  git show origin/main:deploy/migrate-to-boardgame.sh |
    bash -s -- --apache-config "$boardgame_apache_config"
)
```

輸入目前真正啟用的遊戲 vhost 檔案，例如 `/etc/apache2/sites-available/boardgame.example.com.conf`；不要選主網站的設定或備份副本。腳本會檢查原服務、程式、設定、資料，以及新目錄／帳號是否已存在。若主機已部分手動改名，應先釐清現況，不能把拒絕檢查刪掉後強行執行。

遷移前會把資料、設定、原提交版本及 checksum 備份至 `/var/backups/boardgame/migration-*`。請保留終端機印出的完整備份與建置目錄路徑。密鑰不會因這次改名而重新產生，也不應出現在終端機輸出或 Git。

## 完成後驗收

使用新名稱查看服務並驗證本機 API：

```bash
cd /opt/boardgame
git log -1 --oneline
git status --short
sudo systemctl status boardgame --no-pager
sudo journalctl -u boardgame -n 50 --no-pager
curl --fail --silent --show-error --retry 10 --retry-connrefused --retry-delay 1 --max-time 5 \
  http://127.0.0.1:3001/api/health
sudo apachectl configtest
```

健康檢查應回傳 `{"status":"ok"}`。再從手機行動網路打開原本網址，確認主網站、開房、邀請、觀戰、既有回放與 WebSocket 正常；遊戲網址不因平台改名而改變。現有玩家應使用原瀏覽器回到房間，不要清除網站儲存空間。

確認新版正常後，做一份採用新名稱的備份：

```bash
read -r -p '目前 Apache 遊戲站設定的完整路徑：' boardgame_apache_config
cd /opt/boardgame
bash deploy/backup.sh --apache-config "$boardgame_apache_config"
```

這份新備份可直接配合 [一般還原程序](OPERATIONS.md#4-失敗回退與還原)。原遷移備份及更早的備份仍需保留，並另存加密的異機副本。

如有改動 ACME webroot，依原憑證名稱執行一次 `sudo certbot renew --cert-name boardgame.example.com --dry-run`，其中示範名稱需換成 Pi 已登記的真實憑證名稱。若要手動測試帶有 `RENEWED_LINEAGE` 判斷的 hook，必須提供原憑證的完整路徑，例如 `/etc/letsencrypt/live/boardgame.example.com`（需替換示範名稱）；單獨執行該 hook 可能因條件不符而略過 reload。舊版 Certbot 不一定支援 `--run-deploy-hooks`，可將續期模擬與 hook 手動測試分開。

以後重新啟動、查看日誌及修改密碼都使用：

```bash
sudo systemctl restart boardgame
sudo journalctl -u boardgame -n 100 --no-pager
sudo nano /etc/boardgame.env
```

編輯 env 後需要再 `sudo systemctl restart boardgame` 才會載入新設定。一般程式更新從 `/opt/boardgame` 開始，使用 [維運手冊第 3 節](OPERATIONS.md#3-從-github-更新) 的 `deploy/update.sh`；不要再使用舊目錄或舊服務名稱。

## 舊備份與回復

改名不會重寫歷史備份。`legacy-space-station` 下的舊備份，以及 `migration-*` 的遷移前備份，`data.tar.gz` 內仍是 `space-station/`；`config.tar.gz` 內仍可能包含 `etc/space-station.env`、舊 service、舊 hook 路徑及原 Apache 設定。外層資料夾叫 `boardgame` 不代表內容已轉換。

需要還原時，先在 root 私有的新目錄驗證 `SHA256SUMS`、列出 `tar -tzf` 內容，並核對 `source-commit.txt`。不要直接解壓到 `/`，也不要把舊設定套用到正在使用新名稱的服務：

- 完整回到遷移前狀態，必須配對原提交、資料、帳號、目錄和設定，並先停止 `boardgame`，確定沒有第二個服務同時使用資料。保留目前的新資料與設定以便排錯；舊備份時間之後的進度不會自動合併。
- 要在新平台保留舊對局，先將可信備份解包到隔離目錄，驗證資料格式與新程式相容性，再明確轉換資料根目錄及 env／service 的部署路徑。不能只改備份檔名，也不能重新命名 JSON 內的遊戲 ID。
- 遷移腳本的備份用於復原當時的整套狀態。一般還原手冊會拒絕舊資料根目錄；這項檢查是避免錯誤套用，不要略過。

建置或預檢失敗發生在停服之前時，原服務不會切換。切換中失敗且新版尚未嘗試啟動時，腳本會嘗試回復原路徑、程式、設定與帳號，再啟動原服務。**新版只要嘗試啟動，就可能改寫資料；之後若失敗，會停止新版並保留現況，不自動覆蓋資料或切回舊程式。**

失敗時保留錯誤及腳本印出的路徑，先檢查 `systemctl status`、`journalctl` 和磁碟狀況，再決定使用哪一份配對備份。不要反覆重跑遷移、強制刪除新目錄，或同時啟動新舊服務。腳本不能保證停電、磁碟故障或被強制終止後自動回復；部分遷移狀態需要依實際進度復原。
