import React, { useMemo, useState } from "react";
import { Mic, Save, SlidersHorizontal, Trash2, Wand2 } from "lucide-react";
import { directionSummary, MAX_DIRECTION_CHARS, parseVoiceDirection, VoiceDirection } from "../lib/voiceDirection";

export const VOICES: { name: string; tone: string }[] = [
  { name: "Kore", tone: "Firme" },
  { name: "Charon", tone: "Informativa" },
  { name: "Puck", tone: "Animada" },
  { name: "Zephyr", tone: "Brillante" },
  { name: "Aoede", tone: "Fresca" },
  { name: "Fenrir", tone: "Enérgica" },
  { name: "Leda", tone: "Juvenil" },
  { name: "Orus", tone: "Firme" },
  { name: "Callirrhoe", tone: "Relajada" },
  { name: "Autonoe", tone: "Brillante" },
  { name: "Enceladus", tone: "Susurrante" },
  { name: "Iapetus", tone: "Clara" },
  { name: "Umbriel", tone: "Relajada" },
  { name: "Algieba", tone: "Suave" },
  { name: "Despina", tone: "Suave" },
  { name: "Erinome", tone: "Clara" },
  { name: "Algenib", tone: "Grave" },
  { name: "Rasalgethi", tone: "Informativa" },
  { name: "Laomedeia", tone: "Animada" },
  { name: "Achernar", tone: "Suave" },
  { name: "Alnilam", tone: "Firme" },
  { name: "Schedar", tone: "Equilibrada" },
  { name: "Gacrux", tone: "Madura" },
  { name: "Pulcherrima", tone: "Directa" },
  { name: "Achird", tone: "Amigable" },
  { name: "Zubenelgenubi", tone: "Casual" },
  { name: "Vindemiatrix", tone: "Gentil" },
  { name: "Sadachbia", tone: "Vivaz" },
  { name: "Sadaltager", tone: "Experta" },
  { name: "Sulafat", tone: "Cálida" },
];

const DEFAULT_VOICE_ROTATION = ["Charon", "Kore", "Puck", "Aoede", "Algenib", "Leda", "Sulafat", "Iapetus"];

// Completa el reparto con una voz para cada personaje nuevo sin pisar las elecciones existentes.
// El primer personaje toma la voz sugerida por el prompt de dirección, si la hay.
export function withDefaultVoices(voices: Record<string, string>, speakers: string[], suggested?: string): Record<string, string> {
  let changed = false;
  const next = { ...voices };
  speakers.forEach((speaker, i) => {
    if (!next[speaker]) {
      next[speaker] = i === 0 && suggested ? suggested : DEFAULT_VOICE_ROTATION[i % DEFAULT_VOICE_ROTATION.length];
      changed = true;
    }
  });
  return changed ? next : voices;
}

export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m ? `${m} min ${s} s` : `${s} s`;
}

export const panelClass = "bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col gap-3";
export const chipButtonClass =
  "px-2.5 py-1 text-[11px] font-semibold rounded-md bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 cursor-pointer";

const SAVED_DIRECTIONS_KEY = "audios-pro:direcciones";

interface SavedDirection {
  name: string;
  text: string;
}

