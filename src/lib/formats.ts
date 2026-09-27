// Formatos de producción: el "proceso" completo de un tipo de video (como proceso-documental-arquitectura.md).
// Nacen del análisis de un canal (prompt de análisis → 3 nichos → proceso para el nicho elegido)
// y alimentan el generador de guiones, la dirección de voz y, más adelante, las imágenes.

import { DEFAULT_SCRIPT_PROMPT, DOCUMENTARY_VOICE_DIRECTION } from "./scriptTemplates";

export interface VisualVariation {
  nombre: string;
  prompt: string;
}

export interface ProductionFormat {
  id: string;
  nombre: string;
  nicho: string;
  // Canal o idea de origen y análisis del formato base (sección 1 del proceso).
  origen?: string;
  analisis: string;
  titulo: string;
  patronTitulo: string;
  duracion: string;
  segmentos: string;
  promptGuion: string;
  direccionVoz: string;
  // Plantillas de imagen: {elemento} se reemplaza por lo que trata cada bloque (p. ej. "Viaducto de Millau").
  visuales: { plantillaBase: string; variaciones: VisualVariation[]; animacion: string };
  miniatura: string;
  checklist: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Niche {
  nombre: string;
  porQue: string;
}

export const BUILTIN_FORMAT_ID = "documental-construcciones";

// Formato de partida: el proceso "Construcciones Imposibles" (formato Curiosiviajes).
export const BUILTIN_FORMAT: ProductionFormat = {
  id: BUILTIN_FORMAT_ID,
  nombre: "Documental construcciones (formato Curiosiviajes)",
  nicho: "Arquitectura e ingeniería: construcciones y estructuras imposibles",
  origen: "Curiosiviajes (@iCuriosiviajes)",
  analisis: `- **Estructura:** compilación/countdown con gancho superlativo. Sin presentador en cámara, narración + b-roll/imágenes generadas.
- **Duración:** formato largo (20-40+ min), pensado para watch time total.
- **Título:** patrón "[Superlativo] + del Mundo/Jamás Hechas" + etiqueta de calidad ("Documental 4K").
- **Ángulo emocional:** asombro pasivo, no enseña ni da tips — vende la experiencia de quedarse viendo maravillas.

**Adaptación al nicho:** arquitectura e ingeniería — construcciones/estructuras imposibles. Mismo molde narrativo, tema intercambiable.`,
  titulo: "LAS CONSTRUCCIONES MÁS IMPOSIBLES JAMÁS HECHAS | Documental 4K",
  patronTitulo: '"[Superlativo] + Jamás Hechas/del Mundo" + "Documental 4K"',
  duracion: "25-30",
  segmentos: "12 a 15",
  promptGuion: DEFAULT_SCRIPT_PROMPT,
  direccionVoz: DOCUMENTARY_VOICE_DIRECTION,
  visuales: {
    plantillaBase:
      "{elemento}, cinematic aerial establishing shot, golden hour lighting, dramatic scale showing human tiny in comparison, ultra realistic architectural photography, 8k, volumetric light, slight fog for depth, National Geographic documentary style, no text, no watermark --ar 16:9 --style raw",
    variaciones: [
      { nombre: "Establishing shot", prompt: "{elemento}, wide aerial drone shot at sunrise, epic scale, cinematic color grading, 8k --ar 16:9" },
      { nombre: "Detail shot", prompt: "close-up architectural detail of {elemento}, engineering textures, macro photography, dramatic side lighting --ar 16:9" },
      { nombre: "Human scale shot", prompt: "{elemento} with tiny human silhouette for scale, wide shot, dramatic perspective, cinematic --ar 16:9" },
      {
        nombre: "Construction/historical angle",
        prompt: "black and white archival-style photo of {elemento} under construction, dramatic industrial lighting, documentary photography --ar 16:9",
      },
    ],
    animacion:
      "Slow cinematic push-in on {elemento}, subtle camera drift left to right, clouds moving slowly, no people moving, atmospheric, documentary b-roll style, 5 seconds",
  },
  miniatura:
    "YouTube thumbnail, {elemento} in extreme low angle, dramatic scale, bold contrast, deep shadows and bright highlights, slightly oversaturated colors, no text overlay, cinematic, hyperrealistic, 16:9",
  checklist: [
    "Generar guion completo",
    "Dividir el guion en bloques (uno por estructura)",
    "Generar narración TTS por bloque",
    "Generar 4 imágenes/clips por cada estructura",
    "Generar miniatura",
    "Editar: sincronizar narración con b-roll, música de fondo baja, cortes cada 20-30s",
    'Título + descripción siguiendo el patrón "[Superlativo] + Jamás Hechas/del Mundo" + "Documental 4K"',
  ],
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
};

// --- Paso 1: análisis del canal ---

export const DEFAULT_ANALYSIS_PROMPT = `Analiza este canal de YouTube y dime cuál es el formato exacto que le está funcionando —no el tema, el patrón repetible: estructura, duración, tipo de gancho. Después dame 3 nichos distintos donde ese mismo formato casi no se esté usando todavía, explicando por qué cada uno tiene hueco.`;

export const ANALYSIS_OUTPUT_RULES = `FORMATO DE RESPUESTA (lo procesa una aplicación):
1. Escribe el análisis en markdown, en español, con dos secciones:
   ## Formato que funciona — estructura, duración, tipo de gancho, patrón de título y ángulo emocional, con ejemplos concretos de sus videos.
   ## 3 nichos con hueco — cada nicho con su nombre y por qué tiene hueco.
2. Termina SIEMPRE con un bloque de código \`\`\`json con exactamente esta forma:
{"formato": "resumen del formato en una frase", "nichos": [{"nombre": "nicho 1", "por_que": "por qué tiene hueco"}, {"nombre": "nicho 2", "por_que": "..."}, {"nombre": "nicho 3", "por_que": "..."}]}`;

export function buildAnalysisPrompt(template: string, input: string, channelData?: string): string {
  const data = channelData
    ? `\n\nDATOS DEL CANAL (obtenidos de YouTube):\n${channelData}`
    : "\n\nNo hay datos directos del canal: investiga en la web sus videos, títulos, duraciones y vistas antes de analizar.";
  return `${template.trim()}\n\nCanal o idea a analizar: ${input.trim()}${data}\n\n${ANALYSIS_OUTPUT_RULES}`;
}

// Extrae el JSON final del análisis (o de cualquier respuesta): bloque ```json o el último objeto {...}.
export function extractJson(text: string): any | null {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]).reverse();
  const candidates = [...fenced];
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate.trim());
    } catch {
      // Se prueba el siguiente candidato.
    }
  }
  return null;
}

