// Lista de modelos de voz disponibles: los conocidos más los que publica OpenRouter en su API de modelos
// (que incluye las voces de cada uno). Se cachea una hora; si OpenRouter no responde, se usan los conocidos.
import { engineForModel, KNOWN_MODELS, modelSupportsInstructions, TtsModelInfo, VoiceOption } from "../src/lib/ttsModels";
import { OPENROUTER_BASE_URL } from "./engines/openrouter";

const CACHE_MS = 60 * 60 * 1000;
let cache: { at: number; models: TtsModelInfo[] } | null = null;

function toVoices(raw: unknown): VoiceOption[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v: any) => {
      if (typeof v === "string") return { name: v };
      const name = v?.id ?? v?.voice_id ?? v?.name;
      if (typeof name !== "string") return null;
      const tone = [v?.gender, v?.language ?? v?.locale, v?.description].filter((x) => typeof x === "string").join(" · ");
      return { name, tone: tone || undefined };
    })
    .filter((v): v is VoiceOption => v !== null);
}

function looksLikeSpeechModel(m: any): boolean {
  const outputs: string[] = m?.architecture?.output_modalities ?? [];
  return outputs.includes("speech") || /(^|[-/])(tts|kokoro|aura|voxtral|voice|speech)|fish-audio/i.test(m?.id ?? "");
}

export async function fetchOpenRouterModels(doFetch: typeof fetch = fetch, baseUrl = OPENROUTER_BASE_URL): Promise<TtsModelInfo[]> {
  const found = new Map<string, TtsModelInfo>();
  // La API filtra por modalidad de salida; se prueban los filtros posibles y la lista completa.
  for (const query of ["?output_modalities=speech", "?output_modalities=audio", ""]) {
    try {
      const res = await doFetch(`${baseUrl}/models${query}`);
      if (!res.ok) continue;
      const data: any = await res.json();
      for (const m of data?.data ?? []) {
        if (!m?.id || found.has(m.id) || !looksLikeSpeechModel(m)) continue;
        const voices = toVoices(m.voices ?? m.supported_voices ?? m.architecture?.voices ?? m.speech?.voices);
        found.set(m.id, { id: m.id, label: m.name || m.id, engine: "openrouter", voices, supportsInstructions: modelSupportsInstructions(m.id) });
      }
    } catch {
      // Sin conexión con OpenRouter: se sigue con el siguiente intento o con los modelos conocidos.
    }
  }
  return [...found.values()];
}

export async function availableModels(doFetch?: typeof fetch): Promise<TtsModelInfo[]> {
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    const live = await fetchOpenRouterModels(doFetch, process.env.OPENROUTER_BASE_URL || OPENROUTER_BASE_URL);
    cache = { at: Date.now(), models: live };
  }
  const merged = new Map<string, TtsModelInfo>();
  for (const known of KNOWN_MODELS) merged.set(known.id, known);
  for (const live of cache.models) {
    const known = merged.get(live.id);
    // Si la API no trae voces para un modelo conocido, se conservan las del catálogo.
    merged.set(live.id, known && !live.voices.length ? { ...live, voices: known.voices, label: known.label } : live);
  }
  const configured = { openrouter: !!process.env.OPENROUTER_API_KEY, gemini: !!process.env.GEMINI_API_KEY };
  return [...merged.values()].filter((m) => configured[engineForModel(m.id)]);
}
