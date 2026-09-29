import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDirectionPrompt, narrationOf, parseDirection } from "../src/lib/imageDirection";
import { BUILTIN_FORMAT, DEFAULT_ANALYSIS_PROMPT } from "../src/lib/formats";
import { buildScriptPrompt, DEFAULT_SCRIPT_PROMPT } from "../src/lib/scriptTemplates";

test("el guion obliga a ceñirse al tema del título (sin lugares de otros países ni datos inventados)", () => {
  const prompt = buildScriptPrompt(DEFAULT_SCRIPT_PROMPT, { titulo: "Venezuela Parajes Increíbles", tema: "", duracion: "20", segmentos: "10" });
  assert.match(prompt, /FIDELIDAD AL TEMA/);
  assert.match(prompt, /"Venezuela Parajes Increíbles"/);
  assert.match(prompt, /Si el título menciona un país, región o ciudad, TODOS los lugares/);
  assert.match(prompt, /nunca lo inventes/);
  // Las reglas van después del prompt del formato, para que tengan prioridad sobre sus ejemplos.
  assert.ok(prompt.indexOf("FIDELIDAD AL TEMA") > prompt.indexOf("estructuras/construcciones"));
  void DEFAULT_ANALYSIS_PROMPT;
});

test("la narración del bloque llega limpia al director de arte", () => {
  const script = "# MÚSICA: épica\nNARRADOR (Intrigante): El Salto Ángel cae desde 979 metros.\n[PAUSA 1000ms]\nNARRADOR: Está en el Parque Nacional Canaima.";
  assert.equal(narrationOf(script), "El Salto Ángel cae desde 979 metros. Está en el Parque Nacional Canaima.");
});

test("el prompt del director incluye la narración de cada bloque y adapta las plantillas al tema", () => {
  const prompt = buildDirectionPrompt({
    videoTitle: "Venezuela Parajes Increíbles",
    blocks: [{ id: "b1", title: "Salto Ángel", narration: "El Salto Ángel cae desde 979 metros." }],
    variations: BUILTIN_FORMAT.visuales.variaciones,
    baseTemplate: BUILTIN_FORMAT.visuales.plantillaBase,
    thumbnailTemplate: BUILTIN_FORMAT.miniatura,
  });
  assert.match(prompt, /\[b1\] Salto Ángel\nEl Salto Ángel cae desde 979 metros\./);
  assert.match(prompt, /ubicación geográfica real/);
  assert.match(prompt, /no uses términos de arquitectura o construcción/);
  assert.match(prompt, /1\. Establishing shot:/);
});

test("lee los prompts del director, los limpia y se queda con los que corresponden", () => {
  const raw = "```json\n" + JSON.stringify({
    bloques: [
      { id: "b1", elemento: "Angel Falls, Canaima National Park, Venezuela", prompts: ["Angel Falls aerial --ar 16:9", "Angel Falls detail", "hiker at Angel Falls base", "vintage photo of Angel Falls expedition", "sobra"] },
      { id: "b2", prompts: [] },
    ],
    miniatura: "YouTube thumbnail, Angel Falls, extreme low angle",
  }) + "\n```";
  const d = parseDirection(raw, 4);
  assert.deepEqual(Object.keys(d.blocks), ["b1"]);
  assert.equal(d.blocks.b1.prompts.length, 4);
  assert.equal(d.blocks.b1.prompts[0], "Angel Falls aerial, no text, no watermark");
  assert.equal(d.thumbnail, "YouTube thumbnail, Angel Falls, extreme low angle, no text, no watermark");
  assert.throws(() => parseDirection("sin json", 4), /formato esperado/);
});
