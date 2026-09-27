#!/usr/bin/env bash
# Instala o actualiza la app en el servidor como contenedor Docker. Lo ejecuta el workflow de despliegue
# por SSH (como root) después de copiar a /tmp el código (audios-pro-release.tgz) y, opcionalmente,
# las variables (audios-pro.env). No toca Node.js del sistema ni los demás contenedores.
set -euo pipefail

APP_DIR=/opt/audios-pro
ENV_FILE="$APP_DIR/.env"
RELEASE=/tmp/audios-pro-release.tgz
NEW_ENV=/tmp/audios-pro.env
IMAGE=audios-pro
CONTAINER=audios-pro

log() { echo "==> $*"; }
fail() { echo "ERROR: $*" >&2; exit 1; }

command -v docker >/dev/null || fail "Docker no está instalado en el servidor."
if docker compose version >/dev/null 2>&1; then COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null; then COMPOSE=(docker-compose)
else fail "No se encontró 'docker compose' ni 'docker-compose'."
fi

mkdir -p "$APP_DIR/data"
# El contenedor corre con el usuario "node" (uid 1000).
chown -R 1000:1000 "$APP_DIR/data"

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
chmod 600 "$ENV_FILE"
port=$(grep '^APP_PORT=' "$ENV_FILE" | tail -1 | cut -d= -f2 || true)
port=${port:-3000}

# Antes de la primera instalación, se comprueba que ningún otro servicio use el puerto.
if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null || docker ps --format '{{.Ports}}' | grep -qE "[:.]$port->"; then
    fail "El puerto $port ya lo usa otro servicio. Define el secret APP_PORT con un puerto libre (p. ej. 3010)."
  fi
fi

log "Construyendo la imagen"
rm -rf "$APP_DIR/src.new"
mkdir -p "$APP_DIR/src.new"
tar -xzf "$RELEASE" -C "$APP_DIR/src.new"
rm -f "$RELEASE"
docker build -t "$IMAGE:candidate" "$APP_DIR/src.new"
cp "$APP_DIR/src.new/docker-compose.yml" "$APP_DIR/docker-compose.yml"
rm -rf "$APP_DIR/src"
mv "$APP_DIR/src.new" "$APP_DIR/src"

had_previous=false
if docker image inspect "$IMAGE:current" >/dev/null 2>&1; then
  docker tag "$IMAGE:current" "$IMAGE:previous"
  had_previous=true
fi
docker tag "$IMAGE:candidate" "$IMAGE:current"

log "Iniciando el contenedor en el puerto $port"
cd "$APP_DIR"
started=true
"${COMPOSE[@]}" up -d --force-recreate || started=false

for _ in $(seq 1 30); do
  $started || break
  if curl -fsS "http://127.0.0.1:$port/api/health" 2>/dev/null | grep -q '"status":"ok"'; then
    docker image rm "$IMAGE:candidate" >/dev/null 2>&1 || true
    # Solo se limpian imágenes huérfanas de esta app, nunca las de otros servicios.
    docker image prune -f --filter "label=app=audios-pro" >/dev/null 2>&1 || true
    log "Listo: la app está en marcha en el puerto $port"
    exit 0
  fi
  sleep 2
done

echo "La app no respondió. Últimas líneas del registro:" >&2
docker logs --tail 40 "$CONTAINER" >&2 || true
if $had_previous; then
  echo "Restaurando la versión anterior." >&2
  docker tag "$IMAGE:previous" "$IMAGE:current"
  "${COMPOSE[@]}" up -d --force-recreate
else
  "${COMPOSE[@]}" down >/dev/null 2>&1 || true
fi
exit 1
