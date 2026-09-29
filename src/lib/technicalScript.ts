// Importa guiones técnicos de locución (formato Markdown habitual en guiones generados por IA)
// y los divide en secciones, una por audio:
//
//   ### **[BLOQUE 1 — GANCHO]**                -> nueva sección "Gancho"
//   **(MÚSICA: Inicio cinemático...)**          -> indicación de producción (no se locuta)
//   **(SFX: Impacto grave)**                    -> indicación de producción (no se locuta)
//   *(Tono: Intrigante, pausado)*               -> tono para los párrafos siguientes
//   *(Enfático)* / *(Transición)*               -> indicación solo para el párrafo siguiente
//   *(Pausa de 1 segundo)* / *(Pausa táctica)*  -> silencio
//   **palabra**                                 -> énfasis en esa palabra
//
// Cada sección se convierte al formato interno de guion (ver scriptParser.ts).

import { DEFAULT_SPEAKER } from "./scriptParser";

export interface ProductionCue {
  kind: string;
  description: string;
}

export interface ImportedSection {
  title: string;
  script: string;
  cues: ProductionCue[];
}

const SECTION_WORDS = "BLOQUE|ESCENA|SECCI[OÓ]N|PARTE|CAP[IÍ]TULO|SEGMENTO|EPISODIO|AUDIO";
// [BLOQUE 1 — GANCHO]
const SECTION_RE = new RegExp(`\\[\\s*((?:${SECTION_WORDS})\\b[^\\]]*)\\]`, "i");
// Marcas mal cerradas que escriben a veces los modelos: "[BLOQUE 6 — SIERRA NEVADA**" (sin corchete de cierre).
const OPEN_SECTION_RE = new RegExp(`^[#*_\\s>]*\\[\\s*((?:${SECTION_WORDS})\\s*\\d+\\b[^\\]]*?)[\\s*_]*$`, "i");
// Títulos markdown o en negrita sin corchetes: "### BLOQUE 3 — X", "**BLOQUE 3 — X**".
const HEADING_SECTION_RE = new RegExp(`^(?:#{1,6}\\s*|[*_]{2})[*_\\s]*((?:${SECTION_WORDS})\\s*\\d+\\b.*?)[\\s*_]*$`, "i");
// Indicaciones de producción dentro de un párrafo: "... (MÚSICA: épica) (Tono: seria) (Pausa de 2 segundos)".
const INLINE_MARK_RE = /\(\s*((?:m[uú]sica|efectos?(?: de sonido)?(?:\s*\/\s*sfx)?|sfx|fx|sonido|ambiente|cortina|r[aá]faga|tono)\s*:[^()]*|pausa\b[^()]*)\)/gi;

function matchSection(line: string): string | null {
  const m = line.match(SECTION_RE) ?? line.match(OPEN_SECTION_RE) ?? line.match(HEADING_SECTION_RE);
  return m ? m[1].replace(/[\s*_\]]+$/, "").trim() : null;
}

// Número de marcas de bloque que aparecen en el texto, para avisar si alguna no se pudo leer.
export function countBlockMarkers(text: string): number {
  return text.split(/\r?\n/).filter((l) => new RegExp(`^[#*_\\s>\\[]*(?:${SECTION_WORDS})\\s*\\d+`, "i").test(l.trim())).length;
}
const CUE_RE = /^(M[UÚ]SICA|EFECTOS?(?: DE SONIDO)?(?:\s*\/\s*SFX)?|SFX|FX|SONIDO|AMBIENTE|CORTINA|R[AÁ]FAGA)\s*:\s*(.*)$/i;
const PAUSE_DIRECTION_RE = /^pausa\b(?:\s*de)?\s*(\d+(?:[.,]\d+)?)?\s*(segundos?|seg|s|ms|milisegundos)?/i;
const INLINE_SPEAKER_RE = /^([A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ .]{1,30})\s*:\s*(.+)$/;

