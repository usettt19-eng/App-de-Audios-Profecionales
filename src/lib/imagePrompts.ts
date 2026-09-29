// Prompts de imagen por bloque: las plantillas del formato (con {elemento}) rellenadas con lo que trata cada bloque.

import type { VisualVariation } from "./formats";

// Bloques sin un tema concreto en el título: la apertura usa su primera frase como tema de la imagen
// y el cierre, el tema general del video (su primera frase suele ser la invitación a suscribirse).
const OPENING_TITLE = /^(gancho|intro(ducci[oó]n)?|apertura|bloque\s*\d*|audio\s*\d*|parte\s*\d*)$/i;
const CLOSING_TITLE = /^(cierre|final|conclusi[oó]n|despedida|outro)$/i;

function firstSentence(script: string): string {
  const narration = script
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && !l.startsWith("["))
    .map((l) => l.replace(/^[^:]{1,80}:\s*/, "").replace(/\[[^\]]*\]\s*/g, ""))
    .join(" ");
  const sentence = (narration.split(/(?<=[.!?…])\s+/)[0] ?? "").replace(/[.!?…\s]+$/, "");
  return sentence.length > 160 ? `${sentence.slice(0, 157)}…` : sentence;
}

export function isGenericTitle(title: string): boolean {
  const t = title.trim();
  return OPENING_TITLE.test(t) || CLOSING_TITLE.test(t);
}

// "Estructura 1: El Viaducto de Millau" -> "El Viaducto de Millau". `topic` es el tema del video, para el cierre.
export function subjectForSection(title: string, script: string, topic = ""): string {
  const clean = title.replace(/^(estructura|segmento|parte|cap[ií]tulo|lugar|n[uú]mero)\s*\d+\s*[:.—–-]\s*/i, "").trim();
  if (clean && !isGenericTitle(clean)) return clean;
  if (CLOSING_TITLE.test(clean) && topic.trim()) return topic.trim();
  return firstSentence(script) || topic.trim() || clean || title;
}

// Las plantillas vienen de Midjourney: los parámetros "--ar 16:9 --style raw" no los entienden otros modelos
// (la proporción se envía aparte), y se asegura que la imagen no lleve texto.
export function cleanImagePrompt(prompt: string): string {
  let text = prompt.replace(/\s--[a-z]+(\s+[^\s-][^\s]*)?/gi, "").replace(/\s+/g, " ").trim().replace(/[,.\s]+$/, "");
  if (!/no text/i.test(text)) text += ", no text, no watermark";
  return text;
}

export function fillTemplate(template: string, subject: string): string {
  const filled = template.includes("{elemento}") ? template.replaceAll("{elemento}", subject) : `${subject}, ${template}`;
  return cleanImagePrompt(filled);
}

export function buildImagePrompts(variations: VisualVariation[], subject: string): { variation: string; prompt: string }[] {
  return variations.map((v) => ({ variation: v.nombre, prompt: fillTemplate(v.prompt, subject) }));
}

// Miniatura: la estructura más impactante, que en el formato countdown es la última antes del cierre.
export function thumbnailSubject(sections: { title: string; script: string }[], fallback: string): string {
  const specific = sections.filter((s) => !isGenericTitle(s.title));
  const last = specific[specific.length - 1];
  return last ? subjectForSection(last.title, last.script, fallback) : fallback;
}
