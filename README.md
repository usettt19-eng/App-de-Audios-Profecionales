# App de Audios Profesionales

Convierte guiones profesionales en locuciones con una voz distinta por personaje. Usa los modelos de voz de [OpenRouter](https://openrouter.ai) (una sola clave para Gemini TTS, Kokoro, Fish Audio y otros) y, opcionalmente, Gemini directo de Google.

## Inicio rápido

```bash
npm install
cp .env.example .env   # agrega tu OPENROUTER_API_KEY
npm run dev            # http://localhost:3000
```

Producción: `npm run build && npm start`.

## Ideas: de un canal de YouTube a un formato de producción

La pestaña **Ideas** reproduce el primer paso del proceso: analizar un canal que funciona y adaptar su formato a un nicho con hueco.

1. **Analizar:** escribe un canal (`https://www.youtube.com/@canal`, `@canal`, un id `UC…`) o una idea. La app aplica el prompt de análisis (editable): *"Analiza este canal de YouTube y dime cuál es el formato exacto que le está funcionando —no el tema, el patrón repetible: estructura, duración, tipo de gancho. Después dame 3 nichos distintos donde ese mismo formato casi no se esté usando todavía…"*.
   - Con `YOUTUBE_API_KEY`, los datos del canal (videos más vistos y recientes, con título, duración, vistas y fecha) salen de la API de YouTube.
   - Sin ella, el modelo los busca en la web (plugin web de OpenRouter, ~$4 por 1.000 resultados; se piden 8).
2. **Elegir un nicho:** aparecen los 3 nichos con su "por qué tiene hueco", o puedes escribir otro.
3. **Crear el proceso:** la app genera el **formato de producción** del nicho con la misma estructura que `proceso-documental-arquitectura.md` (análisis, prompt del guion, dirección de voz, plantillas de imagen con `{elemento}`, miniatura, título y checklist). Se guarda, se puede editar y descargar como `.md`.
4. **Crear proyecto con este formato:** abre *Nuevo proyecto* con el generador de guiones y la dirección de voz ya configurados.

El proceso "Construcciones Imposibles" viene cargado como primer formato (*Documental construcciones*). Los análisis y formatos se guardan junto a los proyectos (`research/` y `formats/` al lado de `DATA_DIR`).

## Guiones generados con IA

En **Nuevo proyecto → Generar guion con IA** escribes el título del documental (y, si quieres, indicaciones adicionales, duración y número de estructuras) y la app escribe el guion completo con un modelo de texto de OpenRouter, en vivo, usando el prompt del proceso documental:

- El prompt es editable y admite las variables `{titulo}`, `{tema}`, `{duracion}`, `{palabras}` y `{segmentos}`.
- Al final se añaden siempre unas reglas de formato fijas (`src/lib/scriptTemplates.ts`) para que el modelo marque cada bloque como `[BLOQUE N — NOMBRE]` con su música, tono y pausas, y la app pueda dividirlo en audios.
- El modelo se elige de la lista de OpenRouter, con los recomendados primero y el costo aproximado por guion. Por defecto, el primero disponible entre Claude Sonnet/Opus, GPT-5 y Gemini 3 (o `OPENROUTER_TEXT_MODEL`).
- Al generar, el nombre del proyecto sale del título y la dirección de voz se completa con la del proceso documental (voz grave de documental, 90-95 % de velocidad, pausas tras cifras y el prompt de estilo).
- El guion se puede corregir antes de crear el proyecto.
- El prompt, el título, la duración y los segmentos vienen del **formato** elegido (ver Ideas); los cambios en el generador valen solo para esa generación.

## Proyectos: varios audios de un mismo guion

En la pestaña **Proyectos** pega un guion técnico completo (o cárgalo desde un `.md`/`.txt`). Cada `[BLOQUE N — TÍTULO]` se convierte en un audio separado:

```
### **[BLOQUE 1 — GANCHO]**
**(MÚSICA: Inicio cinemático, grave, con ambiente tenso y misterioso.)**
*(Tono: Intrigante, pausado, seguro)*
Hay un edificio en el desierto que no debería sostenerse en pie.
*(Pausa de 1 segundo)*
**(EFECTO DE SONIDO / SFX: Impacto grave)**
*(Tono: Épico, reflexivo)*
Estructuras que fueron declaradas **imposibles** por los mejores ingenieros del mundo.
```

| En el guion | Qué hace la app |
|---|---|
| `[BLOQUE N — TÍTULO]` (también ESCENA, PARTE, SECCIÓN, CAPÍTULO...) | Un audio nuevo, titulado "Título" |
| Texto antes del primer bloque, `---`, títulos `#` | Se ignora |
| `(MÚSICA: …)`, `(SFX: …)`, `(EFECTO DE SONIDO: …)`, `(AMBIENTE: …)` | Indicación de producción: no se locuta, se muestra en el bloque y va a la hoja de producción |
| `(Tono: …)` | Tono de los párrafos siguientes, hasta el próximo tono |
| `(Enfático)`, `(Transición…)` | Indicación solo para el párrafo siguiente |
| `(Pausa de 1 segundo)` / `(Pausa táctica)` | Silencio exacto (1 s / 1,2 s) |
| `**palabra**` | Se pide énfasis en esa palabra |

El proyecto comparte un **prompt de dirección de voz** y un **reparto de voces** para todos los bloques. Cada bloque se puede editar, generar y regenerar por separado; si cambias la dirección o las voces, los audios ya generados se marcan como *desactualizados*. **Generar pendientes** los procesa uno a uno y **Descargar ZIP** entrega:

```
Construcciones imposibles.zip
├── 00 - Hoja de produccion.txt   (orden, duraciones, música y SFX de cada bloque)
├── 01 - Gancho.wav
├── 02 - Estructura 1 El Viaducto de Millau.wav
└── ...
```

Los proyectos se guardan en el servidor, en `DATA_DIR` (por defecto `./data/projects`). En servicios con disco efímero (p. ej. Cloud Run) monta un volumen persistente o descarga el ZIP al terminar.

## Formato del guion (audio rápido)

```
# Comentario o encabezado de escena (no se lee)
LOCUTOR (cálido): Bienvenidos. [PAUSA 1.5s] Hoy empieza todo.
DIRECTORA: Queridas familias, (sonriendo) gracias por venir.
Esta línea sin nombre continúa con la DIRECTORA.
```

| Sintaxis | Efecto |
|---|---|
| `PERSONAJE: texto` | Línea de diálogo |
| `PERSONAJE (tono): texto` | Indicación de interpretación para esa línea |
| `(susurrando)` dentro del texto | Acotación que el modelo interpreta sin leerla |
| `[PAUSA]`, `[PAUSA 2s]`, `[PAUSA 500ms]` | Silencio (0,8 s por defecto, máx. 10 s) |
| `# ...` o `// ...` | Comentario ignorado |

Los nombres de personaje se reconocen si están en MAYÚSCULAS o tienen una o dos palabras, para no confundir frases como "Recuerden lo siguiente: ...".

## Motores y modelos de voz

| Modelo | Motor | Voces | Entiende tono/acotaciones |
|---|---|---|---|
| `google/gemini-3.8-flash-tts` (por defecto) | OpenRouter | 30 voces Gemini (Charon, Kore, Sulafat...) | Sí |
| `google/gemini-3.1-flash-tts-preview`, `google/gemini-3.8-flash-lite-tts` | OpenRouter | 30 voces Gemini | Sí |
| Otros de OpenRouter (Kokoro, Fish Audio...) | OpenRouter | Las que publica OpenRouter para cada modelo | No: solo texto, voz y velocidad |
| `gemini-2.5-flash-preview-tts`, `gemini-2.5-pro-preview-tts` | Gemini directo | 30 voces Gemini | Sí, con dos voces por solicitud |

- El modelo se elige en cada proyecto (y en el audio rápido). La lista combina los modelos conocidos con los que publica la API de modelos de OpenRouter, incluidas sus voces; también se puede escribir cualquier otro `proveedor/modelo`.
- Los identificadores con `/` van por OpenRouter; los demás, por Gemini directo. Solo aparecen los motores con clave configurada.
- OpenRouter genera una voz por solicitud: en diálogos, cada intervención se genera aparte y se une en orden.
- OpenRouter locuta todo lo que recibe como texto: por eso solo se le envía el guion limpio (sin acotaciones ni corchetes) y la dirección de voz (tono general, tono de cada párrafo, velocidad, acento) va aparte en el campo `instructions`. Si un modelo no acepta `instructions` o `speed`, se reintenta sin ellos y no se le vuelven a enviar.
- La velocidad del prompt se envía como `speed`; si el modelo no la acepta, se reintenta sin ella.
- El audio se pide en PCM (OpenRouter acepta `pcm` o `mp3`) y se convierte a 24 kHz mono según la frecuencia que indique la respuesta; también se aceptan respuestas WAV. Los modelos que solo entregan MP3 no son compatibles.

## Prompt de dirección de voz

Pega en el panel **Prompt de dirección de voz** las indicaciones de narración, aunque estén escritas para otras plataformas (ElevenLabs, Play.ht, etc.). Por ejemplo:

```
Voz: masculina, adulta, tono grave/cálido de documental (español latino, NO tono comercial).
- Estabilidad: alta (0.65-0.75)
- Velocidad: 90-95% de la velocidad normal
- Estilo/exageración: baja
- Pausas: añade [pausa] de 0.5s después de cada dato numérico o afirmación de escala
```

La app lo traduce a lo que entiende el modelo de voz:

| Indicación | Cómo se aplica |
|---|---|
| Género y tono (grave, cálido, documental, solemne...) | Sugiere una voz de Gemini acorde (p. ej. Charon, Gacrux, Sulafat) |
| Velocidad (%) | Parámetro `speed` en OpenRouter e instrucción de ritmo en los modelos que la entienden |
| Estabilidad / estilo | Instrucciones de interpretación (consistente, sobria, expresiva...) |
| Acento (latino, España) | Instrucción de acento |
| Pausas tras cifras | Silencios exactos insertados en el audio tras cada frase con números o escalas |
| Duración de `[pausa]` | Valor por defecto de las pausas sin duración |
| Texto completo | Se envía al modelo como notas del director |

Los prompts se pueden guardar con un nombre (en el navegador) para reutilizarlos.

## Cómo funciona

1. `src/lib/scriptParser.ts` convierte el guion en líneas y pausas, y las agrupa en bloques de hasta 2 voces (límite de Gemini multi-speaker).
2. `server/scriptAudio.ts` genera cada bloque con el motor del modelo elegido (`server/engines/openrouter.ts` o `server/engines/gemini.ts`, hasta 3 en paralelo), inserta los silencios y une todo en un WAV (PCM 16 bits, 24 kHz, mono).
3. `src/lib/voiceDirection.ts` interpreta el prompt de dirección de voz.
4. `src/lib/technicalScript.ts` divide un guion técnico en bloques y lo convierte al formato interno.
5. `server/projects.ts` guarda proyectos y audios; `server/zip.ts` arma el ZIP.

API:

- `POST /api/research/analyze` `{ input, template, model }` → análisis en streaming y, al final, el análisis guardado con sus nichos
- `GET/DELETE /api/research[/:id]`, `POST /api/research/:id/process` `{ nicheIndex | niche, model }` → formato de producción
- `GET/PATCH/DELETE /api/formats[/:id]`, `GET /api/formats/:id/markdown`
- `GET /api/text-models` → modelos de texto de OpenRouter para escribir guiones
- `POST /api/scripts/generate` `{ titulo, tema, duracion, segmentos, template, model }` → guion en texto plano, en streaming
- `GET /api/tts/models` → modelo por defecto, motores configurados y modelos con sus voces
- `POST /api/script-audio` `{ script, voices, direction, model }` → `audio/wav`
- `GET/POST /api/projects`, `GET/PATCH/DELETE /api/projects/:id`
- `POST /api/projects/:id/sections/:sectionId/generate`
- `GET /api/projects/:id/sections/:sectionId/audio` (`?download=1` para descargar)
- `GET /api/projects/:id/zip`

El audio rápido admite guiones de hasta 20.000 caracteres y los proyectos hasta 300.000. Modelo por defecto configurable con `OPENROUTER_TTS_MODEL`. Las solicitudes de voz se reintentan hasta 3 veces ante límites de cuota o errores temporales.

## Scripts

- `npm run dev`: servidor con Vite en modo desarrollo
- `npm run lint`: verificación de tipos
- `npm test`: tests del parser, del importador de guiones técnicos, del prompt de dirección, de los proyectos y del ensamblado de audio (sin llamar a la API)

## Despliegue automático en un servidor (Docker)

La app corre como un contenedor Docker independiente (`audios-pro`), así que convive con otros servicios del servidor sin tocarlos: no instala Node.js en el sistema, no comparte redes ni volúmenes, y solo limpia sus propias imágenes.

Cada push a `main` se prueba y se instala por SSH (`.github/workflows/deploy.yml` + `scripts/remote-deploy.sh`):

1. Copia el código a `/opt/audios-pro/src` y construye la imagen con el `Dockerfile`.
2. Arranca el contenedor con `docker compose` (`/opt/audios-pro/docker-compose.yml`), con reinicio automático.
3. Comprueba `/api/health`; si la nueva versión no responde, vuelve a la anterior.

Los proyectos y audios se guardan en `/opt/audios-pro/data` y la configuración en `/opt/audios-pro/.env`; ninguno se borra al actualizar. Antes de la primera instalación se comprueba que el puerto esté libre.

Configura estos *secrets* en GitHub (repo → Settings → Secrets and variables → Actions):

| Secret | Valor |
|---|---|
| `SSH_HOST` | IP del servidor |
| `SSH_USER` | Usuario SSH con permisos para usar Docker (por defecto `root`) |
| `SSH_PRIVATE_KEY` | Contenido completo de la clave privada (`.pem`) |
| `OPENROUTER_API_KEY` | Clave de OpenRouter |
| `APP_PASSWORD` | Contraseña de acceso a la app (usuario `admin`, o el de `APP_USER`) |
| `APP_PORT` | Puerto del servidor para la app (por defecto `3000`; usa uno libre si otro servicio lo ocupa) |
| `APP_BIND` | `127.0.0.1` para que la app solo sea accesible a través de tu proxy inverso; por defecto `0.0.0.0` (abierta) |
| `YOUTUBE_API_KEY` | Opcional: datos exactos de canales para el análisis de Ideas |
| `OPENROUTER_TTS_MODEL`, `OPENROUTER_TEXT_MODEL`, `GEMINI_API_KEY`, `SSH_PORT` | Opcionales |

Sin `SSH_HOST` y `SSH_PRIVATE_KEY` el despliegue se omite. La app queda en `http://IP:APP_PORT`. Si ya usas un proxy inverso (Nginx, Traefik, Caddy...), apúntalo a ese puerto y define el secret `APP_BIND=127.0.0.1` para no exponerlo directamente.

Comandos útiles en el servidor:

```bash
docker logs -f audios-pro                         # registro de la app
cd /opt/audios-pro && docker compose restart      # reiniciar
cd /opt/audios-pro && docker compose down         # detener
```

También se puede ejecutar a mano en cualquier máquina con Docker: `cp .env.example .env`, editarlo y `docker build -t audios-pro:current . && docker compose up -d`.
