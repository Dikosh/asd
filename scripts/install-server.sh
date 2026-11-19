#!/usr/bin/env bash
# Установка или обновление Jolda на чистом сервере Ubuntu 22.04/24.04.
# Запуск под root:
#   curl -fsSL https://raw.githubusercontent.com/Dikosh/asd/main/scripts/install-server.sh | bash -s -- moindomen.kz
# Домен необязателен. С доменом сайт будет на https:// с бесплатным сертификатом
# (A-запись домена должна указывать на этот сервер). Без домена — http://IP-адрес.
# Повторный запуск обновляет код до последней версии; данные остаются в /var/lib/jolda. Домен и демо-режим
# прошлой установки сохраняются, указывать их заново не нужно (снять домен: `bash -s -- none`).
# Демо-стенд для показа (вход одним нажатием под любой ролью, коды входа на экране) — только явно:
#   curl -fsSL https://raw.githubusercontent.com/Dikosh/asd/main/scripts/install-server.sh | DEMO=1 bash -s -- moindomen.kz
# Настоящим пользователям демо-стенд открывать нельзя: в нём любой входит под любым номером и как администратор.
set -euo pipefail

DOMAIN="${1:-${DOMAIN:-}}"
# Домен при обновлении запоминается так же, как демо-режим: если его не указали, берётся из настроек веб-сервера
# прошлой установки. Иначе обновление «короткой командой» молча вернуло бы сайт на http:// и сломало вход.
# Сознательно вернуться к работе без домена: указать вместо домена слово none.
if [ -z "$DOMAIN" ] && [ -f /etc/caddy/Caddyfile ]; then
  PREV="$(awk '!/^[[:space:]]*(#|$)/ { if ($2 == "{") print $1; exit }' /etc/caddy/Caddyfile)"
  if printf '%s' "$PREV" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$'; then
    DOMAIN="$PREV"
    echo "Домен из прошлой установки: $DOMAIN"
  fi
fi
[ "$DOMAIN" = none ] && DOMAIN=""
REPO="${REPO:-https://github.com/Dikosh/asd.git}"
APP=/opt/jolda
DATA=/var/lib/jolda
# Демо-режим выключен, пока его не включили явно (DEMO=1). При обновлении сохраняется прежний выбор:
# демо-стенд остаётся демо-стендом, боевой сервер — боевым. Выключить демо: DEMO=0.
DEMO="${DEMO:-}"
if [ -z "$DEMO" ]; then
  if grep -qs '^Environment=DEMO_MODE=1$' /etc/systemd/system/jolda.service; then DEMO=1; else DEMO=0; fi
fi
[ "$DEMO" = 1 ] || DEMO=0

say() { printf '\n\033[1;34m== %s\033[0m\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "Запустите под root"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

say "Системные пакеты"
apt-get update -qq
apt-get install -y -qq ca-certificates curl git gnupg debian-keyring debian-archive-keyring apt-transport-https ufw rsync >/dev/null

say "Node.js 22"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
node -v

say "Caddy (HTTPS и прокси)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi

say "Код приложения"
id jolda >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin jolda
if [ -d "$APP/.git" ]; then git -C "$APP" fetch -q origin main && git -C "$APP" reset -q --hard origin/main
else git clone -q --depth 1 "$REPO" "$APP"; fi
cd "$APP"
npm ci --no-audit --no-fund --loglevel=error
npm run build >/dev/null
mkdir -p "$DATA" && chown -R jolda:jolda "$DATA"
# Перед перезапуском на новую версию — копия текущей базы: если обновление что-то испортит, будет к чему вернуться.
# База до перезапуска службы не меняется, поэтому копию делает уже новый скрипт. Такие копии хранятся отдельно от ночных
# (последние 5): серия обновлений ночные копии не вытесняет.
if [ -f "$DATA/jolda.db" ]; then
  DATA_DIR="$DATA" node "$APP/scripts/backup.mjs" /var/backups/jolda --update || echo "Копия перед обновлением не удалась"
fi

say "Служба jolda"
INSECURE=0; [ -z "$DOMAIN" ] && INSECURE=1
# Push в мобильное приложение (Firebase): положите файл сервисного аккаунта Firebase в /var/lib/jolda/fcm.json
# (владелец jolda, права 600: chown jolda:jolda /var/lib/jolda/fcm.json && chmod 600 /var/lib/jolda/fcm.json)
# и перезапустите службу (systemctl restart jolda). Без файла push в приложение выключен, остальное работает.
[ -f "$DATA/fcm.json" ] && chown jolda:jolda "$DATA/fcm.json" && chmod 600 "$DATA/fcm.json"
cat > /etc/systemd/system/jolda.service <<EOF
[Unit]
Description=Jolda freight exchange
After=network.target

[Service]
User=jolda
WorkingDirectory=$APP
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=DATA_DIR=$DATA
Environment=TRUST_PROXY=1
Environment=INSECURE_COOKIES=$INSECURE
Environment=DEMO_MODE=$DEMO
# демо на сервере в интернете запускается только с этим подтверждением — его ставит установщик при DEMO=1
Environment=DEMO_CONFIRM=$DEMO
# ключ Firebase для push в мобильное приложение (файл необязателен)
Environment=FCM_SERVICE_ACCOUNT=$DATA/fcm.json
EnvironmentFile=-/etc/jolda.env
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
# свои настройки (SMS_WEBHOOK_URL, TELEGRAM_BOT_TOKEN, ADMIN_PHONE, SUPPORT_PHONE, TILE_URL…) — в /etc/jolda.env
[ -f /etc/jolda.env ] || printf '# Настройки Jolda, по одной в строке: ИМЯ=значение\n' > /etc/jolda.env
systemctl daemon-reload
systemctl enable -q jolda
systemctl restart jolda

say "Резервные копии и сторож"
# Каждую ночь — копия базы и новых загруженных файлов в /var/backups/jolda (последние 14 ночных копий).
# BACKUP_REMOTE в /etc/jolda.env (адрес для rsync) — отправлять ночную копию ещё и на другой сервер.
cat > /etc/systemd/system/jolda-backup.service <<EOF
[Unit]
Description=Jolda nightly backup

[Service]
Type=oneshot
Environment=DATA_DIR=$DATA
EnvironmentFile=-/etc/jolda.env
ExecStart=/usr/bin/node $APP/scripts/backup.mjs /var/backups/jolda
EOF
cat > /etc/systemd/system/jolda-backup.timer <<'EOF'
[Unit]
Description=Jolda nightly backup

[Timer]
OnCalendar=*-*-* 03:30
Persistent=true

[Install]
WantedBy=timers.target
EOF
# Сторож: раз в минуту спрашивает сайт; если тот трижды подряд не ответил — перезапускает службу.
cat > /usr/local/bin/jolda-watchdog <<'EOF'
#!/usr/bin/env bash
F=/run/jolda-watchdog.fails
if curl -fs -m 10 localhost:3000/api/meta >/dev/null; then echo 0 > "$F"; exit 0; fi
n=$(( $(cat "$F" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$F"
if [ "$n" -ge 3 ]; then logger -t jolda-watchdog "сайт не отвечает 3 минуты — перезапуск"; systemctl restart jolda; echo 0 > "$F"; fi
EOF
chmod +x /usr/local/bin/jolda-watchdog
cat > /etc/systemd/system/jolda-watchdog.service <<'EOF'
[Unit]
Description=Jolda watchdog

[Service]
Type=oneshot
ExecStart=/usr/local/bin/jolda-watchdog
EOF
cat > /etc/systemd/system/jolda-watchdog.timer <<'EOF'
[Unit]
Description=Jolda watchdog

[Timer]
OnBootSec=2min
OnUnitActiveSec=1min

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable -q --now jolda-backup.timer jolda-watchdog.timer
# первая копия — сразу после установки; дальше ночные идут по расписанию, а перед обновлением копия уже сделана выше
[ -f "$DATA/backup-status.json" ] || systemctl start jolda-backup.service || echo "Не удалось сделать копию — проверьте: journalctl -u jolda-backup"

say "Веб-сервер"
SITE="${DOMAIN:-:80}"
cat > /etc/caddy/Caddyfile <<EOF
$SITE {
	encode gzip
	reverse_proxy 127.0.0.1:3000 {
		# события в реальном времени (чат, GPS) идут без буферизации
		flush_interval -1
	}
}
EOF
systemctl reload caddy 2>/dev/null || systemctl restart caddy

say "Брандмауэр"
ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

say "Проверка"
for i in $(seq 1 20); do curl -fs localhost:3000/api/meta >/dev/null && break; sleep 1; done
if curl -fs localhost:3000/api/meta >/dev/null; then
  echo "Jolda работает."
  if [ -n "$DOMAIN" ]; then echo "Откройте https://$DOMAIN (сертификат выпускается в первую минуту)"
  else echo "Откройте http://$(curl -fs https://api.ipify.org || hostname -I | cut -d' ' -f1)"; fi
  if [ "$DEMO" = 1 ]; then
    printf '\n\033[1;31m%s\033[0m\n' "ВНИМАНИЕ: включён демо-режим. Любой посетитель входит под любым номером и как администратор."
    echo "Это стенд для показа, настоящих пользователей на него пускать нельзя."
    echo "Боевой запуск: подключите SMS (SMS_WEBHOOK_URL) или бота Telegram (TELEGRAM_BOT_TOKEN) в /etc/jolda.env и запустите установщик с DEMO=0."
  elif ! grep -qsE '^(SMS_WEBHOOK_URL|TELEGRAM_BOT_TOKEN)=.' /etc/jolda.env; then
    echo "Демо-режим выключен, а коды входа отправлять нечем — войти пока никто не сможет."
    echo "Укажите SMS_WEBHOOK_URL или TELEGRAM_BOT_TOKEN в /etc/jolda.env и выполните: systemctl restart jolda"
    echo "Нужен стенд для показа без SMS — запустите установщик с DEMO=1."
  fi
  if ! grep -qs '^BACKUP_REMOTE=.' /etc/jolda.env; then
    echo "Резервные копии хранятся только на этом сервере (/var/backups/jolda): при поломке сервера пропадут и они."
    echo "Чтобы каждую ночь отправлять копию на другой сервер, укажите BACKUP_REMOTE=пользователь@сервер:/папка в /etc/jolda.env."
  fi
else
  echo "Сервис не ответил. Журнал: journalctl -u jolda -n 50"; exit 1
fi
