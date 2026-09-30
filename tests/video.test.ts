import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { clipDurations, concatArgs, runFfmpeg, segmentArgs } from "../server/video";
import { imagesPerSection, videoBlocker } from "../server/videoJob";

const dir = mkdtempSync(path.join(tmpdir(), "audios-video-"));
after(() => rmSync(dir, { recursive: true, force: true }));
process.env.VIDEO_NICE = "0";

test("reparte la duración entre las imágenes descontando los fundidos", () => {
  const { clip, fade } = clipDurations(60, 4);
  assert.equal(fade, 1);
  assert.equal(4 * clip - 3 * fade, 60, "el segmento dura exactamente lo que la narración");
  assert.deepEqual(clipDurations(10, 1), { clip: 10, fade: 0 });
  const short = clipDurations(3, 4);
  assert.ok(short.fade < 1 && Math.abs(4 * short.clip - 3 * short.fade - 3) < 1e-9);
});

test("arma el filtro de ffmpeg con Ken Burns, fundidos y la duración exacta", () => {
  const args = segmentArgs({ images: ["a.png", "b.png", "c.png"], audio: "n.wav", durationSec: 30, output: "o.mp4" });
  const graph = args[args.indexOf("-filter_complex") + 1];
  assert.equal((graph.match(/zoompan/g) ?? []).length, 3);
  assert.equal((graph.match(/xfade/g) ?? []).length, 2);
  assert.match(graph, /s=1920x1080:fps=30/);
  assert.equal(args[args.indexOf("-t") + 1], "30.000");
  assert.deepEqual(args.slice(args.indexOf("-map"), args.indexOf("-map") + 4), ["-map", "[vout]", "-map", "3:a"]);
  assert.ok(concatArgs("l.txt", "v.mp4").includes("+faststart"));
});

test("cada bloque usa sus imágenes, las del anterior o la miniatura", () => {
  const img = (file?: string) => ({ variation: "x", prompt: "p", status: (file ? "done" : "pending") as any, file });
  const project: any = {
    sections: [
      { status: "done", images: [img(), img()] },
      { status: "done", images: [img("b1.png"), img(), img("b3.png")] },
      { status: "done", images: [img()] },
    ],
    thumbnail: img("thumbnail.png"),
  };
  assert.deepEqual(imagesPerSection(project), [["b1.png", "b3.png"], ["b1.png", "b3.png"], ["b1.png", "b3.png"]]);
  assert.equal(videoBlocker(project), null);
  assert.deepEqual(imagesPerSection({ sections: [{ images: [img()] }], thumbnail: img("thumbnail.png") } as any), [["thumbnail.png"]]);
  assert.match(videoBlocker({ ...project, sections: [{ status: "pending", images: [] }, ...project.sections] }) ?? "", /Falta 1 audio/);
  assert.match(videoBlocker({ sections: [{ status: "done", images: [img()] }] } as any) ?? "", /al menos una imagen/);
});

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

test("monta un video real de 1920×1080 a 30 fps con la duración de la narración", { skip: !hasFfmpeg && "ffmpeg no instalado" }, async () => {
  const f = (n: string) => path.join(dir, n);
  execFileSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=1600x900", "-frames:v", "1", f("a.png")]);
  execFileSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=800x800", "-frames:v", "1", f("b.png")]);
  execFileSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "sine=f=440:d=4", "-ar", "24000", "-ac", "1", f("n.wav")]);
  await runFfmpeg(segmentArgs({ images: [f("a.png"), f("b.png")], audio: f("n.wav"), durationSec: 4, output: f("s.mp4") }));
  const probe = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate:format=duration", "-of", "json", f("s.mp4")]).toString();
  const info = JSON.parse(probe);
  assert.equal(info.streams[0].width, 1920);
  assert.equal(info.streams[0].height, 1080);
  assert.equal(info.streams[0].r_frame_rate, "30/1");
  assert.ok(Math.abs(Number(info.format.duration) - 4) < 0.1, `duración ${info.format.duration}`);
});
