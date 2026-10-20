# Pi 5 完整部署（範例網域）

**所有 `example.com` 網址皆為保留示範值，不是本專案的正式站點。** 執行命令時以自己的網域替換；實際值只寫入 Pi 上的 `/etc/boardgame.env` 和 `/etc/apache2/sites-available/boardgame.conf`。不要為了部署而修改、提交 Git 裡的 `.env.example`、`deploy/` 範本或這份文件。先將範本複製到 `/etc`，再用 `sudoedit` 修改那份私有配置。網址、DNS 與憑證名稱必須一致。

本指南把遊戲部署到 **https://boardgame.example.com**，沿用 Pi 5 上既有的 Apache，保留 **https://example.com** 主網站。所有 `bash` 指令都在 SSH 登入 Pi 後執行，不是在 Windows PowerShell 執行。使用具有 sudo 權限的一般帳號，只有標示 `sudo` 的管理步驟使用 root。

這是操作指南，尚未替你的 Pi、DNS、路由器或憑證做任何變更。前提為仍受安全更新支援的 Raspberry Pi OS／Debian **64 位元**、systemd、Apache 2.4.47 以上；32 位元系統不能直接使用下方 ARM64 Node 安裝包。每個程式區塊成功後再往下做，遇到錯誤先修正。

首次上線依序完成第 1～9 節；之後使用 [更新、備份與還原手冊](OPERATIONS.md)。整個桌遊平台的服務、帳號及正式目錄統一稱為 `boardgame`；「太空維修站」是其中一款遊戲，其既有遊戲 ID 保留以相容對局及回放。

**已使用 `/opt/space-station` 與 `space-station.service` 上線的機器，先執行一次 [平台名稱遷移](MIGRATION.md)。** 不要直接在舊目錄套用新版一般更新腳本，也不要重新建立私有設定。遷移完成後才使用本文件的 `boardgame` 路徑與維運命令。

**若 Pi 留有刪除、重建 GitHub 儲存庫之前的舊 clone，不能直接套用一般更新流程。** 新舊提交歷史不同，不要合併無關歷史，也不要使用 `--allow-unrelated-histories`。先依維運手冊完成停服備份，保留舊程式目錄作為回復來源，再從新的 GitHub 儲存庫 clone 到新的空目錄；若仍要使用下方固定的 `/opt/boardgame` 路徑，先將已確認的舊程式目錄另名保留。沿用 Git 外既有的 `/etc/boardgame.env`、Apache／憑證設定與 `/var/lib/boardgame` 資料，不要重建密鑰、覆蓋設定或把舊 `.git` 搬進新 clone。新程式建置成功、服務路徑確認無誤後，再啟動並驗收。

```text
朋友手機／電腦 → HTTPS/WSS :443 → Pi 的 Apache
                                    ├─ example.com → 原本主網站
                                    └─ boardgame.example.com
                                            ↓ 僅本機代理
                                      127.0.0.1:3001 Node.js
                                            ↓
                                      /var/lib/boardgame
                                      房間、對局、回放、統計來源
```

## 1. 從 GitHub clone，確認 Pi 環境

先在 Pi 的終端機確認環境及既有網站設定：

```bash
cat /etc/os-release
uname -m
getconf LONG_BIT
apache2 -v
sudo apachectl -S
df -h / /var/lib /opt
sudo ss -ltnp
```

預期架構為 `aarch64`、位元數為 `64`。確認 3001 尚未被其他服務占用，記下主網站所用的 Apache 設定檔；不要停用它。若現有網站經由 Cloudflare Tunnel、CDN 或外部代理，先閱讀第 6 節的入口說明。

安裝基本工具並 clone。`/opt/boardgame` 必須是尚不存在的新目錄；若已存在，先確認是目前儲存庫的部署，還是上面所述的舊 clone，再選擇更新或重新 clone，不能覆蓋既有目錄。

