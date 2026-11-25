#!/usr/bin/env bash
# Второй сервер Ovi: хранит копии и следит за сайтом снаружи. Запускать под root на ЧИСТОЙ Ubuntu 24.04+ (не на сервере сайта!):
#   ssh root@ВТОРОЙ 'bash -s' -- 'ssh-ed25519 AAAA… ключ сервера сайта' https://ovi.kz < scripts/backup-server.sh
# Повторный запуск безопасен: обновляет скрипты и настройки, копии не трогает.
#
# Что делает:
#  - пользователь ovibackup принимает ночные копии по ключу сервера сайта: только запись в свою папку, без командной строки;
#  - каждую ночь принятое перекладывается в /srv/ovi-snapshots (владелец root): тот, кто взломал сервер сайта, прошлые
#    копии не удалит и не испортит. Хранится 30 дней;
#  - последняя копия проверяется: архив открывается, база внутри целая, копия не старше полутора суток;
#  - раз в минуту проверяется сайт. Три неудачи подряд или плохая копия — сообщение в Telegram (если задан /etc/ovi-monitor.env).
#
# /etc/ovi-monitor.env (права 600, заполняет владелец сервера): TG_TOKEN=…  TG_CHAT=…  — лучше отдельный бот, не тот, что шлёт коды входа.
# Проверить: systemctl start ovi-snapshot ovi-watch; journalctl -u ovi-snapshot -u ovi-watch -n 20
# На сервере сайта после этого: BACKUP_REMOTE=ovibackup@ВТОРОЙ:. и BACKUP_REMOTE_MIRROR=1 в /etc/jolda.env, ключ root и один раз ssh-keyscan ВТОРОЙ >> /root/.ssh/known_hosts
set -euo pipefail
KEY="${1:-}"; SITE="${2:-https://ovi.kz}"
[ "$(id -u)" = 0 ] || { echo "Запускайте под root"; exit 1; }
[ ! -d /opt/jolda ] || { echo "Это сервер сайта. Второй сервер должен быть отдельным"; exit 1; }
[[ "$KEY" =~ ^(ssh-ed25519|ssh-rsa|ecdsa-sha2-[a-z0-9-]+)\ [A-Za-z0-9+/=]+(\ [A-Za-z0-9@._-]+)?$ ]] || { echo "Первым аргументом передайте открытый ключ сервера сайта (файл .pub)"; exit 1; }
[[ "$SITE" =~ ^https?://[A-Za-z0-9.:-]+$ ]] || { echo "Вторым аргументом — адрес сайта, например https://ovi.kz"; exit 1; }
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq rsync sqlite3 curl ufw fail2ban unattended-upgrades >/dev/null
RRSYNC=$(command -v rrsync || echo /usr/share/doc/rsync/scripts/rrsync)
[ -x "$RRSYNC" ] || { echo "Не найден rrsync"; exit 1; }

ufw default deny incoming >/dev/null; ufw default allow outgoing >/dev/null; ufw allow OpenSSH >/dev/null
mkdir -p /run/sshd # при запуске по сокету папки ещё может не быть, а sshd без неё не отвечает
# вход по SSH бывает не на 22-м порту: не закрыть его самому себе
sshd -T | awk '$1 == "port" { print $2 }' | while read -r P; do ufw allow "$P/tcp" >/dev/null; done
ufw --force enable >/dev/null
systemctl enable -q --now fail2ban || true
printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' > /etc/apt/apt.conf.d/20auto-upgrades

id ovibackup >/dev/null 2>&1 || useradd --system --create-home --home-dir /srv/ovi-incoming --shell /bin/sh ovibackup
install -d -m 700 -o ovibackup -g ovibackup /srv/ovi-incoming /srv/ovi-incoming/data
# ключи — вне домашней папки: принимающий пользователь не может их поменять
install -d -m 755 /etc/ssh/ovi-keys
printf 'restrict,command="%s -wo /srv/ovi-incoming/data" %s\n' "$RRSYNC" "$KEY" > /etc/ssh/ovi-keys/ovibackup
chmod 644 /etc/ssh/ovi-keys/ovibackup
cat > /etc/ssh/sshd_config.d/10-ovi-backup.conf <<'E'
Match User ovibackup
	AuthorizedKeysFile /etc/ssh/ovi-keys/ovibackup
	PasswordAuthentication no
	KbdInteractiveAuthentication no
E
sshd -t
systemctl reload ssh 2>/dev/null || true # не запущена (вход по сокету) — новые настройки возьмёт при первом входе

install -d -m 700 /srv/ovi-snapshots /var/lib/ovi-monitor
[ -f /etc/ovi-monitor.env ] || { install -m 600 /dev/null /etc/ovi-monitor.env; printf '# TG_TOKEN=\n# TG_CHAT=\n' > /etc/ovi-monitor.env; }
printf 'SITE=%s\n' "$SITE" > /etc/ovi-site.env

cat > /usr/local/bin/ovi-alert <<'E'
#!/usr/bin/env bash
# ovi-alert КЛЮЧ ПЕРИОД_СЕК ТЕКСТ — сообщить в Telegram, об одном и том же не чаще раза в ПЕРИОД
set -u
F="/var/lib/ovi-monitor/alert-$1"; NOW=$(date +%s); LAST=$(cat "$F" 2>/dev/null || echo 0)
logger -t ovi-monitor "$3"; echo "$3"
[ $((NOW - LAST)) -ge "$2" ] || exit 0
[ -n "${TG_TOKEN:-}" ] && [ -n "${TG_CHAT:-}" ] || { echo "Telegram не настроен: /etc/ovi-monitor.env"; exit 0; }
# токен не попадает в список процессов: адрес читается из потока
printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$TG_TOKEN" |
  curl -fsS -m 20 -o /dev/null -K - --data-urlencode "chat_id=$TG_CHAT" --data-urlencode "text=$3" && echo "$NOW" > "$F"
exit 0
E
cat > /usr/local/bin/ovi-watch <<'E'
#!/usr/bin/env bash
F=/var/lib/ovi-monitor/fails; N=$(cat "$F" 2>/dev/null || echo 0)
if curl -fsS -m 15 -o /dev/null "$SITE/api/meta"; then
  [ "$N" -lt 3 ] || ovi-alert "up-$(date +%s)" 0 "Ovi снова работает: $SITE"
  rm -f /var/lib/ovi-monitor/alert-up-*
  [ "$N" -lt 3 ] || rm -f /var/lib/ovi-monitor/alert-down
  echo 0 > "$F"
else
  N=$((N + 1)); echo "$N" > "$F"
  [ "$N" -lt 3 ] || ovi-alert down 3600 "Ovi не отвечает: $SITE, минут подряд: $N"
fi
E
cat > /usr/local/bin/ovi-snapshot <<'E'
#!/usr/bin/env bash
# Принятое → снимок дня (владелец root) → проверка → удаление старого
set -euo pipefail
IN=/srv/ovi-incoming/data; OUT=/srv/ovi-snapshots
fail() { ovi-alert "backup" 72000 "Ovi, копии: $1"; exit 1; }
# прошлый снимок — не сегодняшний: одинаковые файлы второй раз места не занимают
PREV=$(find "$OUT" -mindepth 1 -maxdepth 1 -type d -name '20*' ! -name "$(date +%F)" | sort | tail -1)
rm -rf "$OUT"/.new; mkdir -m 700 "$OUT/.new"
# ссылки и чужие владельцы не переносятся; --checksum: файл, подменённый без смены размера и даты, с прошлым снимком не совпадёт
rsync -rt --no-links --chmod=D700,F600 --checksum ${PREV:+--link-dest="$PREV"} "$IN/" "$OUT/.new/"
LAST=$(find "$OUT/.new" -maxdepth 1 -type f -regextype posix-extended -regex '.*/jolda-[0-9]{4}(-[0-9]{2}){4}\.tar\.gz' | sort | tail -1)
[ -n "$LAST" ] || { rm -rf "$OUT/.new"; fail "ещё ни одной копии не пришло"; }
rm -rf "$OUT/$(date +%F)"; mv "$OUT/.new" "$OUT/$(date +%F)"; LAST="$OUT/$(date +%F)/$(basename "$LAST")"
S=$(basename "$LAST" .tar.gz); S=${S#jolda-}
AT=$(date -u -d "${S:0:10} ${S:11:2}:${S:14:2}" +%s 2>/dev/null) || fail "непонятное имя копии $(basename "$LAST")"
[ $(( $(date +%s) - AT )) -lt 129600 ] || fail "последняя копия старше полутора суток: $(basename "$LAST")"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
tar -xzf "$LAST" -C "$T" --no-same-owner jolda.db || fail "архив не открывается: $(basename "$LAST")"
[ "$(sqlite3 "$T/jolda.db" 'PRAGMA quick_check' 2>&1)" = ok ] || fail "база в копии повреждена: $(basename "$LAST")"
[ "$(sqlite3 "$T/jolda.db" 'SELECT COUNT(*) FROM users')" -ge 1 ] || fail "в копии нет пользователей: $(basename "$LAST")"
# старше 30 дней — удаляем, но последние 7 снимков остаются всегда
find "$OUT" -mindepth 1 -maxdepth 1 -type d -name '20*' | sort | head -n -7 | while read -r D; do
  [ "$(basename "$D")" \< "$(date -d '30 days ago' +%F)" ] && rm -rf "$D" || true
done
find "$IN" -maxdepth 1 -type f -name 'jolda-*.tar.gz' -mtime +30 -delete
FREE=$(df --output=pcent /srv | tail -1 | tr -dc 0-9)
[ "$FREE" -lt 90 ] || fail "на втором сервере занято ${FREE}% диска"
rm -f /var/lib/ovi-monitor/alert-backup
echo "Копия в порядке: $(basename "$LAST"), снимков: $(find "$OUT" -mindepth 1 -maxdepth 1 -type d -name '20*' | wc -l)"
E
chmod 755 /usr/local/bin/ovi-alert /usr/local/bin/ovi-watch /usr/local/bin/ovi-snapshot
unit() { printf '[Unit]\nDescription=%s\n[Service]\nType=oneshot\nEnvironmentFile=/etc/ovi-site.env\nEnvironmentFile=-/etc/ovi-monitor.env\nExecStart=%s\nNoNewPrivileges=yes\nProtectSystem=strict\nProtectHome=yes\nPrivateTmp=yes\nReadWritePaths=/srv /var/lib/ovi-monitor\n' "$1" "$2" > "/etc/systemd/system/$3.service"; }
unit "Ovi site watch" /usr/local/bin/ovi-watch ovi-watch
unit "Ovi backup snapshot" /usr/local/bin/ovi-snapshot ovi-snapshot
printf '[Timer]\nOnBootSec=2min\nOnUnitActiveSec=1min\nAccuracySec=5s\n[Install]\nWantedBy=timers.target\n' > /etc/systemd/system/ovi-watch.timer
printf '[Timer]\nOnCalendar=*-*-* 06:00\nPersistent=true\n[Install]\nWantedBy=timers.target\n' > /etc/systemd/system/ovi-snapshot.timer
systemctl daemon-reload
systemctl enable -q --now ovi-watch.timer ovi-snapshot.timer
echo "Готово. Адрес для BACKUP_REMOTE: ovibackup@$(hostname -I | awk '{print $1}'):."
