// Generación de imágenes con la API unificada de imágenes de OpenRouter (POST /api/v1/images).
import { OPENROUTER_BASE_URL } from "./engines/openrouter";
import { TtsError, withRetries } from "./engines/types";

export interface ImageModel {
  id: string;
  name: string;
  recommended?: boolean;
}

export interface GeneratedImage {
  data: Buffer;
  ext: "png" | "jpg" | "webp";
}

// Preferencia para el modelo por defecto: fotorrealismo arquitectónico primero.
const PREFERRED = [/^bytedance-seed\/seedream/, /^google\/gemini-3[.\d-]*(pro-)?(flash-)?image/, /^black-forest-labs\/flux/, /^openai\/gpt-.*image/];
export const FALLBACK_IMAGE_MODEL = "bytedance-seed/seedream-4.5";

const CACHE_MS = 60 * 60 * 1000;
let cache: { at: number; models: ImageModel[] } | null = null;

export async function listImageModels(doFetch: typeof fetch = fetch, baseUrl = OPENROUTER_BASE_URL): Promise<ImageModel[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.models;
  const res = await doFetch(`${baseUrl}/models?output_modalities=image`);
  if (!res.ok) throw new TtsError(`OpenRouter (${res.status}) al listar modelos de imagen`, res.status);
  const data: any = await res.json();
  const models: ImageModel[] = (data?.data ?? [])
    .filter((m: any) => typeof m?.id === "string" && (m?.architecture?.output_modalities ?? []).includes("image"))
    .map((m: any) => ({ id: m.id, name: m.name || m.id }));
  const recommended: ImageModel[] = [];
  for (const pattern of PREFERRED) {
    const match = models.find((m) => pattern.test(m.id) && !recommended.some((r) => r.id === m.id));
    if (match) recommended.push({ ...match, recommended: true });
  }
  const rest = models.filter((m) => !recommended.some((r) => r.id === m.id)).sort((a, b) => a.name.localeCompare(b.name));
  cache = { at: Date.now(), models: [...recommended, ...rest] };
  return cache.models;
}

export function defaultImageModel(models: ImageModel[]): string {
  return process.env.OPENROUTER_IMAGE_MODEL || models.find((m) => m.recommended)?.id || models[0]?.id || FALLBACK_IMAGE_MODEL;
}

function detectExt(data: Buffer): GeneratedImage["ext"] {
  if (data[0] === 0xff && data[1] === 0xd8) return "jpg";
  if (data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") return "webp";
  return "png";
}

export async function generateImage(
  options: { apiKey: string; baseUrl?: string; fetch?: typeof fetch },
  request: { model: string; prompt: string; aspectRatio?: string; resolution?: string }
): Promise<GeneratedImage> {
  const { apiKey, baseUrl = OPENROUTER_BASE_URL, fetch: doFetch = fetch } = options;
  return withRetries(async () => {
    const res = await doFetch(`${baseUrl}/images`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-Title": "Audios Profesionales" },
      body: JSON.stringify({
        model: request.model,
        prompt: request.prompt,
        aspect_ratio: request.aspectRatio ?? "16:9",
        ...(request.resolution ? { resolution: request.resolution } : {}),
      }),
    });
    const text = await res.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      // Respuesta no JSON.
    }
    if (!res.ok) throw new TtsError(`OpenRouter (${res.status}): ${data?.error?.message || text.slice(0, 200) || res.statusText}`, res.status);

    const item = data?.data?.[0];
    if (item?.b64_json) {
      const buf = Buffer.from(item.b64_json, "base64");
      return { data: buf, ext: detectExt(buf) };
    }
    // Algunos proveedores devuelven un enlace (o un data: URL) en lugar de base64.
    const url: string | undefined = item?.url;
    if (url?.startsWith("data:")) {
      const buf = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
      return { data: buf, ext: detectExt(buf) };
    }
    if (url) {
      const img = await doFetch(url);
      if (!img.ok) throw new TtsError(`No se pudo descargar la imagen generada (${img.status}).`, img.status);
      const buf = Buffer.from(await img.arrayBuffer());
      return { data: buf, ext: detectExt(buf) };
    }
    throw new TtsError("OpenRouter no devolvió ninguna imagen.", 502);
  });
}
