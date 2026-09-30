// Música de fondo del video: un tramo por cambio de ambiente del guion, generado con IA (Lyria) o subido a mano.
import React, { useRef, useState } from "react";
import { FileUp, Loader2, Music, RefreshCw, Sparkles } from "lucide-react";
import { chipButtonClass, panelClass } from "./voiceControls";

export interface MusicTrack {
  startIndex: number;
  prompt: string;
  status: "pending" | "generating" | "done" | "error";
  error?: string;
  file?: string;
  source?: "ai" | "upload";
  generatedAt?: string;
}

export interface ProjectMusic {
  enabled: boolean;
  volume: number;
  model?: string;
  tracks: MusicTrack[];
}

const primaryButtonClass =
  "px-4 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-2 bg-fuchsia-600 text-white hover:bg-fuchsia-500 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Error ${res.status}`), { data });
  return data as T;
}

export default function MusicPanel<P extends { music?: ProjectMusic }>({
  projectId, music, sectionTitles, onProject, onError,
}: {
  projectId: string;
  music?: ProjectMusic;
  sectionTitles: string[];
  onProject: (p: P) => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const [volume, setVolume] = useState<number | null>(null);
  const volumeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  if (!music) return null;
  const done = music.tracks.filter((t) => t.status === "done").length;
  const running = busy.size > 0 || music.tracks.some((t) => t.status === "generating");

  const patch = async (body: Partial<{ enabled: boolean; volume: number; prompts: { n: number; prompt: string }[] }>) => {
    try {
      onProject(await request<P>(`/api/projects/${projectId}`, { method: "PATCH", body: JSON.stringify({ music: body }) }));
    } catch (e: any) {
      onError(e.message);
    }
  };

  const generate = async (n?: number) => {
    const targets = n === undefined ? music.tracks.map((t, i) => (t.status === "done" ? -1 : i)).filter((i) => i >= 0) : [n];
    setBusy((prev) => new Set([...prev, ...targets]));
    try {
      onProject(await request<P>(`/api/projects/${projectId}/music/generate`, { method: "POST", body: JSON.stringify(n === undefined ? {} : { n }) }));
    } catch (e: any) {
      if (e.data?.project) onProject(e.data.project);
      onError(e.message);
    } finally {
      setBusy((prev) => new Set([...prev].filter((i) => !targets.includes(i))));
    }
  };

  const upload = async (n: number, file: File) => {
    setBusy((prev) => new Set([...prev, n]));
    try {
      const res = await fetch(`/api/projects/${projectId}/music/upload?n=${n}`, { method: "POST", headers: { "Content-Type": file.type || "audio/mpeg" }, body: file });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      onProject(data);
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy((prev) => new Set([...prev].filter((i) => i !== n)));
    }
  };

  const changeVolume = (value: number) => {
    setVolume(value);
    clearTimeout(volumeTimer.current);
    volumeTimer.current = setTimeout(() => patch({ volume: value }).then(() => setVolume(null)), 500);
  };
  const shownVolume = volume ?? music.volume;

  return (
    <div className={panelClass}>
      <div className="flex items-center gap-2">
        <Music className="w-4 h-4 text-fuchsia-400" />
        <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Música de fondo</h3>
        <span className="ml-auto text-[11px] text-slate-500">{done} de {music.tracks.length}</span>
      </div>
      <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer">
        <input type="checkbox" checked={music.enabled} onChange={(e) => patch({ enabled: e.target.checked })} className="accent-fuchsia-500" />
        Incluir la música en el video
      </label>
      <label className="flex items-center gap-3">
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Volumen</span>
        <input
          type="range" min={0.05} max={0.4} step={0.01} value={shownVolume}
          onChange={(e) => changeVolume(Number(e.target.value))}
          disabled={!music.enabled}
          aria-label="Volumen de la música"
          className="flex-1 accent-fuchsia-500"
        />
        <span className="text-[11px] text-slate-400 w-9 text-right">{Math.round(shownVolume * 100)}%</span>
      </label>

      <button onClick={() => generate()} disabled={running || done === music.tracks.length} className={primaryButtonClass}>
        {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
        {running ? "Componiendo música…" : done === music.tracks.length ? "Música lista" : `Generar ${music.tracks.length - done} tramo${music.tracks.length - done > 1 ? "s" : ""} con IA`}
      </button>

      <div className="flex flex-col gap-2">
        {music.tracks.map((track, n) => {
          const next = music.tracks[n + 1]?.startIndex ?? sectionTitles.length;
          const range = next - 1 > track.startIndex ? `bloques ${track.startIndex + 1}–${next}` : `bloque ${track.startIndex + 1}`;
          const trackBusy = busy.has(n) || track.status === "generating";
          return (
            <div key={n} className="flex flex-col gap-1.5 rounded-lg border border-slate-800 bg-slate-950/40 p-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-slate-300">Tramo {n + 1}</span>
                <span className="text-[10px] text-slate-500 truncate" title={sectionTitles[track.startIndex]}>
                  {range} · {sectionTitles[track.startIndex]}
                </span>
                {trackBusy && <Loader2 className="ml-auto w-3 h-3 animate-spin text-amber-300" />}
              </div>
              <textarea
                defaultValue={track.prompt}
                key={`${n}:${track.prompt}`}
                onBlur={(e) => e.target.value.trim() !== track.prompt && patch({ prompts: [{ n, prompt: e.target.value.trim() }] })}
                rows={2}
                aria-label={`Ambiente del tramo ${n + 1}`}
                className="w-full resize-y bg-slate-950 border border-slate-800 rounded-md px-2 py-1 text-[11px] text-slate-300 focus:outline-none focus:border-fuchsia-500/60"
              />
              {track.status === "error" && track.error && <p className="text-[10px] text-rose-300">{track.error}</p>}
              {track.status === "done" && track.file && (
                <audio controls preload="none" src={`/api/projects/${projectId}/music/${track.file}?v=${encodeURIComponent(track.generatedAt ?? "")}`} className="w-full h-8" />
              )}
              <div className="flex gap-2">
                <button onClick={() => generate(n)} disabled={trackBusy} className={chipButtonClass}>
                  {track.status === "done" ? <RefreshCw className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
                  {track.status === "done" ? "Rehacer" : "Generar"}
                </button>
                <label className={`${chipButtonClass} ${trackBusy ? "pointer-events-none opacity-40" : ""}`}>
                  <FileUp className="w-3 h-3" /> Subir
                  <input
                    type="file" accept="audio/*" className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) upload(n, file);
                    }}
                  />
                </label>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-slate-500">
        Un tramo por cada indicación de MÚSICA del guion. En el video se repite para cubrir sus bloques, se funde entre tramos y baja sola cuando habla el narrador.
      </p>
    </div>
  );
}
