import React, { useEffect, useMemo, useRef, useState } from "react";
import { AudioLines, Download, FileUp, Loader2, Mic, Sparkles, Users, Clock, Layers, AlertCircle } from "lucide-react";
import { buildRenderPlan, estimateDurationSeconds, listSpeakers, parseScript } from "../lib/scriptParser";

const VOICES: { name: string; tone: string }[] = [
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

const TEMPLATES: { label: string; style: string; script: string }[] = [
  {
    label: "Anuncio institucional",
    style: "Tono institucional, cálido y confiable, ritmo pausado.",
    script: `# SPOT: Matrículas abiertas 2027 — duración aprox. 40 s
LOCUTOR (cálido, cercano): En nuestro colegio creemos que cada estudiante tiene un talento único.
[PAUSA 0.5s]
DIRECTORA (orgullosa): Por eso, este año abrimos nuevos laboratorios de ciencia y robótica, y ampliamos nuestro programa bilingüe.
LOCUTOR: Las matrículas para el período 2027 ya están abiertas.
Agenda tu visita guiada y conoce a nuestro equipo docente.
[PAUSA 1s]
LOCUTOR (enfático): Colegio San Martín. Educamos para el futuro.`,
  },
  {
    label: "Podcast educativo",
    style: "Conversación natural y dinámica entre dos presentadores de podcast.",
    script: `# EPISODIO 12 — El ciclo del agua
ANA (entusiasta): ¡Hola a todos y bienvenidos a Ciencia en Casa! Hoy hablamos del ciclo del agua.
MARCOS: Así es, Ana. ¿Sabían que el agua que beben hoy pudo haber caído como lluvia hace millones de años?
ANA (sorprendida): ¡Increíble! Empecemos por la evaporación.
MARCOS (explicativo): Cuando el sol calienta mares y ríos, el agua se convierte en vapor y sube a la atmósfera.
[PAUSA]
ANA: Y ahí arriba se enfría y forma las nubes. Eso se llama condensación.
MARCOS (riendo): ¡Exacto! Y cuando las nubes ya no pueden más... llega la precipitación.`,
  },
  {
    label: "Comunicado a familias",
    style: "Formal, claro y sereno.",
    script: `NARRADORA (serena): Estimadas familias, les recordamos que el próximo lunes no habrá clases por jornada de capacitación docente.
[PAUSA 0.7s]
Las actividades se reanudarán con normalidad el martes a las 7:30 de la mañana.
Para cualquier consulta, comuníquense con secretaría. Muchas gracias.`,
  },
];

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? `${m} min ${s} s` : `${s} s`;
}

