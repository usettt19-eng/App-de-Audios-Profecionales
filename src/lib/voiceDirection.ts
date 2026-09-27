// Interpreta prompts de dirección de voz escritos para otras plataformas TTS (ElevenLabs, Play.ht, etc.)
// y los traduce a lo que Gemini TTS entiende: notas de interpretación en lenguaje natural,
// una voz sugerida y reglas de pausas que se aplican al guion.

export type VoiceGender = "masculina" | "femenina" | "indistinta";

export interface VoiceDirection {
  // Texto completo del prompt, que se envía al modelo como notas del director.
  raw: string;
  gender: VoiceGender;
  tones: string[];
  speedPercent?: number;
  // Duración de las pausas escritas como [pausa] sin duración explícita.
  defaultPauseMs?: number;
  // Pausa automática tras cada frase con cifras o afirmaciones de escala.
  pauseAfterNumbersMs?: number;
  stability?: "alta" | "media" | "baja";
  styleIntensity?: "alta" | "media" | "baja";
  suggestedVoice?: string;
  // Instrucciones de interpretación derivadas de los parámetros técnicos.
  performanceNotes: string[];
}

export const MAX_DIRECTION_CHARS = 6000;

const MALE_VOICES: Record<string, string> = {
  documental: "Charon",
  grave: "Algenib",
  calido: "Charon",
  solemne: "Charon",
  informativo: "Rasalgethi",
  maduro: "Algenib",
  suave: "Algieba",
  susurrante: "Enceladus",
  energico: "Fenrir",
  alegre: "Puck",
  juvenil: "Puck",
  amigable: "Achird",
  casual: "Zubenelgenubi",
  firme: "Orus",
  claro: "Iapetus",
};

const FEMALE_VOICES: Record<string, string> = {
  documental: "Gacrux",
  grave: "Gacrux",
  calido: "Sulafat",
  solemne: "Gacrux",
  informativo: "Kore",
  maduro: "Gacrux",
  suave: "Achernar",
  susurrante: "Achernar",
  energico: "Laomedeia",
  alegre: "Laomedeia",
  juvenil: "Leda",
  amigable: "Sulafat",
  casual: "Callirrhoe",
  firme: "Kore",
  claro: "Erinome",
};

// Palabra clave normalizada -> patrón que la detecta en el prompt (sin tildes, en minúsculas).
const TONE_PATTERNS: [string, RegExp][] = [
  ["documental", /documental|national geographic|discovery/],
  ["grave", /\bgrave|profund[oa]/],
  ["calido", /calid[oa]|calidez/],
  ["solemne", /solemne|revelando un secreto|intrig/],
  ["informativo", /informativ[oa]|periodistic|noticier/],
  ["maduro", /madur[oa]|adult[oa]/],
  ["suave", /\bsuave|delicad/],
  ["susurrante", /susurr/],
  ["energico", /energic|intens[oa]/],
  ["alegre", /alegre|entusiasta/],
  ["juvenil", /juvenil|joven/],
  ["amigable", /amigable|cercan[oa]/],
  ["casual", /casual|relajad/],
  ["firme", /firme|autoritari/],
  ["claro", /\bclar[oa]\b|diccion/],
];

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Quita del análisis los tonos que el prompt pide evitar: "NO tono infantil ni comercial/entusiasta".
function stripNegations(text: string): string {
  return text.replace(/\b(?:no|nunca|evitar?|sin|ni)\b(?:(?!\bsino\b)[^.\n;),])*/g, " ");
}

function parseLevel(text: string): "alta" | "media" | "baja" | undefined {
  const t = normalize(text);
  const number = t.match(/0[.,](\d+)/);
  if (/\balta\b|\balto\b/.test(t)) return "alta";
  if (/\bbaja\b|\bbajo\b|minim/.test(t)) return "baja";
  if (/\bmedia\b|\bmedio\b|moderad/.test(t)) return "media";
  if (number) {
    const value = parseFloat(`0.${number[1]}`);
    return value >= 0.6 ? "alta" : value <= 0.35 ? "baja" : "media";
  }
  return undefined;
}

function findLine(lines: string[], pattern: RegExp): string | undefined {
  return lines.find((l) => pattern.test(normalize(l)));
}

function parseSeconds(text: string): number | undefined {
  const m = normalize(text).match(/(\d+(?:[.,]\d+)?)\s*(ms|s\b|seg)/);
  if (!m) return undefined;
  const value = parseFloat(m[1].replace(",", "."));
  return Math.round(m[2] === "ms" ? value : value * 1000);
}

