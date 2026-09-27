import type { AudioBlock } from "../../src/lib/scriptParser";
import type { VoiceDirection } from "../../src/lib/voiceDirection";
import { modelSupportsInstructions, modelUsesGeminiVoices } from "../../src/lib/ttsModels";
import { isMp3, isWav, rawPcmToPcm, SAMPLE_RATE, wavToPcm } from "../audio";
import { RenderContext, TtsEngine, TtsError, withRetries } from "./types";

export interface OpenRouterOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
// OpenRouter acepta hasta 4096 caracteres por solicitud; se deja margen para las instrucciones de estilo.
const MAX_INPUT_CHARS = 3000;

// El endpoint de voz de OpenRouter locuta TODO lo que recibe en "input": ahí solo va el texto a leer,
// sin acotaciones. La dirección de voz viaja aparte, en el campo "instructions" (API compatible con OpenAI).
function buildInput(block: AudioBlock): string {
  return block.lines
    .map((l) => l.text.replace(/\[[^\]]*\]\s*/g, "").replace(/\s{2,}/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

const TONE_LABELS: Record<string, string> = { calido: "cálido", energico: "enérgico" };

function buildInstructions(block: AudioBlock, direction?: VoiceDirection): string {
  const parts: string[] = ["Locución profesional en español, dicción clara."];
  if (direction?.tones.length) parts.push(`Tono general: ${direction.tones.map((t) => TONE_LABELS[t] || t).join(", ")}.`);
  for (const note of direction?.performanceNotes ?? []) parts.push(note);
  // Tonos por párrafo del guion (p. ej. "Intrigante, pausado" y luego "Épico, reflexivo"), en orden y sin repetir.
  const lineTones = [...new Set(block.lines.map((l) => l.direction).filter((d): d is string => !!d))];
  if (lineTones.length === 1) parts.push(`Interpretación: ${lineTones[0]}.`);
  if (lineTones.length > 1) parts.push(`Interpretación, en este orden a lo largo del texto: ${lineTones.join(" → ")}.`);
  return parts.join(" ").slice(0, 1000);
}

// Parámetros opcionales que cada modelo ha rechazado: no se vuelven a enviar mientras el servidor siga en marcha.
const rejectedParams = new Map<string, Set<string>>();
const OPTIONAL_PARAMS = ["instructions", "speed"] as const;

async function errorFrom(res: Response): Promise<TtsError> {
  const text = await res.text().catch(() => "");
  let message = text.slice(0, 300);
  try {
    const data = JSON.parse(text);
    message = data?.error?.message || data?.message || message;
    // Los errores de validación llegan como una lista JSON de problemas: se muestran solo sus mensajes.
    const issues = JSON.parse(message);
    if (Array.isArray(issues)) message = issues.map((i: any) => [i?.path?.join?.("."), i?.message].filter(Boolean).join(": ")).join("; ");
  } catch {
    // Respuesta no JSON: se usa el texto tal cual.
  }
  return new TtsError(`OpenRouter (${res.status}): ${message || res.statusText}`, res.status);
}

// OpenRouter: una voz por solicitud (sin modo multivoz), respuesta de audio binaria.
export function openRouterEngine(options: () => OpenRouterOptions): TtsEngine {
  return {
    maxSpeakersPerBlock: 1,
    maxBlockChars: MAX_INPUT_CHARS,
    async render(block: AudioBlock, { model, voices, direction }: RenderContext) {
      const { apiKey, baseUrl = OPENROUTER_BASE_URL, fetch: doFetch = fetch } = options();
      const speaker = block.speakers[0];
      const voice = voices[speaker] || (modelUsesGeminiVoices(model) ? direction?.suggestedVoice || "Kore" : undefined);
      const speed = direction?.speedPercent && direction.speedPercent !== 100 ? Math.min(2, Math.max(0.5, direction.speedPercent / 100)) : undefined;
      const instructions = modelSupportsInstructions(model) ? buildInstructions(block, direction) : undefined;
      const rejected = rejectedParams.get(model) ?? new Set<string>();
      rejectedParams.set(model, rejected);

      return withRetries(async () => {
        const body: Record<string, unknown> = { model, input: buildInput(block), response_format: "pcm" };
        if (voice) body.voice = voice;
        if (speed && !rejected.has("speed")) body.speed = speed;
        if (instructions && !rejected.has("instructions")) body.instructions = instructions;

        const res = await doFetch(`${baseUrl}/audio/speech`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "X-Title": "Audios Profesionales",
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const error = await errorFrom(res);
          // Si el modelo no acepta un parámetro opcional, se recuerda y se reintenta sin él.
          const param = OPTIONAL_PARAMS.find((p) => p in body && new RegExp(p, "i").test(error.message));
          if (res.status === 400 && param) {
            rejected.add(param);
            throw new TtsError(error.message, 503);
          }
          throw error;
        }

        const audio = Buffer.from(await res.arrayBuffer());
        if (isWav(audio)) return wavToPcm(audio);
        if (isMp3(audio)) throw new TtsError(`El modelo ${model} solo entrega MP3; elige otro modelo.`, 400);
        const type = res.headers.get("content-type") || "";
        if (/json|text/.test(type)) throw new TtsError("OpenRouter no devolvió audio.", 502);
        // PCM sin cabecera (16 bits). La frecuencia y los canales vienen en el content-type
        // (p. ej. "audio/pcm;rate=24000"); si no, se asume 24 kHz mono, lo habitual en OpenRouter.
        const rate = Number(type.match(/rate=(\d+)/i)?.[1]) || SAMPLE_RATE;
        const channels = Number(type.match(/channels=(\d+)/i)?.[1]) || 1;
        return rawPcmToPcm(audio, rate, channels);
      });
    },
  };
}
