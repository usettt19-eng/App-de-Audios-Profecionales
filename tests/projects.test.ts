import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const dir = mkdtempSync(path.join(tmpdir(), "audios-pro-"));
process.env.DATA_DIR = dir;
const projects = await import("../server/projects");
const source = readFileSync(new URL("./fixtures/guion-tecnico.md", import.meta.url), "utf8");

after(() => rmSync(dir, { recursive: true, force: true }));

test("crea, actualiza y marca audios desactualizados", async () => {
  const project = await projects.createProject({ name: "Construcciones", source, direction: "Voz grave" });
  assert.equal(project.sections.length, 3);
  assert.deepEqual((await projects.listProjects()).map((p) => p.name), ["Construcciones"]);

  const section = project.sections[0];
  const wav = Buffer.from("RIFF....WAVE");
  await projects.saveSectionAudio(project.id, section.id, wav);
  let updated = await projects.updateSection(project.id, section.id, (s, p) => {
    s.status = "done";
    s.renderedFrom = projects.renderFingerprint(p, s);
  });
  assert.equal(projects.toView(updated).sections[0].stale, false);

  updated = await projects.updateProject(project.id, { direction: "Voz femenina" });
  assert.equal(projects.toView(updated).sections[0].stale, true);
  assert.deepEqual(await projects.readSectionAudio(project.id, section.id), wav);
});

test("una generación interrumpida no se queda en 'generando'", async () => {
  const project = await projects.createProject({ name: "X", source });
  const updated = await projects.updateSection(project.id, project.sections[0].id, (s) => (s.status = "generating"));
  assert.equal(projects.toView(updated).sections[0].status, "error");
  assert.equal(projects.toView(updated, () => true).sections[0].status, "generating");
});

test("el ZIP incluye la hoja de producción y los audios en orden", async () => {
  const project = await projects.createProject({ name: "Zip", source });
  const [first] = project.sections;
  await projects.saveSectionAudio(project.id, first.id, Buffer.from("audio-1"));
  const updated = await projects.updateSection(project.id, first.id, (s) => (s.status = "done"));
  const zip = await projects.buildProjectZip(updated);

  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  const text = zip.toString("utf8");
  assert.ok(text.includes("00 - Hoja de produccion.txt"));
  assert.ok(text.includes("01 - Gancho.wav"));
  assert.ok(text.includes("MÚSICA: Inicio cinemático"));
  assert.ok(text.includes("[sin audio]"));
  // Registro final del ZIP: número total de archivos (hoja + el único audio generado).
  assert.equal(zip.readUInt16LE(zip.length - 12), 2, "solo se incluyen audios generados");
});

test("rechaza identificadores con rutas", async () => {
  await assert.rejects(projects.getProject("../../etc"), projects.NotFoundError);
});