export default function AudioScriptStudio() {
  const [script, setScript] = useState<string>(TEMPLATES[0].script);
  const [style, setStyle] = useState<string>(TEMPLATES[0].style);
  const [voices, setVoices] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const segments = useMemo(() => parseScript(script), [script]);
  const speakers = useMemo(() => listSpeakers(segments), [segments]);
  const blockCount = useMemo(() => buildRenderPlan(segments).filter((s) => s.type === "block").length, [segments]);
  const lineCount = segments.filter((s) => s.type === "line").length;

  // Asigna una voz por defecto a cada personaje nuevo sin pisar las elecciones del usuario.
  useEffect(() => {
    setVoices((prev) => {
      const next = { ...prev };
      let changed = false;
      speakers.forEach((speaker, i) => {
        if (!next[speaker]) {
          next[speaker] = DEFAULT_VOICE_ROTATION[i % DEFAULT_VOICE_ROTATION.length];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [speakers]);

  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setScript(await file.text());
    e.target.value = "";
  };

  const handleGenerate = async () => {
    if (!lineCount || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/script-audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script, voices, style }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Error ${res.status} al generar el audio.`);
      }
      const blob = await res.blob();
      setAudioUrl(URL.createObjectURL(blob));
    } catch (err: any) {
      setError(err.message || "No se pudo generar el audio.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div id="audio-script-studio" className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Editor de guion */}
      <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <AudioLines className="w-4 h-4 text-fuchsia-400" />
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Guion</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {TEMPLATES.map((t) => (
              <button
                key={t.label}
                onClick={() => { setScript(t.script); setStyle(t.style); }}
                className="px-2.5 py-1 text-[11px] font-semibold rounded-md bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700 cursor-pointer"
              >
                {t.label}
              </button>
            ))}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-2.5 py-1 text-[11px] font-semibold rounded-md bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700 flex items-center gap-1 cursor-pointer"
            >
              <FileUp className="w-3 h-3" /> Cargar .txt
            </button>
            <input ref={fileInputRef} type="file" accept=".txt,.md,.fountain,text/plain" className="hidden" onChange={handleFile} />
          </div>
        </div>

        <textarea
          value={script}
          onChange={(e) => setScript(e.target.value)}
          spellCheck={false}
          className="w-full min-h-[360px] bg-slate-950 border border-slate-800 rounded-lg p-3 font-mono text-xs leading-relaxed text-slate-200 focus:outline-none focus:border-fuchsia-500/60 resize-y"
          placeholder="PERSONAJE (acotación): Texto a locutar..."
        />

        <div className="text-[11px] text-slate-500 leading-relaxed">
          <span className="font-bold text-slate-400">Formato:</span>{" "}
          <code className="text-fuchsia-300">PERSONAJE: texto</code> ·{" "}
          <code className="text-fuchsia-300">PERSONAJE (tono): texto</code> ·{" "}
          <code className="text-fuchsia-300">(susurrando)</code> acotación en línea ·{" "}
          <code className="text-fuchsia-300">[PAUSA 1.5s]</code> silencio ·{" "}
          <code className="text-fuchsia-300"># comentario</code> se ignora. Las líneas sin personaje continúan al anterior.
        </div>
      </div>

      {/* Panel de reparto y generación */}
      <div className="lg:col-span-5 flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-2">
          <Stat icon={<Users className="w-3.5 h-3.5" />} label="Voces" value={String(speakers.length)} />
          <Stat icon={<Layers className="w-3.5 h-3.5" />} label="Líneas" value={`${lineCount} · ${blockCount} bloques`} />
          <Stat icon={<Clock className="w-3.5 h-3.5" />} label="Duración est." value={formatDuration(estimateDurationSeconds(segments))} />
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
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
                onChange={(e) => setVoices((v) => ({ ...v, [speaker]: e.target.value }))}
                className="bg-slate-950 border border-slate-800 rounded-md px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-fuchsia-500/60"
              >
                {VOICES.map((v) => (
                  <option key={v.name} value={v.name}>{v.name} — {v.tone}</option>
                ))}
              </select>
            </div>
          ))}

          <label className="flex flex-col gap-1 mt-1">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Dirección general</span>
            <input
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              maxLength={500}
              placeholder="Ej.: tono cálido de radio, ritmo pausado"
              className="bg-slate-950 border border-slate-800 rounded-md px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-fuchsia-500/60"
            />
          </label>

          <button
            onClick={handleGenerate}
            disabled={loading || !lineCount}
            className="mt-1 px-4 py-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-2 bg-fuchsia-600 text-white hover:bg-fuchsia-500 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {loading ? `Generando ${blockCount} bloque(s)...` : "Generar audio"}
          </button>

          {error && (
            <div className="flex gap-2 text-[11px] text-rose-300 bg-rose-950/40 border border-rose-900/50 rounded-md p-2">
              <AlertCircle className="w-4 h-4 shrink-0" /> {error}
            </div>
          )}
        </div>

        {audioUrl && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Resultado</h3>
            <audio controls src={audioUrl} className="w-full" />
            <a
              href={audioUrl}
              download="locucion.wav"
              className="px-3 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-2 bg-slate-950 border border-slate-800 text-slate-200 hover:border-slate-700"
            >
              <Download className="w-4 h-4" /> Descargar WAV
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-2.5">
      <div className="flex items-center gap-1.5 text-slate-500 text-[10px] font-bold uppercase tracking-wide">
        {icon} {label}
      </div>
      <div className="text-xs font-bold text-slate-200 mt-1">{value}</div>
    </div>
  );
}
