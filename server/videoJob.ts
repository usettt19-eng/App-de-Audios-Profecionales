// Trabajo de montaje del video de un proyecto. Se ejecuta en segundo plano y de uno en uno
// (el servidor comparte CPU con otros servicios); el progreso se guarda en el proyecto.
import { promises as fs } from "fs";
import path from "path";
import { pcmDurationSeconds } from "./audio";
import { concatArgs, runFfmpeg, segmentArgs } from "./video";
import {
  getProject, imageFilePath, mutateProject, Project, projectFolder, sectionAudioFile, videoFingerprint, videoPath,
} from "./projects";

let queue: Promise<unknown> = Promise.resolve();

// Imágenes de cada bloque: las suyas; si no tiene, las del bloque anterior con imágenes; si no, la miniatura.
export function imagesPerSection(project: Project): string[][] {
  const thumbnail = project.thumbnail?.status === "done" && project.thumbnail.file ? [project.thumbnail.file] : [];
  let previous: string[] = [];
  const result = project.sections.map((s) => {
    const own = (s.images ?? []).filter((i) => i.status === "done" && i.file).map((i) => i.file!);
    if (own.length) previous = own;
    return own.length ? own : previous;
  });
  // Bloques iniciales sin imágenes propias ni anteriores: las del primer bloque que tenga, o la miniatura.
  const firstWithImages = result.find((r) => r.length) ?? thumbnail;
  return result.map((r) => (r.length ? r : firstWithImages));
}

// Comprueba que el proyecto se puede montar; devuelve el motivo si no.
export function videoBlocker(project: Project): string | null {
  const missing = project.sections.filter((s) => s.status !== "done").length;
  if (missing) return missing === 1 ? "Falta 1 audio por generar." : `Faltan ${missing} audios por generar.`;
  if (imagesPerSection(project).some((imgs) => !imgs.length)) return "Genera o sube al menos una imagen (o la miniatura).";
  return null;
}

export function queueVideoRender(projectId: string, onDone: () => void): void {
  queue = queue.then(() => renderVideo(projectId)).catch(() => undefined).finally(onDone);
}

async function renderVideo(projectId: string): Promise<void> {
  const project = await getProject(projectId);
  const fingerprint = videoFingerprint(project);
  const workDir = path.join(projectFolder(projectId), "_render");
  const threads = Number(process.env.VIDEO_THREADS) || 2;
  await fs.rm(workDir, { recursive: true, force: true });
  await fs.mkdir(workDir, { recursive: true });

  try {
    const images = imagesPerSection(project);
    const segments: string[] = [];
    let total = 0;
    for (const [i, section] of project.sections.entries()) {
      const audio = sectionAudioFile(projectId, section.id);
      const durationSec = pcmDurationSeconds((await fs.stat(audio)).size - 44);
      const output = path.join(workDir, `seg_${String(i + 1).padStart(3, "0")}.mp4`);
      await runFfmpeg(segmentArgs({ images: images[i].map((f) => imageFilePath(projectId, f)), audio, durationSec, output }, threads));
      segments.push(output);
      total += durationSec;
      await mutateProject(projectId, (p) => {
        if (p.video) p.video.progress = i + 1;
      });
    }

    const list = path.join(workDir, "segmentos.txt");
    await fs.writeFile(list, segments.map((s) => `file '${s.replace(/'/g, "'\\''")}'`).join("\n") + "\n");
    const tmp = path.join(workDir, "video.mp4");
    await runFfmpeg(concatArgs(list, tmp));
    await fs.rename(tmp, videoPath(projectId));

    await mutateProject(projectId, (p) => {
      p.video = { ...p.video!, status: "done", progress: p.sections.length, durationSec: Math.round(total * 10) / 10, finishedAt: new Date().toISOString(), renderedFrom: fingerprint, error: undefined };
    });
  } catch (error: any) {
    console.error("Video Error:", error);
    await mutateProject(projectId, (p) => {
      if (p.video) Object.assign(p.video, { status: "error", error: error?.message || "No se pudo montar el video." });
    });
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}
