# Etapa de compilación: interfaz (Vite) y servidor (esbuild).
FROM node:22-alpine AS build
LABEL app=audios-pro
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# Imagen final: solo dependencias de producción y lo compilado.
FROM node:22-alpine
LABEL app=audios-pro
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
COPY package.json package-lock.json ./
# ffmpeg monta el video final (Ken Burns, fundidos y concatenación).
RUN apk add --no-cache ffmpeg
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:3000/api/health | grep -q '"status":"ok"' || exit 1
CMD ["node", "dist-server/index.cjs"]