function loadSavedDirections(): SavedDirection[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVED_DIRECTIONS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function storeSavedDirections(list: SavedDirection[]) {
  try {
    localStorage.setItem(SAVED_DIRECTIONS_KEY, JSON.stringify(list));
  } catch {
    // Sin almacenamiento disponible (modo privado): los prompts guardados duran solo esta sesión.
  }
}

export function useParsedDirection(direction: string): VoiceDirection | undefined {
  return useMemo(() => (direction.trim() ? parseVoiceDirection(direction) : undefined), [direction]);
}

export function DirectionPanel({
  value,
  onChange,
  onApplySuggestedVoice,
}: {
  value: string;
  onChange: (value: string) => void;
  onApplySuggestedVoice?: (voice: string) => void;
}) {
  const [saved, setSaved] = useState<SavedDirection[]>(loadSavedDirections);
  const parsed = useParsedDirection(value);

  const save = () => {
    const name = window.prompt("Nombre para este prompt de dirección:")?.trim();
    if (!name) return;
    const next = [...saved.filter((d) => d.name !== name), { name, text: value }];
    setSaved(next);
    storeSavedDirections(next);
  };

  const remove = (name: string) => {
    const next = saved.filter((d) => d.name !== name);
    setSaved(next);
    storeSavedDirections(next);
  };

  return (
    <div className={panelClass}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-4 h-4 text-fuchsia-400" />
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Prompt de dirección de voz</h3>
        </div>
        <button onClick={save} disabled={!value.trim()} className={chipButtonClass}>
          <Save className="w-3 h-3" /> Guardar
        </button>
      </div>

      {saved.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {saved.map((d) => (
            <span key={d.name} className="flex items-center rounded-md bg-slate-950 border border-slate-800 text-[11px]">
              <button onClick={() => onChange(d.text)} className="px-2 py-1 text-slate-300 hover:text-white cursor-pointer">{d.name}</button>
              <button onClick={() => remove(d.name)} aria-label={`Eliminar ${d.name}`} className="pr-1.5 text-slate-600 hover:text-rose-400 cursor-pointer">
                <Trash2 className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={MAX_DIRECTION_CHARS}
        spellCheck={false}
        placeholder="Pega aquí el prompt de narración: tipo de voz, velocidad, estabilidad, estilo, reglas de pausas..."
        className="w-full min-h-[150px] bg-slate-950 border border-slate-800 rounded-lg p-2.5 font-mono text-[11px] leading-relaxed text-slate-200 focus:outline-none focus:border-fuchsia-500/60 resize-y"
      />

      {parsed && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            {directionSummary(parsed).map((chip) => (
              <span key={chip} className="px-2 py-0.5 rounded-full bg-fuchsia-950/50 border border-fuchsia-900/60 text-[10px] font-semibold text-fuchsia-200">{chip}</span>
            ))}
          </div>
          {parsed.suggestedVoice && onApplySuggestedVoice && (
            <button onClick={() => onApplySuggestedVoice(parsed.suggestedVoice!)} className={`${chipButtonClass} self-start text-slate-300`}>
              <Wand2 className="w-3 h-3" /> Usar voz sugerida: {parsed.suggestedVoice}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function VoiceCast({
  speakers,
  voices,
  onChange,
  children,
}: {
  speakers: string[];
  voices: Record<string, string>;
  onChange: (voices: Record<string, string>) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className={panelClass}>
      <div className="flex items-center gap-2">
        <Mic className="w-4 h-4 text-fuchsia-400" />
        <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Reparto de voces</h3>
      </div>
      {speakers.length === 0 && <p className="text-[11px] text-slate-500">Escribe un guion para detectar personajes.</p>}
      {speakers.map((speaker) => (
        <div key={speaker} className="flex items-center justify-between gap-3">
          <span className="text-xs font-bold text-slate-200 truncate">{speaker}</span>
          <select
            value={voices[speaker] || ""}
            onChange={(e) => onChange({ ...voices, [speaker]: e.target.value })}
            className="bg-slate-950 border border-slate-800 rounded-md px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-fuchsia-500/60"
          >
            {VOICES.map((v) => (
              <option key={v.name} value={v.name}>{v.name} — {v.tone}</option>
            ))}
          </select>
        </div>
      ))}
      {children}
    </div>
  );
}

export function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-2.5">
      <div className="flex items-center gap-1.5 text-slate-500 text-[10px] font-bold uppercase tracking-wide">
        {icon} {label}
      </div>
      <div className="text-xs font-bold text-slate-200 mt-1">{value}</div>
    </div>
  );
}
