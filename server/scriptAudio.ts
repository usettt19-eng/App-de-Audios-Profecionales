import type { GoogleGenAI } from "@google/genai";
import { AudioBlock, buildRenderPlan, listSpeakers, parseScript } from "../src/lib/scriptParser";
import { parseVoiceDirection, VoiceDirection } from "../src/lib/voiceDirection";

// Gemini TTS devuelve PCM lineal de 16 bits, mono, a 24 kHz.
const SAMPLE_RATE = 24000;
const BYTES_PER_SAMPLE = 2;
const CHANNELS = 1;
const MAX_CONCURRENT_REQUESTS = 3;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = Number(process.env.TTS_RETRY_BASE_MS ?? 2000);

export const MAX_SCRIPT_CHARS = 20000;
const FALLBACK_TTS_MODEL = "gemini-2.5-flash-preview-tts";

export interface ScriptAudioRequest {
  script: string;
  voices: Record<string, string>;
  // Prompt de dirección de voz (perfil, velocidad, estabilidad, reglas de pausas...).
  direction?: string;
  model?: string;
}

function silence(ms: number): Buffer {
  const samples = Math.round((SAMPLE_RATE * ms) / 1000);
  return Buffer.alloc(samples * BYTES_PER_SAMPLE * CHANNELS);
}

export function pcmToWav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(CHANNELS * BYTES_PER_SAMPLE, 32);
  header.writeUInt16LE(BYTES_PER_SAMPLE * 8, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// Los nombres de personaje deben coincidir exactamente entre el prompt y la configuración de voces.
function speakerAlias(name: string): string {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "") || "VOZ";
}

function buildPrompt(block: AudioBlock, direction?: VoiceDirection): string {
  const directions = block.lines
    .filter((l) => l.direction)
    .map((l) => `- ${speakerAlias(l.speaker)} en "${l.text.slice(0, 60)}": ${l.direction}`);

  const header = [
    "Interpreta el siguiente guion como una locución profesional en español, con dicción clara y ritmo natural.",
    "Las indicaciones entre corchetes son acotaciones de interpretación: no las leas en voz alta.",
    direction?.performanceNotes.length ? `Interpretación:\n${direction.performanceNotes.map((n) => `- ${n}`).join("\n")}` : "",
    direction?.raw.trim()
      ? `Notas del director (tradúcelas a interpretación; los parámetros técnicos de otras plataformas y las reglas de pausas ya están aplicados al audio):\n${direction.raw.trim()}`
      : "",
    directions.length ? `Indicaciones por línea:\n${directions.join("\n")}` : "",
  ].filter(Boolean);

  const body =
    block.speakers.length === 1
      ? block.lines.map((l) => l.text).join("\n")
      : block.lines.map((l) => `${speakerAlias(l.speaker)}: ${l.text}`).join("\n");

  return `${header.join("\n")}\n\n${body}`;
}

async function renderBlock(client: GoogleGenAI, model: string, block: AudioBlock, voices: Record<string, string>, direction?: VoiceDirection): Promise<Buffer> {
  const fallbackVoice = direction?.suggestedVoice || "Kore";
  const voiceFor = (speaker: string) => ({ prebuiltVoiceConfig: { voiceName: voices[speaker] || fallbackVoice } });

  const speechConfig =
    block.speakers.length === 1
      ? { voiceConfig: voiceFor(block.speakers[0]) }
      : {
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: block.speakers.map((speaker) => ({
              speaker: speakerAlias(speaker),
              voiceConfig: voiceFor(speaker),
            })),
          },
        };

  // Los proyectos largos lanzan muchas solicitudes: se reintentan los límites de cuota y errores transitorios.
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await client.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: buildPrompt(block, direction) }] }],
        config: { responseModalities: ["AUDIO"], speechConfig },
      });
      const data = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
      if (!data) throw new Error("El modelo no devolvió audio para uno de los bloques del guion.");
      return Buffer.from(data, "base64");
    } catch (error: any) {
      const status = Number(error?.status ?? error?.code);
      const retryable = !status || status === 429 || status >= 500;
      if (attempt >= MAX_ATTEMPTS || !retryable) throw error;
      await new Promise((r) => setTimeout(r, RETRY_BASE_MS * 2 ** (attempt - 1)));
    }
  }
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

export async function generateScriptAudio(client: GoogleGenAI, req: ScriptAudioRequest): Promise<{ wav: Buffer; blocks: number; speakers: string[] }> {
  const direction = req.direction?.trim() ? parseVoiceDirection(req.direction) : undefined;
  const segments = parseScript(req.script, {
    defaultPauseMs: direction?.defaultPauseMs,
    pauseAfterNumbersMs: direction?.pauseAfterNumbersMs,
  });
  const speakers = listSpeakers(segments);
  if (!speakers.length) throw new Error("El guion no contiene líneas de diálogo.");

  const plan = buildRenderPlan(segments);
  // Se lee en cada solicitud para respetar variables cargadas por dotenv después de importar este módulo.
  const model = req.model || process.env.GEMINI_TTS_MODEL || FALLBACK_TTS_MODEL;
  const blockSteps = plan.filter((s) => s.type === "block");
  const audio = await mapWithConcurrency(blockSteps, MAX_CONCURRENT_REQUESTS, (step) =>
    renderBlock(client, model, step.block, req.voices, direction)
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
  return { wav: pcmToWav(Buffer.concat(chunks)), blocks: blockSteps.length, speakers };
}
