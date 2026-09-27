import { useState } from "react";
import { AudioLines, FolderOpen, Zap } from "lucide-react";
import AudioScriptStudio from "./components/AudioScriptStudio";
import ProjectsView from "./components/ProjectsView";

type Tab = "projects" | "quick";

export default function App() {
  const [tab, setTab] = useState<Tab>("projects");

  const tabClass = (active: boolean) =>
    `px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-2 cursor-pointer ${
      active ? "bg-fuchsia-600 text-white" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
    }`;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-fuchsia-500/30">
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-md sticky top-0 z-50 px-4 md:px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-fuchsia-600 rounded-xl text-white">
              <AudioLines className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base font-black tracking-tight">Audios Profesionales</h1>
              <p className="text-[11px] text-slate-400">Guiones convertidos en locuciones con dirección de voz.</p>
            </div>
          </div>
          <nav className="flex gap-1 bg-slate-950 border border-slate-800 rounded-xl p-1">
            <button onClick={() => setTab("projects")} className={tabClass(tab === "projects")}>
              <FolderOpen className="w-4 h-4" /> Proyectos
            </button>
            <button onClick={() => setTab("quick")} className={tabClass(tab === "quick")}>
              <Zap className="w-4 h-4" /> Audio rápido
            </button>
          </nav>
        </div>
      </header>
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6">
        {tab === "projects" ? <ProjectsView /> : <AudioScriptStudio />}
      </main>
    </div>
  );
}
