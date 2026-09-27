// Plantillas del proceso de producción documental: prompt del guion y dirección de voz.
// El prompt del guion es editable en la app; las reglas de formato de salida son fijas porque la app
// las necesita para dividir el guion en bloques (ver technicalScript.ts).

export interface ScriptVariables {
  titulo: string;
  tema?: string;
  // Rango de minutos, p. ej. "25-30".
  duracion: string;
  // Número de segmentos, p. ej. "12 a 15".
  segmentos: string;
}

export const WORDS_PER_MINUTE = 150;

export const DEFAULT_SCRIPT_PROMPT = `Actúa como guionista de documentales de YouTube en español, estilo "compilación superlativa"
(formato: LOS PUEBLOS MÁS IMPOSIBLES DEL MUNDO, MUNDO MARAVILLOSO 100 LUGARES).

Escribe el guion completo para un documental narrado titulado:
"{titulo}"
{tema}
Reglas de formato:
- Duración objetivo: {duracion} minutos de narración (aprox. {palabras} palabras).
- Estructura: gancho inicial de 15-20 segundos (pregunta o afirmación de asombro,
  sin presentarte, va directo al misterio) → {segmentos} estructuras/construcciones,
  ordenadas de menor a mayor impacto, cerrando con la más asombrosa.
- Cada estructura: 200-280 palabras. Sigue este micro-patrón en cada una:
  1) Frase de apertura con dato de escala o imposibilidad ("A 400 metros de altura, sin
     ninguna columna de soporte visible...")
  2) Contexto: quién la construyó, cuándo, por qué era considerada imposible
  3) El "cómo lo lograron" - el dato técnico o de ingeniería que sorprende
  4) Cierre con gancho hacia la siguiente ("Pero lo que construyeron después la haría
     parecer sencilla...")
- Tono: asombro documental, frases cortas, ritmo pausado, cero humor, cero muletillas
  tipo "amigos" o "suscríbete" en medio del guion.
- Al final: cierre de 2-3 frases que invite a suscribirse, sin ser agresivo.
- NO uses subtítulos de sección visibles ("Estructura 1:") - todo debe fluir como
  narración continua.`;

// Se añade siempre al final del prompt: es el formato que la app sabe dividir en audios.
export const OUTPUT_FORMAT_RULES = `FORMATO DE SALIDA (obligatorio: el texto lo procesa una aplicación que genera un audio por bloque):
- Devuelve SOLO el guion, sin introducción, notas ni comentarios antes o después.
- Empieza cada bloque con una línea propia con este formato exacto: [BLOQUE N — NOMBRE]
  · El bloque 1 es el gancho: [BLOQUE 1 — GANCHO]
  · Cada estructura va en su propio bloque y NOMBRE es el nombre de esa estructura (p. ej. [BLOQUE 2 — VIADUCTO DE MILLAU]).
  · El último bloque es el cierre: [BLOQUE N — CIERRE]
- Dentro de cada bloque puedes añadir indicaciones de producción, cada una en su propia línea y entre paréntesis:
  (MÚSICA: ambiente musical sugerido, al inicio del bloque)
  (SFX: efecto de sonido puntual)
  (Tono: tono de narración para los párrafos siguientes)
  (Pausa de N segundos)
- Todo lo demás es narración pura, en párrafos: sin markdown, sin asteriscos, sin viñetas y sin títulos.`;

// Dirección de voz del proceso documental (configuración de voz + prompt de estilo).
export const DOCUMENTARY_VOICE_DIRECTION = `Voz: masculina o femenina, adulta, 35-50 años, tono grave/cálido de documental (referencia: narrador de National Geographic en español latino, NO tono infantil ni comercial/entusiasta).

Configuración:
- Estabilidad: alta (0.65-0.75)
- Velocidad: 90-95% de la velocidad normal
- Estilo/exageración: baja
- Pausas: añade [pausa] de 0.5s después de cada dato numérico o afirmación de escala

Estilo: Lee este texto como si fueras el narrador de un documental de misterio e ingeniería. Baja el tono en los datos técnicos, sube muy levemente la intensidad en las frases de cierre de cada segmento (los ganchos hacia la siguiente construcción).`;

// "25-30" -> "3,800-4,500"; "20" -> "3,000". Redondeado a centenas.
export function wordsForDuration(duracion: string): string {
  const numbers = duracion.match(/\d+(?:[.,]\d+)?/g)?.map((n) => parseFloat(n.replace(",", "."))) ?? [];
  if (!numbers.length) return "";
  const words = numbers.slice(0, 2).map((m) => (Math.round((m * WORDS_PER_MINUTE) / 100) * 100).toLocaleString("en-US"));
  return words.join("-");
}

export function buildScriptPrompt(template: string, vars: ScriptVariables): string {
  const tema = vars.tema?.trim() ? `\nIndicaciones adicionales: ${vars.tema.trim()}\n` : "";
  const filled = template
    .replaceAll("{titulo}", vars.titulo.trim())
    .replaceAll("{tema}", tema)
    .replaceAll("{duracion}", vars.duracion.trim())
    .replaceAll("{palabras}", wordsForDuration(vars.duracion))
    .replaceAll("{segmentos}", vars.segmentos.trim());
  return `${filled.trim()}\n\n${OUTPUT_FORMAT_RULES}`;
}
