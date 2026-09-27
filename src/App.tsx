import { AudioLines } from "lucide-react";
import AudioScriptStudio from "./components/AudioScriptStudio";

export default function App() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-fuchsia-500/30">
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-md sticky top-0 z-50 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center gap-3">
          <div className="p-2 bg-fuchsia-600 rounded-xl text-white">
            <AudioLines className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tight">Generador de Audio desde Guiones</h1>
            <p className="text-xs text-slate-400">Escribe o carga un guion, asigna una voz a cada personaje y descarga la locución en WAV.</p>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6">
        <AudioScriptStudio />
      </main>
    </div>
  );
}
