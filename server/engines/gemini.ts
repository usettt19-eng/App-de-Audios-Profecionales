import type { GoogleGenAI } from "@google/genai";
import type { AudioBlock } from "../../src/lib/scriptParser";
import type { VoiceDirection } from "../../src/lib/voiceDirection";
import { RenderContext, TtsEngine, TtsError, withRetries } from "./types";

// Los nombres de personaje deben coincidir exactamente entre el prompt y la configuración de voces.
function speakerAlias(name: string): string {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "") || "VOZ";
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

// Gemini directo: admite 2 voces por solicitud y devuelve PCM 16 bits mono a 24 kHz.
export function geminiEngine(getClient: () => GoogleGenAI): TtsEngine {
  return {
    maxSpeakersPerBlock: 2,
    maxBlockChars: 2500,
    async render(block: AudioBlock, { model, voices, direction }: RenderContext) {
      const client = getClient();
      const fallbackVoice = direction?.suggestedVoice || "Kore";
      const voiceFor = (speaker: string) => ({ prebuiltVoiceConfig: { voiceName: voices[speaker] || fallbackVoice } });
      const speechConfig =
        block.speakers.length === 1
          ? { voiceConfig: voiceFor(block.speakers[0]) }
          : {
              multiSpeakerVoiceConfig: {
                speakerVoiceConfigs: block.speakers.map((speaker) => ({ speaker: speakerAlias(speaker), voiceConfig: voiceFor(speaker) })),
              },
            };

      return withRetries(async () => {
        const response = await client.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ text: buildPrompt(block, direction) }] }],
          config: { responseModalities: ["AUDIO"], speechConfig },
        });
        const data = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
        if (!data) throw new TtsError("El modelo no devolvió audio para uno de los bloques del guion.");
        return Buffer.from(data, "base64");
      });
    },
  };
}
