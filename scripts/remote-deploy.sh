#!/usr/bin/env bash
# Instala o actualiza la app en el servidor. Lo ejecuta el workflow de despliegue por SSH (como root)
# después de copiar a /tmp el paquete compilado (audios-pro-release.tgz) y, opcionalmente, audios-pro.env.
# Es idempotente: la primera vez prepara el servidor; las siguientes solo reemplaza la versión.
set -euo pipefail

APP_USER=audios
APP_DIR=/opt/audios-pro
DATA_DIR=/var/lib/audios-pro/projects
ENV_FILE="$APP_DIR/.env"
RELEASE=/tmp/audios-pro-release.tgz
NEW_ENV=/tmp/audios-pro.env
PORT="${PORT:-3000}"

log() { echo "==> $*"; }

node_major() { command -v node >/dev/null && node -p 'process.versions.node.split(".")[0]' || echo 0; }

if [ "$(node_major)" -lt 22 ]; then
  log "Instalando Node.js 22"
  if command -v apt-get >/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  elif command -v dnf >/dev/null || command -v yum >/dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
    (command -v dnf >/dev/null && dnf install -y nodejs) || yum install -y nodejs
  else
    echo "No se pudo instalar Node.js automáticamente: instala Node.js 22 y vuelve a ejecutar." >&2
    exit 1
  fi
fi

if ! id "$APP_USER" >/dev/null 2>&1; then
  log "Creando usuario $APP_USER"
  useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
fi

mkdir -p "$APP_DIR" "$DATA_DIR"
chown -R "$APP_USER:$APP_USER" "$(dirname "$DATA_DIR")"

# Variables de entorno: se conservan las existentes y se actualizan las que llegan del workflow.
touch "$ENV_FILE"
if [ -s "$NEW_ENV" ]; then
  while IFS='=' read -r key value; do
    [ -z "$key" ] && continue
    grep -v "^${key}=" "$ENV_FILE" > "$ENV_FILE.tmp" || true
    echo "${key}=${value}" >> "$ENV_FILE.tmp"
    mv "$ENV_FILE.tmp" "$ENV_FILE"
  done < "$NEW_ENV"
fi
rm -f "$NEW_ENV"
grep -q '^DATA_DIR=' "$ENV_FILE" || echo "DATA_DIR=$DATA_DIR" >> "$ENV_FILE"
grep -q '^PORT=' "$ENV_FILE" || echo "PORT=$PORT" >> "$ENV_FILE"
chown root:"$APP_USER" "$ENV_FILE"
chmod 640 "$ENV_FILE"

log "Instalando la nueva versión"
rm -rf "$APP_DIR/app.new"
mkdir -p "$APP_DIR/app.new"
tar -xzf "$RELEASE" -C "$APP_DIR/app.new"
(cd "$APP_DIR/app.new" && npm ci --omit=dev --no-audit --no-fund)
chown -R "$APP_USER:$APP_USER" "$APP_DIR/app.new"
rm -rf "$APP_DIR/app.old"
[ -d "$APP_DIR/app" ] && mv "$APP_DIR/app" "$APP_DIR/app.old"
mv "$APP_DIR/app.new" "$APP_DIR/app"
rm -f "$RELEASE"

cat > /etc/systemd/system/audios-pro.service <<UNIT
[Unit]
Description=Audios Profesionales
After=network.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR/app
EnvironmentFile=$ENV_FILE
Environment=NODE_ENV=production
ExecStart=$(command -v node) dist-server/index.cjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable audios-pro >/dev/null 2>&1
systemctl restart audios-pro

log "Comprobando que la app responde"
port=$(grep '^PORT=' "$ENV_FILE" | tail -1 | cut -d= -f2)
for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${port:-3000}/api/health" >/dev/null; then
    rm -rf "$APP_DIR/app.old"
    log "Listo: la app está en marcha en el puerto ${port:-3000}"
    exit 0
  fi
  sleep 1
done

echo "La app no respondió. Últimas líneas del registro:" >&2
journalctl -u audios-pro -n 40 --no-pager >&2 || true
if [ -d "$APP_DIR/app.old" ]; then
  echo "Restaurando la versión anterior." >&2
  rm -rf "$APP_DIR/app" && mv "$APP_DIR/app.old" "$APP_DIR/app"
  systemctl restart audios-pro
fi
exit 1
