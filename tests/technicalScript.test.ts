import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { importTechnicalScript, looksLikeTechnicalScript } from "../src/lib/technicalScript";
import { parseScript } from "../src/lib/scriptParser";

const source = readFileSync(new URL("./fixtures/guion-tecnico.md", import.meta.url), "utf8");

test("divide el guion en un audio por bloque e ignora la presentación", () => {
  const sections = importTechnicalScript(source);
  assert.ok(looksLikeTechnicalScript(source));
  assert.deepEqual(sections.map((s) => s.title), ["Gancho", "Estructura 1: El Viaducto de Millau", "Cierre"]);
  assert.ok(!sections[0].script.includes("Aquí tienes"));
});

test("separa música y efectos de la narración", () => {
  const [gancho, , cierre] = importTechnicalScript(source);
  assert.deepEqual(gancho.cues, [
    { kind: "MÚSICA", description: "Inicio cinemático, grave, con ambiente tenso y misterioso. Misterio en aumento." },
    { kind: "SFX", description: "Subidón dramático o impacto grave" },
  ]);
  assert.equal(cierre.cues.length, 2);
  const spoken = parseScript(gancho.script).filter((s) => s.type === "line").map((s) => (s.type === "line" ? s.text : ""));
  assert.ok(spoken.every((t) => !/MÚSICA|SFX/.test(t)));
});

test("aplica tonos, énfasis y pausas", () => {
  const [gancho, millau] = importTechnicalScript(source);
  const segments = parseScript(gancho.script);
  assert.deepEqual(segments[0], {
    type: "line",
    speaker: "NARRADOR",
    text: "Hay un edificio en el desierto que no debería sostenerse en pie.",
    direction: "Intrigante, pausado, seguro",
  });
  assert.deepEqual(segments[1], { type: "pause", ms: 1000 });
  const epic = segments.find((s) => s.type === "line" && s.text.startsWith("El ser humano"));
  assert.equal(epic?.type === "line" && epic.direction, "Épico, reflexivo; enfatiza «imposibles»");
  assert.ok(epic?.type === "line" && !epic.text.includes("**"));

  const millauSegments = parseScript(millau.script);
  const emphatic = millauSegments.filter((s) => s.type === "line" && s.direction?.includes("Enfático"));
  assert.equal(emphatic.length, 1, "las indicaciones sueltas solo afectan al párrafo siguiente");
  assert.ok(millauSegments.some((s) => s.type === "pause" && s.ms === 1200), "pausa táctica");
});

test("sin marcas de bloque, todo el texto es un único audio", () => {
  const sections = importTechnicalScript("*(Tono: Sereno)*\nHola a todos.\n**(MÚSICA: suave)**\nAdiós.");
  assert.equal(sections.length, 1);
  assert.equal(sections[0].cues.length, 1);
});
