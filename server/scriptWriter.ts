// Generación de guiones con modelos de texto de OpenRouter (API de chat compatible con OpenAI, en streaming).
import { OPENROUTER_BASE_URL } from "./engines/openrouter";
import { TtsError } from "./engines/types";

export interface TextModel {
  id: string;
  name: string;
  // Costo aproximado en USD de un guion de ~4.000 palabras, si OpenRouter publica precios.
  estimatedCost?: number;
  recommended?: boolean;
}

// Orden de preferencia para el modelo por defecto (se elige el primero disponible en OpenRouter).
const PREFERRED = [/^anthropic\/claude-sonnet-5/, /^anthropic\/claude-opus-5/, /^anthropic\/claude-sonnet/, /^openai\/gpt-5/, /^google\/gemini-3[.\d]*-pro/, /^google\/gemini-3/];
export const FALLBACK_TEXT_MODEL = "anthropic/claude-sonnet-5";
// Un guion de 25-30 min: ~2k tokens de prompt y ~8k de respuesta en español.
const PROMPT_TOKENS = 2000;
const OUTPUT_TOKENS = 8000;
export const MAX_OUTPUT_TOKENS = 16000;

const CACHE_MS = 60 * 60 * 1000;
let cache: { at: number; models: TextModel[] } | null = null;

export async function listTextModels(doFetch: typeof fetch = fetch, baseUrl = OPENROUTER_BASE_URL): Promise<TextModel[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.models;
  const res = await doFetch(`${baseUrl}/models`);
  if (!res.ok) throw new TtsError(`OpenRouter (${res.status}) al listar modelos`, res.status);
  const data: any = await res.json();
  const models: TextModel[] = (data?.data ?? [])
    .filter((m: any) => {
      const out: string[] = m?.architecture?.output_modalities ?? ["text"];
      const input: string[] = m?.architecture?.input_modalities ?? ["text"];
      return typeof m?.id === "string" && out.includes("text") && input.includes("text");
    })
    .map((m: any) => {
      const prompt = Number(m?.pricing?.prompt);
      const completion = Number(m?.pricing?.completion);
      const estimatedCost = Number.isFinite(prompt) && Number.isFinite(completion) ? prompt * PROMPT_TOKENS + completion * OUTPUT_TOKENS : undefined;
      return { id: m.id, name: m.name || m.id, estimatedCost };
    });

  const recommended: TextModel[] = [];
  for (const pattern of PREFERRED) {
    const match = models.find((m) => pattern.test(m.id) && !recommended.some((r) => r.id === m.id));
    if (match) recommended.push({ ...match, recommended: true });
  }
  const rest = models.filter((m) => !recommended.some((r) => r.id === m.id)).sort((a, b) => a.name.localeCompare(b.name));
  cache = { at: Date.now(), models: [...recommended, ...rest] };
  return cache.models;
}

export function defaultTextModel(models: TextModel[]): string {
  return process.env.OPENROUTER_TEXT_MODEL || models.find((m) => m.recommended)?.id || models[0]?.id || FALLBACK_TEXT_MODEL;
}

// Lee un flujo SSE de OpenRouter y entrega el texto a medida que llega.
export async function* readChatStream(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      // Las líneas que empiezan por ":" son comentarios de mantenimiento ("OPENROUTER PROCESSING").
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") return;
      let event: any;
      try {
        event = JSON.parse(payload);
      } catch {
        continue;
      }
      if (event?.error) throw new TtsError(`OpenRouter: ${event.error.message || "error durante la generación"}`, 502);
      const text = event?.choices?.[0]?.delta?.content;
      if (typeof text === "string" && text) yield text;
    }
  }
}

export interface ChatOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

// Llamada de chat en streaming. Con webSearch, OpenRouter busca en la web antes de responder (plugin "web").
export async function streamChat(
  options: ChatOptions,
  request: { model: string; prompt: string; webSearch?: boolean; maxTokens?: number; temperature?: number }
): Promise<AsyncGenerator<string>> {
  const { apiKey, baseUrl = OPENROUTER_BASE_URL, fetch: doFetch = fetch, signal } = options;
  const res = await doFetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-Title": "Audios Profesionales" },
    body: JSON.stringify({
      model: request.model,
      stream: true,
      max_tokens: request.maxTokens ?? MAX_OUTPUT_TOKENS,
      temperature: request.temperature ?? 0.8,
      messages: [{ role: "user", content: request.prompt }],
      ...(request.webSearch ? { plugins: [{ id: "web", max_results: 8 }] } : {}),
    }),
    signal,
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
  return readChatStream(res.body);
}

export function streamScript(options: ChatOptions, request: { model: string; prompt: string }): Promise<AsyncGenerator<string>> {
  return streamChat(options, request);
}
