// Catálogo de motores y modelos de voz, compartido entre cliente y servidor.
// Los modelos de OpenRouter se identifican como "proveedor/modelo"; los de Gemini directo no llevan "/".

export interface VoiceOption {
  name: string;
  tone?: string;
}

export interface TtsModelInfo {
  id: string;
  label: string;
  engine: TtsEngineId;
  voices: VoiceOption[];
  // Entiende indicaciones de tono en texto y etiquetas como [susurrando].
  supportsInstructions: boolean;
}

export type TtsEngineId = "openrouter" | "gemini";

export const GEMINI_VOICES: VoiceOption[] = [
  { name: "Kore", tone: "Firme" },
  { name: "Charon", tone: "Informativa" },
  { name: "Puck", tone: "Animada" },
  { name: "Zephyr", tone: "Brillante" },
  { name: "Aoede", tone: "Fresca" },
  { name: "Fenrir", tone: "Enérgica" },
  { name: "Leda", tone: "Juvenil" },
  { name: "Orus", tone: "Firme" },
  { name: "Callirrhoe", tone: "Relajada" },
  { name: "Autonoe", tone: "Brillante" },
  { name: "Enceladus", tone: "Susurrante" },
  { name: "Iapetus", tone: "Clara" },
  { name: "Umbriel", tone: "Relajada" },
  { name: "Algieba", tone: "Suave" },
  { name: "Despina", tone: "Suave" },
  { name: "Erinome", tone: "Clara" },
  { name: "Algenib", tone: "Grave" },
  { name: "Rasalgethi", tone: "Informativa" },
  { name: "Laomedeia", tone: "Animada" },
  { name: "Achernar", tone: "Suave" },
  { name: "Alnilam", tone: "Firme" },
  { name: "Schedar", tone: "Equilibrada" },
  { name: "Gacrux", tone: "Madura" },
  { name: "Pulcherrima", tone: "Directa" },
  { name: "Achird", tone: "Amigable" },
  { name: "Zubenelgenubi", tone: "Casual" },
  { name: "Vindemiatrix", tone: "Gentil" },
  { name: "Sadachbia", tone: "Vivaz" },
  { name: "Sadaltager", tone: "Experta" },
  { name: "Sulafat", tone: "Cálida" },
];

export const DEFAULT_OPENROUTER_MODEL = "google/gemini-3.8-flash-tts";
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-preview-tts";

// Modelos conocidos: se usan si no se puede consultar la lista en vivo de OpenRouter.
export const KNOWN_MODELS: TtsModelInfo[] = [
  { id: "google/gemini-3.8-flash-tts", label: "Gemini 3.8 Flash TTS (OpenRouter)", engine: "openrouter", voices: GEMINI_VOICES, supportsInstructions: true },
  { id: "google/gemini-3.8-flash-lite-tts", label: "Gemini 3.8 Flash Lite TTS (OpenRouter)", engine: "openrouter", voices: GEMINI_VOICES, supportsInstructions: true },
  { id: "google/gemini-3.1-flash-tts-preview", label: "Gemini 3.1 Flash TTS Preview (OpenRouter)", engine: "openrouter", voices: GEMINI_VOICES, supportsInstructions: true },
  { id: "gemini-2.5-flash-preview-tts", label: "Gemini 2.5 Flash TTS (Google directo)", engine: "gemini", voices: GEMINI_VOICES, supportsInstructions: true },
  { id: "gemini-2.5-pro-preview-tts", label: "Gemini 2.5 Pro TTS (Google directo)", engine: "gemini", voices: GEMINI_VOICES, supportsInstructions: true },
];

export function engineForModel(modelId: string): TtsEngineId {
  return modelId.includes("/") ? "openrouter" : "gemini";
}

// Las familias Gemini y OpenAI gpt-4o-mini-tts interpretan instrucciones de estilo; el resto solo lee el texto.
export function modelSupportsInstructions(modelId: string): boolean {
  return /gemini|gpt-4o-mini-tts|mai-voice/i.test(modelId);
}

export function modelUsesGeminiVoices(modelId: string): boolean {
  return /gemini/i.test(modelId);
}
