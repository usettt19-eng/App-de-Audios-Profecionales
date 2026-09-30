// Música de fondo con modelos de música de OpenRouter (Google Lyria 3). Se piden por la API de chat con
// salida de audio (modalities ["text", "audio"]) en streaming; el audio llega en fragmentos base64.
import { OPENROUTER_BASE_URL } from "./engines/openrouter";
import { TtsError, withRetries } from "./engines/types";

export const DEFAULT_MUSIC_MODEL = "google/lyria-3-pro-preview";

export interface GeneratedMusic {
  data: Buffer;
  ext: "wav" | "mp3" | "ogg" | "flac";
}

// Instrucciones fijas: música instrumental de fondo que no compita con la narración.
export function musicPrompt(mood: string, videoTitle: string): string {
  return [
    `Instrumental background score for a documentary narration titled "${videoTitle}".`,
    `Mood and instrumentation: ${mood.trim() || "cinematic, atmospheric, understated"}.`,
    "No vocals, no lyrics, no spoken words. Steady and unobtrusive, suitable to play softly under a narrator; avoid sudden loud hits.",
  ].join(" ");
}

function detectExt(data: Buffer): GeneratedMusic["ext"] | null {
  const head = data.toString("ascii", 0, 4);
  if (head === "RIFF") return "wav";
  if (head === "OggS") return "ogg";
  if (head === "fLaC") return "flac";
  if (head.startsWith("ID3") || (data[0] === 0xff && (data[1] & 0xe0) === 0xe0)) return "mp3";
  return null;
}

// PCM sin cabecera: Lyria genera estéreo a 48 kHz, 16 bits.
function pcmToWav48kStereo(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(48000, 24);
  header.writeUInt32LE(48000 * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// Junta los fragmentos de audio de un flujo SSE de chat (delta.audio.data o message.audio.data).
export async function collectAudioStream(body: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const chunks: Buffer[] = [];
  let buffer = "";
  const handle = (line: string) => {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    let event: any;
    try {
      event = JSON.parse(payload);
    } catch {
      return;
    }
    if (event?.error) throw new TtsError(`OpenRouter: ${event.error.message || "error al generar la música"}`, 502);
    const choice = event?.choices?.[0];
    const data = choice?.delta?.audio?.data ?? choice?.message?.audio?.data;
    if (typeof data === "string" && data) chunks.push(Buffer.from(data, "base64"));
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      handle(buffer.slice(0, newline).trim());
      buffer = buffer.slice(newline + 1);
    }
  }
  handle(buffer.trim());
  return Buffer.concat(chunks);
}

export async function generateMusic(
  options: { apiKey: string; baseUrl?: string; fetch?: typeof fetch },
  request: { model: string; prompt: string }
): Promise<GeneratedMusic> {
  const { apiKey, baseUrl = OPENROUTER_BASE_URL, fetch: doFetch = fetch } = options;
  return withRetries(async () => {
    const res = await doFetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-Title": "Audios Profesionales" },
      body: JSON.stringify({ model: request.model, messages: [{ role: "user", content: request.prompt }], modalities: ["text", "audio"], stream: true }),
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      let message = text.slice(0, 300);
      try {
        message = JSON.parse(text)?.error?.message || message;
      } catch {
        // Respuesta no JSON.
      }
      throw new TtsError(`OpenRouter (${res.status}): ${message || res.statusText}`, res.status);
    }
    const audio = await collectAudioStream(res.body);
    if (!audio.length) throw new TtsError("El modelo de música no devolvió audio.", 502);
    const ext = detectExt(audio);
    return ext ? { data: audio, ext } : { data: pcmToWav48kStereo(audio), ext: "wav" };
  });
}