export function parseVoiceDirection(raw: string): VoiceDirection {
  const text = raw.slice(0, MAX_DIRECTION_CHARS);
  const lines = text.split(/\r?\n/);
  const norm = normalize(text);
  const positive = stripNegations(norm);

  const male = /masculin|hombre|varon/.test(norm);
  const female = /femenin|mujer/.test(norm);
  const gender: VoiceGender = male && !female ? "masculina" : female && !male ? "femenina" : "indistinta";

  const tones = TONE_PATTERNS.filter(([, re]) => re.test(positive)).map(([tone]) => tone);

  const direction: VoiceDirection = { raw: text, gender, tones, performanceNotes: [] };

  const speedLine = findLine(lines, /velocidad|ritmo|speed/);
  if (speedLine) {
    const range = normalize(speedLine).match(/(\d{2,3})\s*%?\s*(?:-|–|a)\s*(\d{2,3})\s*%/);
    const single = normalize(speedLine).match(/(\d{2,3})\s*%/);
    const speed = range ? (parseInt(range[1]) + parseInt(range[2])) / 2 : single ? parseInt(single[1]) : undefined;
    if (speed && speed >= 50 && speed <= 200) direction.speedPercent = Math.round(speed);
  }

  const stabilityLine = findLine(lines, /estabilidad|stability/);
  if (stabilityLine) direction.stability = parseLevel(stabilityLine.split(/[:=]/).slice(1).join(":") || stabilityLine);

  const styleLine = findLine(lines, /estilo|exageracion|style/);
  if (styleLine) direction.styleIntensity = parseLevel(styleLine.split(/[:=]/).slice(1).join(":") || styleLine);

  // La regla de pausas puede ocupar varias líneas: se analiza desde la línea "Pausas" hasta la siguiente viñeta.
  // Se busca la palabra "pausa(s)" completa para no confundir "ritmo pausado" con una regla de pausas.
  const pauseIndex = lines.findIndex((l) => /\bpausas?\b/.test(normalize(l)));
  if (pauseIndex >= 0) {
    let block = lines[pauseIndex];
    for (let i = pauseIndex + 1; i < lines.length && !/^\s*[-•*]/.test(lines[i]) && lines[i].trim(); i++) block += ` ${lines[i]}`;
    const ms = parseSeconds(block);
    if (ms !== undefined) {
      direction.defaultPauseMs = ms;
      if (/numeric|cifra|dato|numero|escala|estadistic/.test(normalize(block))) direction.pauseAfterNumbersMs = ms;
    }
  }

  const table = gender === "femenina" ? FEMALE_VOICES : MALE_VOICES;
  direction.suggestedVoice = tones.map((t) => table[t]).find(Boolean) ?? (gender === "femenina" ? "Kore" : "Charon");

  const notes = direction.performanceNotes;
  if (direction.speedPercent && direction.speedPercent < 100) {
    notes.push(`Habla a un ${direction.speedPercent}% de la velocidad normal: ritmo pausado y deliberado, sin apresurarte.`);
  } else if (direction.speedPercent && direction.speedPercent > 100) {
    notes.push(`Habla a un ${direction.speedPercent}% de la velocidad normal: ritmo ágil pero siempre inteligible.`);
  }
  if (direction.stability === "alta") notes.push("Mantén una interpretación estable y consistente de principio a fin, sin cambios emocionales bruscos.");
  if (direction.stability === "baja") notes.push("Permite variaciones expresivas marcadas entre frases.");
  if (direction.styleIntensity === "baja") notes.push("Estilo sobrio y contenido: nada de tono vendedor ni exagerado.");
  if (direction.styleIntensity === "alta") notes.push("Interpretación expresiva y con carácter marcado.");
  if (/latin/.test(norm)) notes.push("Usa acento de español latinoamericano neutro.");
  else if (/castellan|espana|iberic/.test(norm)) notes.push("Usa acento de español de España.");

  return direction;
}

const TONE_LABELS: Record<string, string> = { calido: "cálido", energico: "enérgico" };

export function directionSummary(d: VoiceDirection): string[] {
  const chips: string[] = [];
  if (d.gender !== "indistinta") chips.push(`Voz ${d.gender}`);
  if (d.tones.length) chips.push(`Tono: ${d.tones.map((t) => TONE_LABELS[t] || t).join(", ")}`);
  if (d.speedPercent) chips.push(`Velocidad ${d.speedPercent}%`);
  if (d.stability) chips.push(`Estabilidad ${d.stability}`);
  if (d.styleIntensity) chips.push(`Estilo ${d.styleIntensity}`);
  if (d.pauseAfterNumbersMs !== undefined) chips.push(`Pausa ${d.pauseAfterNumbersMs / 1000}s tras cifras`);
  else if (d.defaultPauseMs !== undefined) chips.push(`[pausa] = ${d.defaultPauseMs / 1000}s`);
  return chips;
}
