# App de Audios Profesionales

Convierte guiones profesionales en locuciones con una voz distinta por personaje, usando Gemini TTS.

## Inicio rápido

```bash
npm install
cp .env.example .env   # agrega tu GEMINI_API_KEY
npm run dev            # http://localhost:3000
```

Producción: `npm run build && npm start`.

## Formato del guion

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
4. `POST /api/script-audio` con `{ script, voices: { PERSONAJE: "Kore" }, direction }` devuelve `audio/wav`.

Guiones de hasta 20.000 caracteres. Modelo configurable con `GEMINI_TTS_MODEL`.

## Scripts

- `npm run dev`: servidor con Vite en modo desarrollo
- `npm run lint`: verificación de tipos
- `npm test`: tests del parser, del prompt de dirección y del ensamblado de audio (sin llamar a la API)
