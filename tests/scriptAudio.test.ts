import { test } from "node:test";
import assert from "node:assert/strict";
import { generateScriptAudio } from "../server/scriptAudio";

function mockClient(calls: any[]) {
  return {
    models: {
      generateContent: async (req: any) => {
        calls.push(req);
        const oneSecond = Buffer.alloc(24000 * 2).toString("base64");
        return { candidates: [{ content: { parts: [{ inlineData: { data: oneSecond } }] } }] };
      },
    },
  } as any;
}

test("genera un WAV y asigna voces por personaje", async () => {
  const calls: any[] = [];
  const { wav, blocks, speakers } = await generateScriptAudio(mockClient(calls), {
    script: "LOCUTOR: Hola.\nDIRECTORA: Gracias.\n[PAUSA 1s]\nPROFE ANA: Adiós.",
    voices: { LOCUTOR: "Charon", DIRECTORA: "Kore", "PROFE ANA": "Puck" },
  });

  assert.equal(blocks, 2);
  assert.deepEqual(speakers, ["LOCUTOR", "DIRECTORA", "PROFE ANA"]);
  assert.equal(wav.subarray(0, 4).toString(), "RIFF");
  assert.equal(wav.subarray(8, 12).toString(), "WAVE");
  // 2 bloques de 1 s + pausa de 1 s + 2 respiros de 250 ms
  assert.equal((wav.length - 44) / (24000 * 2), 3.5);

  assert.deepEqual(
    calls[0].config.speechConfig.multiSpeakerVoiceConfig.speakerVoiceConfigs.map((v: any) => [v.speaker, v.voiceConfig.prebuiltVoiceConfig.voiceName]),
    [["LOCUTOR", "Charon"], ["DIRECTORA", "Kore"]]
  );
  assert.equal(calls[1].config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, "Puck");
});

test("rechaza guiones sin diálogo", async () => {
  await assert.rejects(generateScriptAudio(mockClient([]), { script: "# solo comentario", voices: {} }));
});
