import { buildRenderPlan, listSpeakers, parseScript } from "../src/lib/scriptParser";
import { DEFAULT_GEMINI_MODEL, DEFAULT_OPENROUTER_MODEL, engineForModel, TtsEngineId } from "../src/lib/ttsModels";
import { parseVoiceDirection } from "../src/lib/voiceDirection";
import { pcmToWav, silence } from "./audio";
import type { TtsEngine } from "./engines/types";

export { pcmToWav } from "./audio";

const MAX_CONCURRENT_REQUESTS = 3;
export const MAX_SCRIPT_CHARS = 20000;

export interface ScriptAudioRequest {
  script: string;
  voices: Record<string, string>;
  // Prompt de dirección de voz (perfil, velocidad, estabilidad, reglas de pausas...).
  direction?: string;
  model?: string;
}

export type EngineRegistry = Partial<Record<TtsEngineId, TtsEngine>>;

// Modelo por defecto: OpenRouter si hay clave; si no, Gemini directo.
// Se lee en cada solicitud para respetar variables cargadas por dotenv después de importar este módulo.
export function defaultModel(): string {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_TTS_MODEL || DEFAULT_OPENROUTER_MODEL;
  return process.env.GEMINI_TTS_MODEL || DEFAULT_GEMINI_MODEL;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function generateScriptAudio(
  engines: EngineRegistry,
  req: ScriptAudioRequest
): Promise<{ wav: Buffer; blocks: number; speakers: string[]; model: string }> {
  const direction = req.direction?.trim() ? parseVoiceDirection(req.direction) : undefined;
  const segments = parseScript(req.script, {
    defaultPauseMs: direction?.defaultPauseMs,
    pauseAfterNumbersMs: direction?.pauseAfterNumbersMs,
  });
  const speakers = listSpeakers(segments);
  if (!speakers.length) throw new Error("El guion no contiene líneas de diálogo.");

  const model = req.model?.trim() || defaultModel();
  const engineId = engineForModel(model);
  const engine = engines[engineId];
  if (!engine) throw new Error(`El motor ${engineId === "openrouter" ? "OpenRouter" : "Gemini"} no está configurado.`);

  const plan = buildRenderPlan(segments, { maxSpeakersPerBlock: engine.maxSpeakersPerBlock, maxBlockChars: engine.maxBlockChars });
  const blockSteps = plan.filter((s) => s.type === "block");
  const audio = await mapWithConcurrency(blockSteps, MAX_CONCURRENT_REQUESTS, (step) =>
    engine.render(step.block, { model, voices: req.voices, direction })
  );

  const chunks: Buffer[] = [];
  let blockIndex = 0;
  plan.forEach((step, i) => {
    if (step.type === "pause") {
      chunks.push(silence(step.ms));
    } else {
      chunks.push(audio[blockIndex++]);
      // Respiro breve entre bloques contiguos; si sigue una pausa escrita, se respeta su duración exacta.
      if (plan[i + 1]?.type === "block") chunks.push(silence(250));
    }
  });
  return { wav: pcmToWav(Buffer.concat(chunks)), blocks: blockSteps.length, speakers, model };
}