const TACTICAL_PAUSE_MS = 1200;
const DEFAULT_DIRECTION_PAUSE_MS = 1000;

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/(^|[^\w*])\*(?!\s)(.+?)\*(?!\w)/g, "$1$2")
    .replace(/(^|[^\w_])_(?!\s)(.+?)_(?!\w)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function boldWords(text: string): string[] {
  return [...text.matchAll(/\*\*(.+?)\*\*/g)].map((m) => stripMarkdown(m[1]));
}

// Texto entre paréntesis que ocupa la línea entera: "(Tono: Épico)" -> "Tono: Épico".
function wholeParenthetical(line: string): string | null {
  const m = stripMarkdown(line).match(/^\((.*)\)$/s);
  return m ? m[1].trim() : null;
}

const MINOR_WORDS = new Set(["de", "del", "la", "las", "el", "los", "y", "e", "o", "u", "en", "a", "al", "con", "por", "para", "sin", "sobre"]);

// "EL VIADUCTO DE MILLAU" -> "El Viaducto de Millau"
function titleCase(text: string): string {
  let startOfPhrase = true;
  return text
    .toLocaleLowerCase("es")
    .split(/(\s+)/)
    .map((word) => {
      if (/^\s+$/.test(word)) return word;
      const capitalize = startOfPhrase || !MINOR_WORDS.has(word);
      startOfPhrase = /[:.—–-]$/.test(word);
      // "(mérida)" -> "(Mérida)": se capitaliza la primera letra aunque vaya tras un signo.
      const i = word.search(/\p{L}/u);
      return capitalize && i >= 0 ? word.slice(0, i) + word.charAt(i).toLocaleUpperCase("es") + word.slice(i + 1) : word;
    })
    .join("");
}

function sectionTitle(label: string): string {
  // "BLOQUE 2 — ESTRUCTURA 1: EL VIADUCTO DE MILLAU" -> "Estructura 1: el viaducto de millau"
  const parts = label.split(/\s+[—–-]\s+/);
  const title = (parts.length > 1 ? parts.slice(1).join(" — ") : parts[0]).trim();
  return title === title.toUpperCase() ? titleCase(title) : title;
}

// Las indicaciones van dentro de "PERSONAJE (indicación): texto", así que no pueden llevar paréntesis.
function cleanDirection(text: string): string {
  return text.replace(/[()]/g, "").replace(/\s+/g, " ").trim();
}

function pauseMs(amount?: string, unit?: string): number {
  if (!amount) return DEFAULT_DIRECTION_PAUSE_MS;
  const value = parseFloat(amount.replace(",", "."));
  return Math.round(unit && /^m/i.test(unit) ? value : value * 1000);
}

export function looksLikeTechnicalScript(text: string): boolean {
  return text.split(/\r?\n/).some((l) => matchSection(l.trim()) !== null) || /\*\(\s*tono\s*:/i.test(text) || /\(\s*(?:m[uú]sica|sfx)\s*:/i.test(text);
}

export function importTechnicalScript(text: string): ImportedSection[] {
  const lines = text.split(/\r?\n/);
  const hasSections = lines.some((l) => matchSection(l.trim()) !== null);
  const sections: { title: string; out: string[]; cues: ProductionCue[] }[] = [];
  let current: (typeof sections)[number] | null = hasSections ? null : { title: "Audio 1", out: [], cues: [] };
  if (current) sections.push(current);

  let tone = "";
  let oneOff: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || /^[-*_]{3,}$/.test(line)) continue;

    const sectionLabel = matchSection(line);
    if (sectionLabel) {
      current = { title: sectionTitle(stripMarkdown(sectionLabel)), out: [], cues: [] };
      sections.push(current);
      tone = "";
      oneOff = [];
      continue;
    }
    // Todo lo anterior al primer bloque (presentaciones, títulos generales) no se locuta.
    if (!current || /^#{1,6}\s/.test(line)) continue;

    const paren = wholeParenthetical(line);
    if (paren !== null) {
      const cue = paren.match(CUE_RE);
      if (cue) {
        const kind = cue[1].toUpperCase().replace(/\s*\/\s*SFX/, "").replace(/^EFECTOS?( DE SONIDO)?$/, "SFX");
        current.cues.push({ kind, description: cue[2].trim() });
        current.out.push(`# ${kind}: ${cue[2].trim()}`);
        continue;
      }
      const pause = paren.match(PAUSE_DIRECTION_RE);
      if (pause) {
        const ms = /t[aá]ctica|dram[aá]tica/i.test(paren) && !pause[1] ? TACTICAL_PAUSE_MS : pauseMs(pause[1], pause[2]);
        current.out.push(`[PAUSA ${ms}ms]`);
        continue;
      }
      const toneMatch = paren.match(/^tono\s*:\s*(.+)$/i);
      if (toneMatch) tone = cleanDirection(toneMatch[1]);
      else oneOff.push(cleanDirection(paren));
      continue;
    }

    // Indicaciones dentro del párrafo: la música y los efectos van a la hoja de producción, el tono se aplica
    // al párrafo y las pausas se colocan en su sitio. No se locutan.
    const pieces: ({ text: string } | { pauseMs: number })[] = [];
    let last = 0;
    for (const m of line.matchAll(INLINE_MARK_RE)) {
      pieces.push({ text: line.slice(last, m.index) });
      last = (m.index ?? 0) + m[0].length;
      const inner = m[1].trim();
      const cue = inner.match(CUE_RE);
      const pause = inner.match(PAUSE_DIRECTION_RE);
      const toneMatch = inner.match(/^tono\s*:\s*(.+)$/i);
      if (toneMatch) tone = cleanDirection(toneMatch[1]);
      else if (cue) {
        const kind = cue[1].toUpperCase().replace(/\s*\/\s*SFX/, "").replace(/^EFECTOS?( DE SONIDO)?$/, "SFX");
        current.cues.push({ kind, description: cue[2].trim() });
        current.out.push(`# ${kind}: ${cue[2].trim()}`);
      } else if (pause) {
        pieces.push({ pauseMs: /t[aá]ctica|dram[aá]tica/i.test(inner) && !pause[1] ? TACTICAL_PAUSE_MS : pauseMs(pause[1], pause[2]) });
      }
    }
    pieces.push({ text: line.slice(last) });

    for (const piece of pieces) {
      if ("pauseMs" in piece) {
        current.out.push(`[PAUSA ${piece.pauseMs}ms]`);
        continue;
      }
      const raw = piece.text.trim();
      if (!raw) continue;
      const emphasis = boldWords(raw);
      let spoken = stripMarkdown(raw);
      let speaker = DEFAULT_SPEAKER;
      const inline = spoken.match(INLINE_SPEAKER_RE);
      if (inline) {
        speaker = inline[1].trim();
        spoken = inline[2];
      }
      if (!spoken.trim()) continue;
      const direction = [tone, ...oneOff, emphasis.length ? `enfatiza ${emphasis.map((w) => `«${w}»`).join(", ")}` : ""]
        .filter(Boolean)
        .map(cleanDirection)
        .join("; ");
      current.out.push(direction ? `${speaker} (${direction}): ${spoken}` : `${speaker}: ${spoken}`);
      oneOff = [];
    }
  }

  return sections
    .filter((s) => s.out.some((l) => !l.startsWith("#") && !l.startsWith("[")))
    .map((s) => ({ title: s.title, script: s.out.join("\n"), cues: s.cues }));
}
