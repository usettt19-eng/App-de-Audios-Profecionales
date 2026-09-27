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

// Instrucción breve de estilo para los modelos que la entienden (Gemini, gpt-4o-mini-tts...).
// Va al inicio del texto, como indican OpenRouter y Google para sus modelos TTS.
function stylePrefix(direction?: VoiceDirection): string {
  if (!direction) return "";
  const parts = [
    direction.tones.length ? `tono ${direction.tones.join(", ").replace("calido", "cálido").replace("energico", "enérgico")}` : "",
    ...direction.performanceNotes.map((n) => n.replace(/\.$/, "").toLowerCase()),
  ].filter(Boolean);
  return parts.length ? `Narra en español con ${parts.join("; ")}:` : "";
}

function buildInput(block: AudioBlock, model: string, direction?: VoiceDirection): string {
  if (!modelSupportsInstructions(model)) {
    // Estos modelos leerían las acotaciones en voz alta: se quitan.
    return block.lines.map((l) => l.text.replace(/\[[^\]]*\]\s*/g, "")).join("\n");
  }
  const body = block.lines.map((l) => (l.direction ? `[${l.direction}] ${l.text}` : l.text)).join("\n");
  const prefix = stylePrefix(direction);
  return prefix ? `${prefix}\n${body}` : body;
}

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
      let speed = direction?.speedPercent && direction.speedPercent !== 100 ? Math.min(2, Math.max(0.5, direction.speedPercent / 100)) : undefined;

      return withRetries(async () => {
        const body: Record<string, unknown> = { model, input: buildInput(block, model, direction), response_format: "pcm" };
        if (voice) body.voice = voice;
        if (speed) body.speed = speed;

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
          // No todos los modelos aceptan "speed": se reintenta sin él y la velocidad queda como instrucción de estilo.
          if (res.status === 400 && speed && /speed/i.test(error.message)) {
            speed = undefined;
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
