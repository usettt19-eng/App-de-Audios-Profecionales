import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { countBlockMarkers, importTechnicalScript, looksLikeTechnicalScript } from "../src/lib/technicalScript";
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

test("reconoce marcas de bloque mal cerradas y las indicaciones dentro de un párrafo", () => {
  const text = readFileSync(new URL("./fixtures/guion-marcas-rotas.md", import.meta.url), "utf8");
  const sections = importTechnicalScript(text);
  assert.equal(countBlockMarkers(text), 6);
  assert.deepEqual(sections.map((s) => s.title), ["Gancho", "El Salto Ángel", "El Teleférico de Mérida", "La Sierra Nevada de Mérida", "La Puerta (Mérida)", "Cierre"]);

  const [gancho] = sections;
  assert.deepEqual(gancho.cues, [{ kind: "MÚSICA", description: "ambiente épico con cuerdas sutiles y percusión ligera" }]);
  const lines = parseScript(gancho.script).filter((s) => s.type === "line");
  assert.equal(lines.length, 1);
  assert.equal(lines[0].type === "line" && lines[0].direction, "voz seria, pausada, llena de asombro");
  assert.doesNotMatch(gancho.script.split("\n").filter((l) => !l.startsWith("#")).join(" "), /MÚSICA|Tono:/);

  const sierra = parseScript(sections[3].script);
  assert.deepEqual(sierra[sierra.length - 1], { type: "pause", ms: 2000 });
});

test("también reconoce títulos markdown y en negrita sin corchetes", () => {
  const sections = importTechnicalScript("### BLOQUE 1 — GANCHO\nHola.\n**BLOQUE 2 — PICO BOLÍVAR**\nEl punto más alto.");
  assert.deepEqual(sections.map((s) => s.title), ["Gancho", "Pico Bolívar"]);
  // Un párrafo que empieza por "Parte" no es un bloque.
  assert.equal(importTechnicalScript("[BLOQUE 1 — X]\nParte de la selva es virgen.").length, 1);
});
