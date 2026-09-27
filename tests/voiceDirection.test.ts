import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVoiceDirection } from "../src/lib/voiceDirection";
import { parseScript } from "../src/lib/scriptParser";

const DOCUMENTAL = `Voz: masculina o femenina, adulta, 35-50 años, tono grave/cálido de documental (referencia: narrador de National Geographic en español latino, NO tono infantil ni comercial/entusiasta).

Configuración:
- Estabilidad: alta (0.65-0.75) para evitar variaciones emocionales bruscas
- Velocidad: 90-95% de la velocidad normal (ritmo pausado, deliberado)
- Estilo/exageración: baja - la voz no debe sonar "vendedora", sino informativa y
  levemente solemne, como revelando un secreto
- Pausas: añade [pausa] de 0.5s después de cada dato numérico o afirmación de
escala,`;

test("interpreta un prompt de narración estilo ElevenLabs", () => {
  const d = parseVoiceDirection(DOCUMENTAL);
  assert.equal(d.gender, "indistinta");
  assert.equal(d.speedPercent, 93);
  assert.equal(d.stability, "alta");
  assert.equal(d.styleIntensity, "baja");
  assert.equal(d.defaultPauseMs, 500);
  assert.equal(d.pauseAfterNumbersMs, 500);
  assert.equal(d.suggestedVoice, "Charon");
  for (const tone of ["documental", "grave", "calido", "solemne", "informativo"]) assert.ok(d.tones.includes(tone), tone);
  // Los tonos negados ("NO ... entusiasta") no cuentan.
  assert.ok(!d.tones.includes("alegre"));
  assert.ok(d.performanceNotes.some((n) => /latinoamericano/.test(n)));
});

test("sugiere voz femenina cuando el prompt lo pide", () => {
  assert.equal(parseVoiceDirection("Voz femenina, cálida y cercana").suggestedVoice, "Sulafat");
});

test("inserta pausas tras frases con cifras y funde pausas consecutivas", () => {
  const segments = parseScript("Tiene 11 mil metros. Hay vida. Son millones de años. [pausa]", { pauseAfterNumbersMs: 500, defaultPauseMs: 500 });
  assert.deepEqual(
    segments.map((s) => (s.type === "pause" ? `‖${s.ms}` : s.text)),
    ["Tiene 11 mil metros.", "‖500", "Hay vida.", "Son millones de años.", "‖500"]
  );
});
