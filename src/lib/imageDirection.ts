// "Director de arte": un modelo de texto lee la narración de cada bloque y escribe los prompts de sus imágenes,
// usando las plantillas del formato solo como guía de estilo. Así cada imagen muestra lo que se narra
// (el lugar concreto y su ubicación real) aunque las plantillas sean de otro nicho.

import type { VisualVariation } from "./formats";
import { cleanImagePrompt } from "./imagePrompts";
import { extractJson } from "./formats";

export interface DirectionBlock {
  id: string;
  title: string;
  narration: string;
}

export interface DirectedPrompts {
  blocks: Record<string, { elemento: string; prompts: string[] }>;
  thumbnail?: string;
}

const MAX_NARRATION = 900;

// Texto narrado de un bloque (sin acotaciones, pausas ni nombres de personaje).
export function narrationOf(script: string): string {
  return script
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && !l.trim().startsWith("["))
    .map((l) => l.replace(/^[^:]{1,80}:\s*/, "").replace(/\[[^\]]*\]\s*/g, "").trim())
    .join(" ")
    .slice(0, MAX_NARRATION);
}

export function buildDirectionPrompt(input: {
  videoTitle: string;
  blocks: DirectionBlock[];
  variations: VisualVariation[];
  baseTemplate: string;
  thumbnailTemplate: string;
}): string {
  const shots = input.variations.map((v, i) => `${i + 1}. ${v.nombre}: ${v.prompt}`).join("\n");
  const blocks = input.blocks.map((b) => `[${b.id}] ${b.title}\n${b.narration}`).join("\n\n");
  return `Eres director de arte de un documental de YouTube titulado "${input.videoTitle}".
Para cada bloque del guion escribe, en inglés, los prompts de ${input.variations.length} imágenes fotorrealistas que ilustren EXACTAMENTE lo que se narra en ese bloque.

REGLAS:
- Cada imagen debe mostrar el lugar, objeto, animal o hecho concreto que se narra en el bloque, con su nombre propio y su ubicación geográfica real (p. ej. "Angel Falls, Canaima National Park, Venezuela"). Nada de lugares que el bloque no menciona.
- Si el bloque no nombra nada concreto (gancho, transición o cierre), ilustra su idea con una escena coherente con el tema del video.
- Las imágenes van en este orden y con este tipo de toma (guía de estilo; adáptala al tema: si el bloque trata de naturaleza, no uses términos de arquitectura o construcción, y cambia la toma "de archivo/construcción" por una toma histórica o de contexto que tenga sentido):
${shots}
- Estilo general de referencia: ${input.baseTemplate}
- Sin texto, sin letras, sin marcas de agua. No uses parámetros tipo "--ar".
- "elemento" es el tema visual principal del bloque, en inglés y con su ubicación.
- "miniatura": prompt de la miniatura del video siguiendo esta plantilla, con el elemento más impactante de todo el video: ${input.thumbnailTemplate}

Devuelve SOLO un objeto JSON, sin texto antes ni después, con esta forma:
{"bloques": [{"id": "<id del bloque>", "elemento": "...", "prompts": ["...", "..."]}], "miniatura": "..."}

BLOQUES:
${blocks}`;
}

export function parseDirection(raw: string, expected: number): DirectedPrompts {
  const data = extractJson(raw);
  if (!data || !Array.isArray(data.bloques)) throw new Error("El director de arte no devolvió los prompts en el formato esperado. Vuelve a intentarlo.");
  const blocks: DirectedPrompts["blocks"] = {};
  for (const b of data.bloques) {
    const id = String(b?.id ?? "").trim();
    const prompts = (Array.isArray(b?.prompts) ? b.prompts : []).map((p: unknown) => String(p ?? "").trim()).filter(Boolean);
    if (!id || !prompts.length) continue;
    blocks[id] = { elemento: String(b?.elemento ?? "").trim(), prompts: prompts.slice(0, expected).map(cleanImagePrompt) };
  }
  const thumbnail = typeof data.miniatura === "string" && data.miniatura.trim() ? cleanImagePrompt(data.miniatura) : undefined;
  return { blocks, thumbnail };
}
