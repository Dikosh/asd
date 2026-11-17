#!/usr/bin/env bash
# Установка или обновление Jolda на чистом сервере Ubuntu 22.04/24.04.
# Запуск под root:
#   curl -fsSL https://raw.githubusercontent.com/Dikosh/asd/main/scripts/install-server.sh | bash -s -- moindomen.kz
# Домен необязателен. С доменом сайт будет на https:// с бесплатным сертификатом
# (A-запись домена должна указывать на этот сервер). Без домена — http://IP-адрес.
# Повторный запуск обновляет код до последней версии; данные остаются в /var/lib/jolda.
set -euo pipefail

DOMAIN="${1:-}"
REPO="${REPO:-https://github.com/Dikosh/asd.git}"
APP=/opt/jolda
DATA=/var/lib/jolda
# Пока не подключён SMS-провайдер, войти можно только в демо-режиме. Для боевого запуска: DEMO=0
DEMO="${DEMO:-1}"

say() { printf '\n\033[1;34m== %s\033[0m\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "Запустите под root"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

say "Системные пакеты"
apt-get update -qq
apt-get install -y -qq ca-certificates curl git gnupg debian-keyring debian-archive-keyring apt-transport-https ufw >/dev/null

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

say "Служба jolda"
INSECURE=0; [ -z "$DOMAIN" ] && INSECURE=1
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
EnvironmentFile=-/etc/jolda.env
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
# свои настройки (SMS_WEBHOOK_URL, ADMIN_PHONE, SUPPORT_PHONE, TILE_URL…) — в /etc/jolda.env
[ -f /etc/jolda.env ] || printf '# Настройки Jolda, по одной в строке: ИМЯ=значение\n' > /etc/jolda.env
systemctl daemon-reload
systemctl enable -q jolda
systemctl restart jolda

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
  [ "$DEMO" = 1 ] && echo "Включён демо-режим: вход одним нажатием и коды на экране. Для боевого запуска подключите SMS и запустите с DEMO=0."
else
  echo "Сервис не ответил. Журнал: journalctl -u jolda -n 50"; exit 1
fi