export function parseNiches(text: string): Niche[] {
  const data = extractJson(text);
  const list: any[] = Array.isArray(data?.nichos) ? data.nichos : [];
  return list
    .map((n) => ({ nombre: String(n?.nombre ?? "").trim(), porQue: String(n?.por_que ?? n?.porQue ?? "").trim() }))
    .filter((n) => n.nombre)
    .slice(0, 5);
}

// El análisis sin el bloque JSON final, para mostrarlo y guardarlo.
export function analysisBody(text: string): string {
  return text.replace(/```json[\s\S]*?(```|$)\s*$/, "").trim();
}

// --- Paso 2: proceso completo para el nicho elegido ---

function exampleJson(): string {
  const f = BUILTIN_FORMAT;
  return JSON.stringify(
    {
      nombre: f.nombre,
      nicho: f.nicho,
      analisis: f.analisis,
      titulo: f.titulo,
      patron_titulo: f.patronTitulo,
      duracion: f.duracion,
      segmentos: f.segmentos,
      prompt_guion: f.promptGuion,
      direccion_voz: f.direccionVoz,
      visuales: { plantilla_base: f.visuales.plantillaBase, variaciones: f.visuales.variaciones, animacion: f.visuales.animacion },
      miniatura: f.miniatura,
      checklist: f.checklist,
    },
    null,
    2
  );
}

