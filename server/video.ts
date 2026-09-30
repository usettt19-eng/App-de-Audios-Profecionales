// Montaje del video final con ffmpeg (proceso de "montar_video.py"):
// 1. mide la duración de cada audio, 2. efecto Ken Burns en cada imagen, 3. fundido entre las imágenes
// de cada bloque, 4. cada segmento dura exactamente lo que su narración, 5. concatena todo en un MP4
// 1920×1080 a 30 fps.
import { spawn } from "child_process";

export const WIDTH = 1920;
export const HEIGHT = 1080;
export const FPS = 30;
// Se escala la imagen por encima de 1080p antes del zoom para que el movimiento sea suave.
const WORK_W = 2560;
const WORK_H = 1440;
const ZOOM = 0.12;
const MAX_FADE = 1;

export interface SegmentInput {
  images: string[];
  audio: string;
  durationSec: number;
  output: string;
}

// Duración de cada imagen para que, descontando los fundidos, el segmento dure lo mismo que la narración.
export function clipDurations(total: number, count: number): { clip: number; fade: number } {
  if (count <= 1) return { clip: total, fade: 0 };
  const fade = Math.min(MAX_FADE, total / count / 3);
  return { clip: (total + (count - 1) * fade) / count, fade };
}

// Movimiento de cámara de cada imagen: acercamiento, alejamiento y paneo, alternados.
function kenBurns(index: number, frames: number): string {
  const f = Math.max(frames - 1, 1);
  const center = `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`;
  switch (index % 3) {
    case 0:
      return `zoompan=z='1+${ZOOM}*on/${f}':${center}`;
    case 1:
      return `zoompan=z='${1 + ZOOM}-${ZOOM}*on/${f}':${center}`;
    default:
      return `zoompan=z='${1 + ZOOM / 2}':x='(iw-iw/zoom)*on/${f}':y='ih/2-(ih/zoom/2)'`;
  }
}

export function segmentArgs(input: SegmentInput, threads = 2): string[] {
  const n = input.images.length;
  const { clip, fade } = clipDurations(input.durationSec, n);
  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  for (const image of input.images) args.push("-i", image);
  args.push("-i", input.audio);

  const filters: string[] = [];
  input.images.forEach((_, i) => {
    const frames = Math.max(Math.round(clip * FPS), 1);
    filters.push(
      `[${i}:v]scale=${WORK_W}:${WORK_H}:force_original_aspect_ratio=increase,crop=${WORK_W}:${WORK_H},setsar=1,` +
        `${kenBurns(i, frames)}:d=${frames}:s=${WIDTH}x${HEIGHT}:fps=${FPS},setpts=PTS-STARTPTS[v${i}]`
    );
  });
  let last = "v0";
  for (let i = 1; i < n; i++) {
    const offset = (clip - fade) * i;
    const out = i === n - 1 ? "vx" : `x${i}`;
    filters.push(`[${last}][v${i}]xfade=transition=fade:duration=${fade.toFixed(3)}:offset=${offset.toFixed(3)}[${out}]`);
    last = out;
  }
  filters.push(`[${last}]format=yuv420p[vout]`);

  args.push(
    "-filter_complex", filters.join(";"),
    "-map", "[vout]", "-map", `${n}:a`,
    "-t", input.durationSec.toFixed(3),
    "-r", String(FPS),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-threads", String(threads),
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    input.output
  );
  return args;
}

export function concatArgs(listFile: string, output: string): string[] {
  return ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", "-movflags", "+faststart", output];
}

// Ejecuta ffmpeg con prioridad baja (el servidor comparte CPU con otros servicios).
export function runFfmpeg(args: string[]): Promise<void> {
  const useNice = process.env.VIDEO_NICE !== "0";
  const [cmd, cmdArgs] = useNice ? ["nice", ["-n", "10", "ffmpeg", ...args]] : ["ffmpeg", args];
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
    child.on("error", (err: any) =>
      reject(new Error(err.code === "ENOENT" ? "ffmpeg no está instalado en el servidor." : err.message))
    );
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg falló (código ${code}): ${stderr.trim().split("\n").slice(-3).join(" ")}`))));
  });
}