```bash
sudo apt update
sudo apt install -y git curl ca-certificates xz-utils openssl dnsutils
```

```bash
(
  set -eu
  test ! -e /opt/boardgame
  sudo install -d -o "$(id -un)" -g "$(id -gn)" -m 0755 /opt/boardgame
  git clone https://github.com/johnnychao91/OnlineBoardGameProject.git /opt/boardgame
)
cd /opt/boardgame
git status --short
git log -1 --oneline
```

GitHub 公開儲存庫不需要填入 token。程式由登入的部署帳號維護，遊戲執行時另外使用無法登入的服務帳號。不要在 Pi 修改已追蹤的程式檔；私有設定放在 `/etc`，之後依維運手冊使用更新腳本，先在獨立目錄建置成功再切換版本。

## 2. 安裝 Node.js 24 ARM64

專案目前要求 **Node.js 24.x**，不要直接改用 Node 26。本指南使用官方 ARM64 壓縮包，獨立安裝到 `/opt/node24`，不替換其他服務使用的系統 Node。官方提供 [24.x 發行檔與 SHA-256 清單](https://nodejs.org/download/release/latest-v24.x/)。

以下區塊從官方 checksum 清單選出當時的 24.x ARM64 版本，再從固定版本網址下載並驗證；`/opt/node24` 已存在時會停止，避免覆蓋既有 runtime。

```bash
(
  set -eu
  test "$(uname -m)" = aarch64
  test "$(getconf LONG_BIT)" = 64
  test ! -e /opt/node24
  boardgame_tmp=$(mktemp -d)
  cd "$boardgame_tmp"
  curl --fail --silent --show-error --location \
    https://nodejs.org/download/release/latest-v24.x/SHASUMS256.txt -o SHASUMS256.txt
  boardgame_archive=$(awk '$2 ~ /^node-v24\.[0-9]+\.[0-9]+-linux-arm64\.tar\.xz$/ { print $2 }' SHASUMS256.txt)
  test -n "$boardgame_archive"
  boardgame_version=${boardgame_archive#node-}
  boardgame_version=${boardgame_version%-linux-arm64.tar.xz}
  curl --fail --silent --show-error --location \
    "https://nodejs.org/download/release/$boardgame_version/$boardgame_archive" -o "$boardgame_archive"
  awk -v target="$boardgame_archive" '$2 == target' SHASUMS256.txt | sha256sum --check -
  sudo install -d -m 0755 /opt/node24
  sudo tar -xJf "$boardgame_archive" -C /opt/node24 --strip-components=1 --no-same-owner
  /opt/node24/bin/node --version
)
```

驗證下載時應顯示 `OK`，版本應為 `v24.x.x`。在目前 SSH 工作階段設定 PATH；以後重新登入、要執行 npm 時也先執行：

```bash
export PATH="/opt/node24/bin:$PATH"
node --version
npm --version
```

若已安裝可供服務讀取的 Node 24，可以略過下載；但後面的 service `ExecStart` 必須改成實際 Node 絕對路徑，建置也使用相同版本。不要指向家目錄內的 nvm，因為服務範本啟用 `ProtectHome=true`。

此獨立 Node 安裝不會隨 `apt upgrade` 更新；日後也要查看 Node 24 安全修補版，停服、備份後以新的已驗證安裝目錄替換 runtime，保留原版本以便回退。

## 3. 安裝套件、測試與建置

```bash
cd /opt/boardgame
export PATH="/opt/node24/bin:$PATH"
npm ci --include=dev
npm run check:public
npm run test:public
npm test
npm run build
test -f dist/server/index.cjs
test -f dist/client/index.html
```

每條指令都要成功。`npm run build` 包含 TypeScript 型別檢查。不要使用 `sudo npm`，不要搬 Windows 的 `node_modules`；`--include=dev` 確保仍會安裝建置工具。此時不需要複製 `.env.example`，正式設定由 systemd 提供。

## 4. 建立服務帳號與私有設定

| 路徑 | 用途／權限 |
| --- | --- |
| `/opt/boardgame` | 程式與建置；部署帳號可寫，服務帳號只讀 |
| `/opt/node24` | Node 24；root 管理，服務帳號只讀 |
| `/etc/boardgame.env` | 正式設定與建房密鑰；root、0600 |
| `/etc/apache2/sites-available/boardgame.conf`、`/etc/letsencrypt` | 實際網域、Apache 配置及憑證；由 root／Certbot 管理，保留私鑰權限 |
| `/var/lib/boardgame` | 房間、玩家憑證及完整回放；服務帳號、0700 |
| `/var/backups/boardgame` | 私有備份；root、0700 |
| `/var/www/boardgame-acme` | 僅供憑證驗證；不放程式或對局資料 |

建立服務帳號與資料目錄：

```bash
if ! id boardgame >/dev/null 2>&1; then
  sudo useradd --system --user-group --home-dir /var/lib/boardgame \
    --no-create-home --shell /usr/sbin/nologin boardgame
fi
sudo install -d -o boardgame -g boardgame -m 0700 /var/lib/boardgame
```

首次建立設定。以下在 Pi 本機產生隨機建房密鑰，直接寫入 0600 私有檔；已有設定時拒絕覆蓋：

```bash
sudo bash <<'SH'
set -eu
test ! -e /etc/boardgame.env
umask 077
{
  printf '%s\n' \
    'NODE_ENV=production' \
    'HOST=127.0.0.1' \
    'PORT=3001' \
    'PUBLIC_ORIGIN=https://boardgame.example.com' \
    'DATA_DIR=/var/lib/boardgame'
  printf 'CREATE_ROOM_KEY=%s\n' "$(openssl rand -hex 32)"
} > /etc/boardgame.env
chmod 0600 /etc/boardgame.env
SH
```

**啟動服務之前，必須修改剛建立的私有設定：**

```bash
sudoedit /etc/boardgame.env
```

把 `PUBLIC_ORIGIN` 的示範值改成你自己的實際遊戲 HTTPS origin，格式為 `https://你的遊戲主機名稱`，不能有結尾 `/`、子路徑或查詢字串。`boardgame.example.com` 只是示範，不能照填作為正式網址。實際值只改在這份 `/etc` 檔案，後續 Apache 與憑證也只設定在 `/etc`；不要修改 Git 裡的 `.env.example`、`deploy/` 範本或文件。

需要建房密鑰時，在自己的私人 SSH 終端機用 `sudo nano /etc/boardgame.env` 查看，保存到密碼管理器。不要將檔案、畫面或密鑰上傳 GitHub。只有建立房間的人需要密鑰，朋友只要邀請連結。

`PUBLIC_ORIGIN` 必須與朋友實際開啟的遊戲網址一致。保留 `HOST=127.0.0.1`，對外只開 Apache 的 80／443，不開 3001。不要啟動兩個程序共用同一個 `DATA_DIR`。

## 5. 讓 systemd 自動啟動遊戲

確認服務帳號可讀取建置與 Node，再安裝 [service 範本](../deploy/boardgame.service)：

```bash
cd /opt/boardgame
sudo -u boardgame test -r /opt/boardgame/dist/server/index.cjs
sudo -u boardgame /opt/node24/bin/node --version
sudo install -o root -g root -m 0644 deploy/boardgame.service \
  /etc/systemd/system/boardgame.service
sudo systemctl daemon-reload
sudo systemctl enable --now boardgame
sudo systemctl status boardgame --no-pager
sudo journalctl -u boardgame -n 50 --no-pager
curl --fail --silent --show-error --retry 10 --retry-connrefused --retry-delay 1 --max-time 5 http://127.0.0.1:3001/api/health
```

預期服務為 `active (running)`，健康檢查回傳 `{"status":"ok"}`。若失敗，先看日誌再配置代理。systemd 會在 Pi 開機時啟動，服務意外結束時嘗試重啟；關閉 SSH 不會停止遊戲。

若嚴格的 shell umask 導致程式不可讀，用 `namei -l /opt/boardgame/dist/server/index.cjs` 找出目錄權限；調整僅限不含秘密的程式目錄，不要放寬 env 或資料目錄權限。

## 6. 新增 DNS，沿用原本的網路入口

在 DNS 管理介面新增一筆紀錄，**兩種選一種，不要同時設同名 A 與 CNAME**：

| 類型 | 名稱 | 值 |
| --- | --- | --- |
| A | `boardgame` | 和原站入口相同的公開 IPv4 |
| CNAME | `boardgame` | `example.com`（主網域確實通往同一入口時使用） |

若有 AAAA，必須確認 IPv6 也通到這台 Pi 的 Apache，不要留下錯誤的 AAAA。家用浮動 IP 沿用既有 DDNS；DNS 不能填 `192.168.x.x` 這類區網 IP。

若原站已由路由器將外部 TCP 80／443 轉送到 Pi，通常可沿用。同一 Apache 依網域分流，不需要新增遊戲埠。保留原本 SSH 與防火牆規則，不要重置防火牆。用行動網路測試，避免區網 NAT loopback 混淆結果。

若使用 CDN／Cloudflare Proxy，入口需支援 WebSocket、轉送完整路徑，不要快取 `/api/*`、`/socket.io/*` 或帶身份資訊的回應；來源站也應使用有效 HTTPS。若使用 Cloudflare Tunnel／其他 tunnel，還要在既有入口新增 `boardgame.example.com` 主機路由，僅新增 DNS 不夠。**下面憑證流程假設外部 HTTP 80 可到達此 Apache**；CGNAT 或 tunnel 不轉送驗證路徑時，應沿用現有 tunnel 的 TLS 方案或使用 DNS-01，不要硬套 HTTP-01，也不要直接暴露 Node 3001。

```bash
dig +short boardgame.example.com A
dig +short boardgame.example.com AAAA
```

DNS 變更需傳播時間；主網站憑證不一定涵蓋子網域，接著為新網址取得憑證。

## 7. 先提供 HTTP 驗證，再取得 HTTPS 憑證

先備份 Apache 設定，再啟用模組。備份可能包含私有設定，放在 root 私有目錄：

```bash
sudo bash <<'SH'
set -eu
umask 077
install -d -o root -g root -m 0700 /var/backups/boardgame
tar -czf "/var/backups/boardgame/apache-before-$(date -u +%Y%m%dT%H%M%SZ).tar.gz" \
  -C / etc/apache2
SH
sudo a2enmod proxy proxy_http headers ssl alias
sudo install -d -o root -g root -m 0755 /var/www/boardgame-acme/.well-known/acme-challenge
```

先安裝 [只有 HTTP 的範本](../deploy/apache-http.conf.example)，此階段尚不對外提供遊戲。如果 `boardgame.conf` 已存在，先檢查，不要覆蓋其他站台：

```bash
cd /opt/boardgame
(
  set -eu
  test ! -e /etc/apache2/sites-available/boardgame.conf
  sudo install -o root -g root -m 0644 deploy/apache-http.conf.example \
    /etc/apache2/sites-available/boardgame.conf
  sudoedit /etc/apache2/sites-available/boardgame.conf
  sudo a2ensite boardgame.conf
  sudo apachectl configtest
  sudo systemctl reload apache2
)
```

應顯示 `Syntax OK`。確認 `apachectl -S` 的新網域對應到 `boardgame.conf`，主網站仍對應原設定。不要同時啟用兩份相同 `ServerName` 的設定。

建立不含秘密的驗證檔：

```bash
printf 'acme-ok\n' | sudo tee /var/www/boardgame-acme/.well-known/acme-challenge/check.txt >/dev/null
curl --fail http://boardgame.example.com/.well-known/acme-challenge/check.txt
```

再用手機行動網路開啟同一 HTTP 網址，應看到 `acme-ok`。只有 Pi 本機成功不代表 Let’s Encrypt 可從外部連上。如果主網站的 HSTS `includeSubDomains` 或瀏覽器 HTTPS-only 模式自動改成 HTTPS，此時尚未有憑證，瀏覽器可能報錯；改從外部電腦用 `curl` 測原 HTTP 網址，不要略過瀏覽器的憑證警告，也不要因此判定 HTTP-01 一定不可達。

先確認是否已安裝 Certbot：

```bash
command -v certbot
```

若已有 Certbot，沿用現有安裝及續期方式，不要混裝 apt、snap、pip。若尚未安裝，可用 Debian／Raspberry Pi OS 套件：

```bash
sudo apt install -y certbot
```

使用 webroot 取得憑證，不讓 Certbot 改原本主站 vhost。依互動提示填通知用 Email，閱讀並自行接受服務條款：

```bash
sudo certbot certonly --webroot -w /var/www/boardgame-acme \
  --cert-name boardgame.example.com -d boardgame.example.com
sudo certbot certificates
```

確認憑證路徑是 `boardgame.example.com`，存在 `fullchain.pem` 和 `privkey.pem`。若已有涵蓋此網域的有效憑證，可沿用並調整下節範本；不要為了湊路徑複製私鑰或反覆申請。

Webroot 使用 `/.well-known/acme-challenge/`，HTTP-01 需要外部 TCP 80 可達。[Certbot webroot 說明](https://eff-certbot.readthedocs.io/en/stable/using.html#webroot)、[Let’s Encrypt 驗證方式](https://letsencrypt.org/docs/challenge-types/)。

## 8. 啟用 HTTPS 與 WebSocket 反向代理

以 [完整 Apache 範本](../deploy/apache.conf.example) 取代剛才同一個設定檔。範本只服務 `boardgame.example.com`；保留主網站檔案與啟用狀態。

```bash
cd /opt/boardgame
(
  set -eu
  sudo test -s /etc/letsencrypt/live/boardgame.example.com/fullchain.pem
  sudo test -s /etc/letsencrypt/live/boardgame.example.com/privkey.pem
  sudo install -o root -g root -m 0644 deploy/apache.conf.example \
    /etc/apache2/sites-available/boardgame.conf
  sudoedit /etc/apache2/sites-available/boardgame.conf
  sudo apachectl configtest
  sudo systemctl reload apache2
)
curl --fail --silent --show-error https://boardgame.example.com/api/health
```

應回傳 `{"status":"ok"}`，瀏覽器開啟 **https://boardgame.example.com** 應顯示首頁。HTTP 一般網址轉 HTTPS；憑證驗證路徑仍留在 HTTP，供後續續期使用。

若 `configtest` 失敗，不要 reload 或重新啟動 Apache。首次安裝可把第 7 節的 `deploy/apache-http.conf.example` 放回同一個 `boardgame.conf`，通過 `configtest` 後 reload，保留 HTTP 驗證入口，再修正憑證路徑或模組。既有主站仍使用原設定；不要為了修遊戲而停用它。

範本以 `ProxyPass / http://127.0.0.1:3001/ upgrade=websocket` 處理前端、API、Socket.IO polling 與 WebSocket，使用 Apache 2.4.47 以上的 `mod_proxy_http`。`ProxyTimeout 90` 須大於 Socket.IO 心跳與逾時總和。不要改寫瀏覽器 `Origin`，也不要改掛 `/boardgame/` 子路徑，目前前端與路由以完整 origin 運作。[Apache 官方說明](https://httpd.apache.org/docs/2.4/mod/mod_proxy.html#protoupgrade)、[Socket.IO 代理說明](https://socket.io/docs/v4/reverse-proxy/)。

設定憑證成功續期後重新載入 Apache 的 hook；已有相同用途的 hook 可沿用一份：

```bash
sudo install -d -o root -g root -m 0755 /etc/letsencrypt/renewal-hooks/deploy
sudo tee /etc/letsencrypt/renewal-hooks/deploy/boardgame-apache >/dev/null <<'SH'
#!/bin/sh
set -eu
/usr/sbin/apachectl configtest
/usr/bin/systemctl reload apache2
SH
sudo chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/boardgame-apache
sudo certbot renew --cert-name boardgame.example.com --dry-run
systemctl list-timers --all | grep -i certbot
```

apt 安裝且尚未啟用 timer 時，執行 `sudo systemctl enable --now certbot.timer`。其他安裝方式確認原本排程，不要再開重複排程。`--dry-run` 通常不執行 deploy hook，可另執行 `sudo /etc/letsencrypt/renewal-hooks/deploy/boardgame-apache` 檢查。這些排程需由你在 Pi 執行指令，本文件尚未替你啟用。

## 9. 朋友如何加入，以及首次驗收

1. 你開啟 **https://boardgame.example.com**，輸入暱稱與私有建房密鑰建立房間。
2. 在房內按「分享／複製邀請連結」，把完整連結傳給朋友。不要只複製地址列，頁面可能已移除 fragment 中的邀請資訊；也不要省略連結的 `#` 後半段。
3. 朋友輸入暱稱，選參與或觀戰，不用安裝程式或輸入建房密鑰。4～8 位參與者全部準備後，房主開始，依當時人數配牌；觀戰不占名額。
4. 固定使用同一瀏覽器。通訊軟體內建瀏覽器若不能分享／下載，先選「在 Safari／Chrome 開啟」再加入；加入後換瀏覽器不會自動帶走座位。
5. 結束後可復盤、分享選定步驟、下載 PNG。回放連結是 7 天唯讀權限，房主能撤銷，與入房邀請分開。

邀請有效 24 小時；房主可重設邀請，既有玩家座位不受影響。分享如被轉傳，持有人可使用該權限，請只傳給預期朋友。觀戰者進行中就能切換上帝視角，需遵守你們接受的保密約定。

上線前用測試局確認：

- 手機行動網路可開新網址，主網站也仍正常。
- 錯誤建房密鑰被拒、邀請可入房；至少 4 個隔離瀏覽器／裝置完成準備、開局與一整局。
- 重新整理、短暫斷線、閒置數分鐘後可繼續；開發工具能看到 Socket.IO 及 WebSocket `101` 升級。
- 觀戰盲／上帝視角、回放、固定視角分享、撤銷、PNG 下載正常；重複觀看不增加戰績。
- 測試局中做一次 `sudo systemctl restart boardgame`，確認角色、牌面、進度、身份及統計保持，再依 [維運手冊](OPERATIONS.md) 實際備份與隔離還原。

Windows／Ubuntu CI 驗證的是安裝、型別、測試、建置；Pi ARM64、Apache、DNS、TLS 與磁碟恢復仍需以上實機驗收。

## 10. 後續更新與備份入口

完整命令集中在 [更新、備份與還原手冊](OPERATIONS.md)：

- 更新：取得 GitHub 更新，在獨立目錄安裝、測試與建置成功後，短暫停服、備份並切換新版。
- 備份：整份資料目錄，加上私有設定、service、Apache、程式版本與 checksum；另留一份加密的異機備份。
- 還原：先隔離驗證，再停服、保留目前資料、切換配對版本，不要覆寫正在使用的資料。

從 0.1 升到 0.2 的 schema 1 舊對局可繼續；已開始的舊局缺少完整歷史，不會補造回放或允許回放分享，完成後仍可計入統計。更新後新開局才有完整回放，更早 FlatFile 格式不在此相容範圍。

資料不會隨邀請／分享連結到期而刪除，目前沒有定期清理功能。定期查看資料、備份與日誌用量。暫存檔與 rename 不取代斷電防護及備份；可承載房數需在自己的 Pi 與網路量測。
