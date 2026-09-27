import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRenderPlan, listSpeakers, parseScript } from "../src/lib/scriptParser";

test("detecta personajes, acotaciones y pausas", () => {
  const segments = parseScript(`# Escena 1
LOCUTOR (cálido): Hola. [PAUSA 1.5s] Bienvenidos.
DIRECTORA: Gracias, (sonriendo) familias.
Recuerden lo siguiente: la entrada es a las 7:30.
[PAUSA 500ms]`);

  assert.deepEqual(segments, [
    { type: "line", speaker: "LOCUTOR", text: "Hola.", direction: "cálido" },
    { type: "pause", ms: 1500 },
    { type: "line", speaker: "LOCUTOR", text: "Bienvenidos.", direction: "cálido" },
    { type: "line", speaker: "DIRECTORA", text: "Gracias, [sonriendo] familias.", direction: undefined },
    { type: "line", speaker: "DIRECTORA", text: "Recuerden lo siguiente: la entrada es a las 7:30.", direction: undefined },
    { type: "pause", ms: 500 },
  ]);
  assert.deepEqual(listSpeakers(segments), ["LOCUTOR", "DIRECTORA"]);
});

test("las líneas sin personaje usan NARRADOR por defecto", () => {
  assert.deepEqual(listSpeakers(parseScript("Texto sin personaje.")), ["NARRADOR"]);
});

test("cada bloque tiene como máximo dos voces", () => {
  const plan = buildRenderPlan(parseScript("A: uno\nB: dos\nC: tres\nA: cuatro"));
  const blocks = plan.flatMap((s) => (s.type === "block" ? [s.block.speakers] : []));
  assert.deepEqual(blocks, [["A", "B"], ["C", "A"]]);
});
