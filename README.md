# App de Audios Profesionales

Convierte guiones profesionales en locuciones con una voz distinta por personaje, usando Gemini TTS.

## Inicio rápido

```bash
npm install
cp .env.example .env   # agrega tu GEMINI_API_KEY
npm run dev            # http://localhost:3000
```

Producción: `npm run build && npm start`.

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

## Prompt de dirección de voz

Pega en el panel **Prompt de dirección de voz** las indicaciones de narración, aunque estén escritas para otras plataformas (ElevenLabs, Play.ht, etc.). Por ejemplo:

```
Voz: masculina, adulta, tono grave/cálido de documental (español latino, NO tono comercial).
- Estabilidad: alta (0.65-0.75)
- Velocidad: 90-95% de la velocidad normal
- Estilo/exageración: baja
- Pausas: añade [pausa] de 0.5s después de cada dato numérico o afirmación de escala
```

La app lo traduce a lo que Gemini TTS entiende:

| Indicación | Cómo se aplica |
|---|---|
| Género y tono (grave, cálido, documental, solemne...) | Sugiere una voz de Gemini acorde (p. ej. Charon, Gacrux, Sulafat) |
| Velocidad (%) | Instrucción de ritmo al modelo (Gemini no tiene un parámetro de velocidad) |
| Estabilidad / estilo | Instrucciones de interpretación (consistente, sobria, expresiva...) |
| Acento (latino, España) | Instrucción de acento |
| Pausas tras cifras | Silencios exactos insertados en el audio tras cada frase con números o escalas |
| Duración de `[pausa]` | Valor por defecto de las pausas sin duración |
| Texto completo | Se envía al modelo como notas del director |

Los prompts se pueden guardar con un nombre (en el navegador) para reutilizarlos.

## Cómo funciona

1. `src/lib/scriptParser.ts` convierte el guion en líneas y pausas, y las agrupa en bloques de hasta 2 voces (límite de Gemini multi-speaker).
2. `server/scriptAudio.ts` genera cada bloque con Gemini TTS (hasta 3 en paralelo), inserta los silencios y une todo en un WAV (PCM 16 bits, 24 kHz, mono).
3. `src/lib/voiceDirection.ts` interpreta el prompt de dirección de voz.
4. `src/lib/technicalScript.ts` divide un guion técnico en bloques y lo convierte al formato interno.
5. `server/projects.ts` guarda proyectos y audios; `server/zip.ts` arma el ZIP.

API:

- `POST /api/script-audio` `{ script, voices, direction }` → `audio/wav`
- `GET/POST /api/projects`, `GET/PATCH/DELETE /api/projects/:id`
- `POST /api/projects/:id/sections/:sectionId/generate`
- `GET /api/projects/:id/sections/:sectionId/audio` (`?download=1` para descargar)
- `GET /api/projects/:id/zip`

El audio rápido admite guiones de hasta 20.000 caracteres y los proyectos hasta 300.000. Modelo configurable con `GEMINI_TTS_MODEL`. Las solicitudes a Gemini se reintentan hasta 3 veces ante límites de cuota o errores temporales.

## Scripts

- `npm run dev`: servidor con Vite en modo desarrollo
- `npm run lint`: verificación de tipos
- `npm test`: tests del parser, del importador de guiones técnicos, del prompt de dirección, de los proyectos y del ensamblado de audio (sin llamar a la API)
