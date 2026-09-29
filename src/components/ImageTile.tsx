import React, { useRef, useState } from "react";
import { ImageIcon, Loader2, Pencil, RefreshCw, TriangleAlert, Upload, Sparkles } from "lucide-react";

export interface ProjectImage {
  variation: string;
  prompt: string;
  status: "pending" | "generating" | "done" | "error";
  error?: string;
  file?: string;
  source?: "ai" | "upload";
  generatedAt?: string;
}

const iconButton =
  "p-1 rounded-md bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-100 hover:border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer";

// Una imagen del proyecto (toma de un bloque o miniatura): vista previa, regenerar, subir otra y editar su prompt.
export default function ImageTile({
  projectId,
  image,
  disabled,
  onGenerate,
  onUpload,
  onPromptChange,
}: {
  projectId: string;
  image: ProjectImage;
  disabled?: boolean;
  onGenerate: () => void;
  onUpload: (file: File) => void;
  onPromptChange: (prompt: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(image.prompt);
  const fileRef = useRef<HTMLInputElement>(null);
  const src = image.file ? `/api/projects/${projectId}/images/${image.file}?v=${encodeURIComponent(image.generatedAt ?? "")}` : "";
  const generating = image.status === "generating";

  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="relative aspect-video rounded-md overflow-hidden border border-slate-800 bg-slate-950 flex items-center justify-center">
        {image.status === "done" && src ? (
          <a href={src} target="_blank" rel="noreferrer" className="w-full h-full">
            <img src={src} alt={image.variation} loading="lazy" className="w-full h-full object-cover" />
          </a>
        ) : generating ? (
          <Loader2 className="w-5 h-5 animate-spin text-fuchsia-400" />
        ) : image.status === "error" ? (
          <span title={image.error} className="flex flex-col items-center gap-1 px-2 text-center text-[10px] text-rose-300">
            <TriangleAlert className="w-4 h-4" /> <span className="line-clamp-2">{image.error}</span>
          </span>
        ) : (
          <ImageIcon className="w-5 h-5 text-slate-700" />
        )}
        {generating && image.file && <div className="absolute inset-0 bg-slate-950/60" />}
      </div>
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] text-slate-500 truncate" title={image.variation}>
          {image.variation}
          {image.source === "upload" && " · propia"}
        </span>
        <div className="flex gap-1 shrink-0">
          <button onClick={() => { setDraft(image.prompt); setEditing((v) => !v); }} className={iconButton} title="Editar prompt" aria-label="Editar prompt">
            <Pencil className="w-3 h-3" />
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={disabled || generating} className={iconButton} title="Subir imagen propia" aria-label="Subir imagen propia">
            <Upload className="w-3 h-3" />
          </button>
          <button onClick={onGenerate} disabled={disabled || generating} className={iconButton} title={image.status === "done" ? "Regenerar" : "Generar"} aria-label={image.status === "done" ? "Regenerar" : "Generar"}>
            {image.status === "done" ? <RefreshCw className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onUpload(file);
              e.target.value = "";
            }}
          />
        </div>
      </div>
      {editing && (
        <div className="flex flex-col gap-1">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full min-h-[80px] bg-slate-950 border border-slate-800 rounded-md p-1.5 font-mono text-[10px] leading-snug text-slate-200 focus:outline-none focus:border-fuchsia-500/60 resize-y"
          />
          <div className="flex gap-1">
            <button
              onClick={() => { onPromptChange(draft); setEditing(false); }}
              className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-fuchsia-600 text-white hover:bg-fuchsia-500 cursor-pointer"
            >
              Guardar
            </button>
            <button onClick={() => setEditing(false)} className="px-2 py-0.5 rounded-md text-[10px] text-slate-400 hover:text-slate-200 cursor-pointer">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
