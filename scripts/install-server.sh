#!/usr/bin/env bash
# Установка или обновление Ovi на чистом сервере Ubuntu 22.04/24.04.
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
PREV=""; OLD=""
DOMAIN_RE='^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$'
if [ -f /etc/caddy/Caddyfile ]; then
  PREV="$(awk '$2 == "{" && $1 ~ /\./ && $1 !~ /^www\./ { print $1; exit }' /etc/caddy/Caddyfile)"
  printf '%s' "$PREV" | grep -Eq "$DOMAIN_RE" || PREV=""
  OLD="$(awk '/^# old-domain/ { getline; print $1 }' /etc/caddy/Caddyfile | grep -E "$DOMAIN_RE" || true)"
  if [ -z "$DOMAIN" ] && [ -n "$PREV" ]; then
    DOMAIN="$PREV"
    echo "Домен из прошлой установки: $DOMAIN"
  fi
fi
[ "$DOMAIN" = none ] && DOMAIN=""
# Смена домена: прежние адреса остаются и ведут на новый (старые ссылки не ломаются). Пока новый домен не виден
# в интернете, сертификат для него не выпустить и сайт стал бы недоступен — тогда ничего не меняем.
if [ -n "$DOMAIN" ] && [ -n "$PREV" ] && [ "$DOMAIN" != "$PREV" ]; then
  getent ahostsv4 "$DOMAIN" >/dev/null || { echo "Домен $DOMAIN ещё не виден в интернете — сайт остаётся на $PREV. Повторите позже."; exit 1; }
  OLD="$OLD $PREV"
fi
REPO="${REPO:-https://github.com/Dikosh/asd.git}"
APP=/opt/jolda
DATA=/var/lib/jolda
# Демо-режим выключен, пока его не включили явно (DEMO=1). При обновлении сохраняется прежний выбор:
# демо-стенд остаётся демо-стендом, боевой сервер — боевым. Выключить демо: DEMO=0.
DEMO="${DEMO:-}"
WAS_DEMO=0; grep -qs '^Environment=DEMO_MODE=1$' /etc/systemd/system/jolda.service && WAS_DEMO=1
[ -z "$DEMO" ] && DEMO=$WAS_DEMO
[ "$DEMO" = 1 ] || DEMO=0

say() { printf '\n\033[1;34m== %s\033[0m\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "Запустите под root"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

say "Системные пакеты"
apt-get update -qq
apt-get install -y -qq ca-certificates curl git gnupg debian-keyring debian-archive-keyring apt-transport-https ufw rsync fail2ban unattended-upgrades >/dev/null

say "Брандмауэр и вход на сервер"
# Брандмауэр включается до установки программы: если установка оборвётся на середине, наружу не останется ничего лишнего.
# Открыты только вход администратора (SSH) и сайт; порт самой программы (3000) снаружи закрыт.
ufw default deny incoming >/dev/null; ufw default allow outgoing >/dev/null
ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
# Вход на сервер — только по ключу. Пароль отключается, только если ключ уже добавлен: иначе на сервер было бы не попасть.
if grep -qsE '^(ssh-|ecdsa-|sk-)' /root/.ssh/authorized_keys; then
  cat > /etc/ssh/sshd_config.d/01-timma.conf <<'EOF'
# Ovi: вход только по ключу (ставит scripts/install-server.sh)
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
MaxAuthTries 3
X11Forwarding no
EOF
  if sshd -t 2>/dev/null; then systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
  else rm -f /etc/ssh/sshd_config.d/01-timma.conf; echo "Настройки входа на сервер не применены: sshd их не принял"; fi
else
  echo "ВНИМАНИЕ: у root нет ключа для входа (/root/.ssh/authorized_keys) — вход по паролю оставлен."
  echo "Добавьте ключ и запустите установщик ещё раз: пароль подбирают круглосуточно."
fi
# Адрес, с которого подбирают пароль или ключ, блокируется на время (fail2ban следит за журналом входов).
systemctl enable -q --now fail2ban 2>/dev/null || echo "fail2ban не запустился — проверьте: systemctl status fail2ban"
# Обновления безопасности ставятся сами; Node.js и веб-сервер Caddy стоят из своих источников — добавляем и их.
cat > /etc/apt/apt.conf.d/52timma <<'EOF'
Unattended-Upgrade::Origins-Pattern {
	"origin=. nodistro";
	"origin=cloudsmith/caddy/stable";
};
EOF
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

say "Node.js 22"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  # источник пакетов с проверкой подписи — без запуска чужого скрипта под root
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/nodesource.gpg
  echo "deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  printf 'Package: nodejs\nPin: origin deb.nodesource.com\nPin-Priority: 600\n' > /etc/apt/preferences.d/nodejs
  apt-get update -qq && apt-get install -y -qq nodejs >/dev/null
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
# Код скачивается и собирается под отдельным пользователем без прав: при сборке работают сотни чужих библиотек, и
# подменённая библиотека не должна получить права администратора. Сама служба (пользователь jolda) код менять не может.
BUILD_HOME=/var/lib/jolda-build
id jolda-build >/dev/null 2>&1 || useradd --system --create-home --home-dir "$BUILD_HOME" --shell /usr/sbin/nologin jolda-build
install -d -m 755 -o jolda-build -g jolda-build "$APP"
chown -R jolda-build:jolda-build "$APP" "$BUILD_HOME"
build() { (cd "$APP" && runuser -u jolda-build -- env HOME="$BUILD_HOME" "$@"); }
if [ -d "$APP/.git" ]; then build git fetch -q origin main && build git reset -q --hard origin/main
else build git clone -q --depth 1 "$REPO" "$APP"; fi
cd "$APP"
# Резервные копии делает администратор сервера (root). Их скрипт берём из только что скачанного кода до сборки и храним
# отдельно: сборка, даже с подменённой библиотекой, не сможет подсунуть администратору свой код.
install -D -m 644 -o root -g root "$APP/scripts/backup.mjs" /usr/local/lib/jolda/backup.mjs
# --ignore-scripts: библиотеки не выполняют свои установочные скрипты
build npm ci --ignore-scripts --no-audit --no-fund --loglevel=error
build npm run build >/dev/null
# Данные (база, документы компаний, ключи) читает только служба: остальным программам на сервере они закрыты.
install -d -m 750 -o jolda -g jolda "$DATA"
chown -R jolda:jolda "$DATA" && chmod -R o-rwx "$DATA"
# Перед перезапуском на новую версию — копия текущей базы: если обновление что-то испортит, будет к чему вернуться.
# База до перезапуска службы не меняется, поэтому копию делает уже новый скрипт. Такие копии хранятся отдельно от ночных
# (последние 5): серия обновлений ночные копии не вытесняет.
if [ -f "$DATA/jolda.db" ]; then
  DATA_DIR="$DATA" node /usr/local/lib/jolda/backup.mjs /var/backups/jolda --update || echo "Копия перед обновлением не удалась"
fi
# Демо-стенд становится боевой площадкой: в демо любой посетитель входил как администратор и мог выдать кому угодно
# «проверено», баланс и тариф. Такая база боевой не становится — она уходит в архив, площадка начинает с чистой.
# Оставить базу осознанно: DEMO_DATA_KEEP=1 в /etc/jolda.env.
if [ "$WAS_DEMO" = 1 ] && [ "$DEMO" = 0 ] && [ -f "$DATA/jolda.db" ] && ! grep -qs '^DEMO_DATA_KEEP=1' /etc/jolda.env; then
  OLD="/var/backups/jolda/demo-stand-$(date +%Y-%m-%d-%H%M)"
  systemctl stop jolda 2>/dev/null || true
  install -d -m 700 "$OLD"
  for f in jolda.db jolda.db-wal jolda.db-shm uploads backup-status.json; do
    [ -e "$DATA/$f" ] && mv "$DATA/$f" "$OLD/"
  done
  DEMO_MOVED="$OLD"
fi

say "Служба jolda"
INSECURE=0; [ -z "$DOMAIN" ] && INSECURE=1
# Push в мобильное приложение (Firebase): положите файл сервисного аккаунта Firebase в /var/lib/jolda/fcm.json
# (владелец jolda, права 600: chown jolda:jolda /var/lib/jolda/fcm.json && chmod 600 /var/lib/jolda/fcm.json)
# и перезапустите службу (systemctl restart jolda). Без файла push в приложение выключен, остальное работает.
# (проверка на ссылку: папку данных пишет сама служба, и подставная ссылка не должна отдать ей чужой файл)
if [ -f "$DATA/fcm.json" ] && [ ! -L "$DATA/fcm.json" ]; then chown -h jolda:jolda "$DATA/fcm.json" && chmod 600 "$DATA/fcm.json"; fi
cat > /etc/systemd/system/jolda.service <<EOF
[Unit]
Description=Ovi freight exchange
After=network.target

[Service]
User=jolda
WorkingDirectory=$APP
Environment=NODE_ENV=production
Environment=PORT=3000
# программа слушает только сам сервер: снаружи к ней можно попасть лишь через веб-сервер Caddy
Environment=HOST=127.0.0.1
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
# Ограничения на случай взлома программы: она видит систему только на чтение, пишет только в свою папку данных,
# не получает прав администратора и не может занять всю память сервера.
UMask=0077
NoNewPrivileges=yes
ProtectSystem=strict
ReadWritePaths=$DATA
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes
ProtectProc=invisible
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK
RestrictNamespaces=yes
RestrictRealtime=yes
RestrictSUIDSGID=yes
LockPersonality=yes
CapabilityBoundingSet=
AmbientCapabilities=
SystemCallArchitectures=native
SystemCallFilter=@system-service
MemoryHigh=60%
MemoryMax=75%
TasksMax=512
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF
# свои настройки (SMS_WEBHOOK_URL, TELEGRAM_BOT_TOKEN, ADMIN_PHONE, SUPPORT_PHONE, TILE_URL…) — в /etc/jolda.env
# В файле лежат ключи (бот Telegram, SMS) — читать его может только администратор сервера.
[ -f /etc/jolda.env ] || { install -m 600 -o root -g root /dev/null /etc/jolda.env; printf '# Настройки Ovi, по одной в строке: ИМЯ=значение\n' > /etc/jolda.env; }
chown root:root /etc/jolda.env && chmod 600 /etc/jolda.env
systemctl daemon-reload
systemctl enable -q jolda
systemctl restart jolda

say "Резервные копии и сторож"
# Каждую ночь — копия базы и новых загруженных файлов в /var/backups/jolda (последние 14 ночных копий).
# BACKUP_REMOTE в /etc/jolda.env (адрес для rsync) — отправлять ночную копию ещё и на другой сервер.
cat > /etc/systemd/system/jolda-backup.service <<EOF
[Unit]
Description=Ovi nightly backup

[Service]
Type=oneshot
Environment=DATA_DIR=$DATA
EnvironmentFile=-/etc/jolda.env
ExecStart=/usr/bin/node /usr/local/lib/jolda/backup.mjs /var/backups/jolda
NoNewPrivileges=yes
ProtectSystem=strict
ReadWritePaths=$DATA /var/backups/jolda -/root/.ssh
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
EOF
install -d -m 700 /var/backups/jolda
cat > /etc/systemd/system/jolda-backup.timer <<'EOF'
[Unit]
Description=Ovi nightly backup

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
# Node.js обновился (обновления безопасности ставятся сами) — служба ещё работает на старой версии: перезапускаем.
PID=$(systemctl show -p MainPID --value jolda)
if [ "${PID:-0}" != 0 ] && readlink "/proc/$PID/exe" 2>/dev/null | grep -q ' (deleted)$'; then
  logger -t jolda-watchdog "Node.js обновлён — перезапуск службы"; systemctl restart jolda; exit 0
fi
if curl -fs -m 10 localhost:3000/api/meta >/dev/null; then echo 0 > "$F"; exit 0; fi
n=$(( $(cat "$F" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$F"
if [ "$n" -ge 3 ]; then logger -t jolda-watchdog "сайт не отвечает 3 минуты — перезапуск"; systemctl restart jolda; echo 0 > "$F"; fi
EOF
chmod +x /usr/local/bin/jolda-watchdog
cat > /etc/systemd/system/jolda-watchdog.service <<'EOF'
[Unit]
Description=Ovi watchdog

[Service]
Type=oneshot
ExecStart=/usr/local/bin/jolda-watchdog
EOF
cat > /etc/systemd/system/jolda-watchdog.timer <<'EOF'
[Unit]
Description=Ovi watchdog

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
# Журнал запросов — чтобы после атаки или массового сбора данных было видно, кто и что запрашивал (хранится 10 файлов
# по 20 МБ). Пределы: запрос не больше 10 МБ, а «медленные» соединения, которыми занимают сервер, обрываются.
# Строка «адрес {» с доменом сайта должна оставаться в таком виде: по ней установщик узнаёт домен при обновлении.
cp -f /etc/caddy/Caddyfile /etc/caddy/Caddyfile.prev 2>/dev/null || true
cat > /etc/caddy/Caddyfile <<EOF
{
	servers {
		timeouts {
			read_header 15s
			read_body 2m
			idle 3m
		}
	}
}

$SITE {
	encode gzip
	request_body {
		max_size 10MB
	}
	log {
		output file /var/log/caddy/timma.log {
			roll_size 20MiB
			roll_keep 10
		}
	}
	reverse_proxy 127.0.0.1:3000 {
		# события в реальном времени (чат, GPS) идут без буферизации
		flush_interval -1
	}
}
EOF
# адрес с www ведёт на основной — если он тоже указывает на этот сервер (иначе сертификат для него не выпустить)
if [ -n "$DOMAIN" ] && [ -n "$(getent hosts "www.$DOMAIN" | cut -d' ' -f1)" ] && [ "$(getent hosts "www.$DOMAIN" | cut -d' ' -f1)" = "$(getent hosts "$DOMAIN" | cut -d' ' -f1)" ]; then
  cat >> /etc/caddy/Caddyfile <<EOF

www.$DOMAIN {
	redir https://$DOMAIN{uri} permanent
}
EOF
fi
if [ -n "$DOMAIN" ]; then
  for d in $(printf '%s\n' $OLD | sort -u); do
    if [ "$d" = "$DOMAIN" ] || [ "$d" = "www.$DOMAIN" ]; then continue; fi
    cat >> /etc/caddy/Caddyfile <<EOF

# old-domain
$d {
	redir https://$DOMAIN{uri} 308
}
EOF
    if getent ahostsv4 "www.$d" >/dev/null; then
      cat >> /etc/caddy/Caddyfile <<EOF

www.$d {
	redir https://$DOMAIN{uri} 308
}
EOF
    fi
  done
fi
# Журнал пишет сам веб-сервер (пользователь caddy). Проверка настроек тоже идёт от его имени: запущенная под
# администратором, она создала бы файл журнала с правами администратора, и веб-сервер не смог бы стартовать.
install -d -m 755 -o caddy -g caddy /var/log/caddy
touch /var/log/caddy/timma.log && chown caddy:caddy /var/log/caddy/timma.log && chmod 640 /var/log/caddy/timma.log
caddy_prev() {
  if [ -f /etc/caddy/Caddyfile.prev ]; then cp -f /etc/caddy/Caddyfile.prev /etc/caddy/Caddyfile; fi
}
if ! runuser -u caddy -- caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
  echo "Новые настройки веб-сервера не прошли проверку — оставлены прежние."
  caddy_prev
fi
systemctl reload caddy 2>/dev/null || systemctl restart caddy || true
sleep 2
# веб-сервер не поднялся на новых настройках — возвращаем прежние: сайт важнее новых пределов
if ! systemctl is-active --quiet caddy; then
  echo "Веб-сервер не запустился на новых настройках — возвращены прежние. Журнал: journalctl -u caddy -n 30"
  caddy_prev
  systemctl restart caddy || true
fi

say "Проверка"
for i in $(seq 1 20); do curl -fs localhost:3000/api/meta >/dev/null && break; sleep 1; done
# сайт должен отвечать и через веб-сервер, а не только сама программа: посетители приходят через него
WEB_OK=0
for i in $(seq 1 10); do
  if curl -s -o /dev/null -m 5 -H "Host: ${DOMAIN:-localhost}" http://127.0.0.1/; then WEB_OK=1; break; fi
  sleep 1
done
if [ "$WEB_OK" = 0 ]; then
  echo "Программа работает, но веб-сервер не отвечает — сайт снаружи недоступен. Журнал: journalctl -u caddy -n 30"; exit 1
fi
if curl -fs localhost:3000/api/meta >/dev/null; then
  echo "Ovi работает."
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
  if [ -n "${DEMO_MOVED:-}" ]; then
    echo "База демо-стенда убрана в $DEMO_MOVED — площадка начала с чистой базы."
  fi
  if ! grep -qs '^BACKUP_REMOTE=.' /etc/jolda.env; then
    echo "Резервные копии хранятся только на этом сервере (/var/backups/jolda): при поломке сервера пропадут и они."
    echo "Чтобы каждую ночь отправлять копию на другой сервер, укажите BACKUP_REMOTE=пользователь@сервер:/папка в /etc/jolda.env."
  fi
else
  echo "Сервис не ответил. Журнал: journalctl -u jolda -n 50"; exit 1
fi