export function buildProcessPrompt(analysis: string, niche: Niche, source?: string): string {
  return `Eres productor de un canal de YouTube. A partir del análisis de un formato que funciona, crea el PROCESO DE PRODUCCIÓN completo para aplicar ese mismo formato a un nicho nuevo.

${source ? `Canal o idea de referencia: ${source}\n` : ""}ANÁLISIS DEL FORMATO:
${analysis.trim()}

NICHO ELEGIDO: ${niche.nombre}${niche.porQue ? `\nPor qué tiene hueco: ${niche.porQue}` : ""}

Devuelve SOLO un objeto JSON (sin texto antes ni después) con los mismos campos que este ejemplo, que es el proceso ya hecho para otro nicho (arquitectura). Adapta TODO al nuevo nicho y al formato analizado; no copies el ejemplo:
- "analisis": el formato base resumido en viñetas (estructura, duración, título, ángulo emocional) + "Adaptación al nicho".
- "titulo": el título del primer video, siguiendo el patrón de título.
- "prompt_guion": prompt completo para que una IA escriba el guion. Debe usar literalmente las variables {titulo}, {tema}, {duracion}, {palabras} y {segmentos}, y describir la estructura (gancho, segmentos, micro-patrón de cada segmento, tono, cierre). No incluyas instrucciones de formato de bloques: la app las añade.
- "direccion_voz": perfil de voz, configuración (estabilidad, velocidad en %, estilo, pausas) y prompt de estilo de lectura.
- "visuales": plantillas de imagen en inglés para IA; usa {elemento} donde va lo que trata cada bloque. "variaciones" son 4 tomas distintas.
- "miniatura": plantilla de miniatura en inglés con {elemento}.
- "checklist": pasos de producción.

EJEMPLO:
${exampleJson()}`;
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

// Convierte la respuesta del modelo en un formato, completando lo que falte con el formato base.
export function parseProcess(raw: string, niche: Niche, id: string, origen?: string): ProductionFormat {
  const data = extractJson(raw);
  if (!data || typeof data !== "object") throw new Error("El modelo no devolvió el proceso en el formato esperado. Vuelve a intentarlo.");
  const base = BUILTIN_FORMAT;
  const visuals = data.visuales ?? {};
  const variations: VisualVariation[] = (Array.isArray(visuals.variaciones) ? visuals.variaciones : [])
    .map((v: any) => ({ nombre: text(v?.nombre, "Toma"), prompt: text(v?.prompt, "") }))
    .filter((v: VisualVariation) => v.prompt);
  let promptGuion = text(data.prompt_guion, base.promptGuion);
  if (!promptGuion.includes("{titulo}")) promptGuion = `${promptGuion}\n\nTítulo del video: "{titulo}"`;
  const now = new Date().toISOString();
  return {
    id,
    nombre: text(data.nombre, niche.nombre),
    nicho: text(data.nicho, niche.nombre),
    origen,
    analisis: text(data.analisis, ""),
    titulo: text(data.titulo, niche.nombre.toUpperCase()),
    patronTitulo: text(data.patron_titulo, ""),
    duracion: text(data.duracion, base.duracion),
    segmentos: text(data.segmentos, base.segmentos),
    promptGuion,
    direccionVoz: text(data.direccion_voz, base.direccionVoz),
    visuales: {
      plantillaBase: text(visuals.plantilla_base, base.visuales.plantillaBase),
      variaciones: variations.length ? variations : base.visuales.variaciones,
      animacion: text(visuals.animacion, base.visuales.animacion),
    },
    miniatura: text(data.miniatura, base.miniatura),
    checklist: Array.isArray(data.checklist) ? data.checklist.map((c: unknown) => String(c)).filter(Boolean) : base.checklist,
    createdAt: now,
    updatedAt: now,
  };
}

// Exporta el formato como documento de proceso, con la misma estructura que proceso-documental-arquitectura.md.
export function formatToMarkdown(f: ProductionFormat): string {
  const code = (s: string) => "```\n" + s.trim() + "\n```";
  const sections = [
    `# Proceso: ${f.nombre}`,
    ["## 1. Análisis del formato base", f.origen ? `Canal de referencia: ${f.origen}` : "", f.analisis].filter(Boolean).join("\n\n"),
    ["## 2. Guion", "Prompt para generar el guion completo:", code(f.promptGuion)].join("\n\n"),
    ["## 3. Narración (TTS)", code(f.direccionVoz)].join("\n\n"),
    [
      "## 4. Visuales (imagen/video IA)",
      "**Plantilla base:**",
      code(f.visuales.plantillaBase),
      `**${f.visuales.variaciones.length} variaciones por bloque:**`,
      f.visuales.variaciones.map((v, i) => `${i + 1}. ${v.nombre}:\n   \`${v.prompt}\``).join("\n"),
      "**Animación:**",
      code(f.visuales.animacion),
    ].join("\n\n"),
    ["## 5. Miniatura", code(f.miniatura), `**Título sugerido:** "${f.titulo}"`, f.patronTitulo ? `**Patrón de título:** ${f.patronTitulo}` : ""]
      .filter(Boolean)
      .join("\n\n"),
    ["## 6. Checklist de producción", f.checklist.map((c) => `- [ ] ${c}`).join("\n")].join("\n\n"),
  ];
  return sections.join("\n\n---\n\n") + "\n";
}
