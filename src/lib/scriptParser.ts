// Parser de guiones profesionales para el generador de audio (compartido entre cliente y servidor).
//
// Formato soportado:
//   # Comentario o encabezado de escena        -> se ignora
//   NARRADOR: Texto hablado                    -> línea de diálogo
//   LOCUTORA (entusiasta): Texto               -> acotación de interpretación para esa línea
//   Texto sin prefijo                          -> continúa al último personaje (o NARRADOR)
//   (susurrando) texto                         -> acotación en línea, se envía como [susurrando]
//   [PAUSA] / [PAUSA 2s] / [PAUSA 500ms]       -> silencio

export type ScriptSegment =
  | { type: "line"; speaker: string; text: string; direction?: string }
  | { type: "pause"; ms: number };

export interface AudioBlock {
  speakers: string[];
  lines: { speaker: string; text: string; direction?: string }[];
}

export type RenderPlan = ({ type: "block"; block: AudioBlock } | { type: "pause"; ms: number })[];

export const DEFAULT_SPEAKER = "NARRADOR";
export const DEFAULT_PAUSE_MS = 800;
export const MAX_PAUSE_MS = 10000;
// Los modelos TTS de Gemini admiten como máximo 2 voces por solicitud.
export const MAX_SPEAKERS_PER_BLOCK = 2;
export const MAX_BLOCK_CHARS = 2500;

const PAUSE_RE = /^\[\s*(?:pausa|pause|silencio)\s*(?:(\d+(?:[.,]\d+)?)\s*(ms|s)?)?\s*\]$/i;
const SPEAKER_RE = /^([\p{L}\p{N}_ .'-]{1,40}?)\s*(?:\(([^)]*)\))?\s*:\s*(.*)$/u;

function parsePauseMs(amount?: string, unit?: string): number {
  if (!amount) return DEFAULT_PAUSE_MS;
  const value = parseFloat(amount.replace(",", "."));
  const ms = unit?.toLowerCase() === "ms" ? value : value * 1000;
  return Math.min(Math.max(Math.round(ms), 0), MAX_PAUSE_MS);
}

export function normalizeSpeaker(name: string): string {
  return name.trim().replace(/\s+/g, " ").toUpperCase();
}

// Evita confundir frases con dos puntos ("Recuerden lo siguiente: ...") con un personaje:
// se aceptan nombres en mayúsculas (convención de guion) o de una o dos palabras.
function looksLikeSpeakerName(name: string): boolean {
  const trimmed = name.trim();
  if (!/\p{L}/u.test(trimmed)) return false;
  return trimmed === trimmed.toUpperCase() || trimmed.split(/\s+/).length <= 2;
}

// Convierte acotaciones "(con calma)" en etiquetas "[con calma]" que el modelo interpreta sin leerlas.
function inlineDirections(text: string): string {
  return text.replace(/\(([^)]{1,60})\)/g, "[$1]").trim();
}

export function parseScript(script: string): ScriptSegment[] {
  const segments: ScriptSegment[] = [];
  let currentSpeaker = DEFAULT_SPEAKER;

  for (const rawLine of script.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;

    const pause = line.match(PAUSE_RE);
    if (pause) {
      segments.push({ type: "pause", ms: parsePauseMs(pause[1], pause[2]) });
      continue;
    }

    const speakerMatch = line.match(SPEAKER_RE);
    let text = line;
    let direction: string | undefined;
    if (speakerMatch && speakerMatch[3].trim() && looksLikeSpeakerName(speakerMatch[1])) {
      currentSpeaker = normalizeSpeaker(speakerMatch[1]);
      direction = speakerMatch[2]?.trim() || undefined;
      text = speakerMatch[3];
    }

    // Pausas incrustadas dentro de una línea: "Hola. [PAUSA 1s] ¿Cómo estás?"
    const parts = text.split(/(\[\s*(?:pausa|pause|silencio)[^\]]*\])/i);
    for (const part of parts) {
      const p = part.trim();
      if (!p) continue;
      const inlinePause = p.match(PAUSE_RE);
      if (inlinePause) {
        segments.push({ type: "pause", ms: parsePauseMs(inlinePause[1], inlinePause[2]) });
      } else {
        segments.push({ type: "line", speaker: currentSpeaker, text: inlineDirections(p), direction });
      }
    }
  }
  return segments;
}

export function listSpeakers(segments: ScriptSegment[]): string[] {
  const seen: string[] = [];
  for (const s of segments) {
    if (s.type === "line" && !seen.includes(s.speaker)) seen.push(s.speaker);
  }
  return seen;
}

// Agrupa las líneas en bloques de como máximo 2 voces y un tamaño acotado, respetando el orden.
export function buildRenderPlan(segments: ScriptSegment[]): RenderPlan {
  const plan: RenderPlan = [];
  let block: AudioBlock | null = null;
  let blockChars = 0;

  const flush = () => {
    if (block && block.lines.length) plan.push({ type: "block", block });
    block = null;
    blockChars = 0;
  };

  for (const seg of segments) {
    if (seg.type === "pause") {
      flush();
      plan.push({ type: "pause", ms: seg.ms });
      continue;
    }
    const current = block as AudioBlock | null;
    const needsNewSpeaker = current !== null && !current.speakers.includes(seg.speaker);
    if (
      current &&
      ((needsNewSpeaker && current.speakers.length >= MAX_SPEAKERS_PER_BLOCK) ||
        blockChars + seg.text.length > MAX_BLOCK_CHARS)
    ) {
      flush();
    }
    if (!block) block = { speakers: [], lines: [] };
    const b = block as AudioBlock;
    if (!b.speakers.includes(seg.speaker)) b.speakers.push(seg.speaker);
    b.lines.push({ speaker: seg.speaker, text: seg.text, direction: seg.direction });
    blockChars += seg.text.length;
  }
  flush();
  return plan;
}

export function estimateDurationSeconds(segments: ScriptSegment[]): number {
  // ~150 palabras por minuto para locución profesional en español.
  let seconds = 0;
  for (const s of segments) {
    if (s.type === "pause") seconds += s.ms / 1000;
    else seconds += (s.text.split(/\s+/).filter(Boolean).length / 150) * 60;
  }
  return Math.round(seconds);
}
