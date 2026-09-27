import type { AudioBlock } from "../../src/lib/scriptParser";
import type { VoiceDirection } from "../../src/lib/voiceDirection";

export interface RenderContext {
  model: string;
  voices: Record<string, string>;
  direction?: VoiceDirection;
}

export interface TtsEngine {
  maxSpeakersPerBlock: number;
  maxBlockChars: number;
  // Devuelve PCM 16 bits mono a 24 kHz.
  render(block: AudioBlock, ctx: RenderContext): Promise<Buffer>;
}

export class TtsError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

const MAX_ATTEMPTS = 3;

// Los proyectos largos lanzan muchas solicitudes: se reintentan los límites de cuota y errores transitorios.
export async function withRetries<T>(fn: () => Promise<T>): Promise<T> {
  const baseMs = Number(process.env.TTS_RETRY_BASE_MS ?? 2000);
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const status = Number(error?.status ?? error?.code);
      const retryable = !status || status === 429 || status >= 500;
      if (attempt >= MAX_ATTEMPTS || !retryable) throw error;
      await new Promise((r) => setTimeout(r, baseMs * 2 ** (attempt - 1)));
    }
  }
}
