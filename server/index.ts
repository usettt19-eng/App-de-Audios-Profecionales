import express from "express";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { generateScriptAudio, MAX_SCRIPT_CHARS } from "./scriptAudio";

dotenv.config();

let ai: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!ai) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("Falta la variable de entorno GEMINI_API_KEY.");
    ai = new GoogleGenAI({ apiKey });
  }
  return ai;
}

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/script-audio", async (req, res) => {
  try {
    const { script, voices, style } = req.body;
    if (typeof script !== "string" || !script.trim()) {
      return res.status(400).json({ error: "El guion está vacío." });
    }
    if (script.length > MAX_SCRIPT_CHARS) {
      return res.status(400).json({ error: `El guion supera el máximo de ${MAX_SCRIPT_CHARS} caracteres.` });
    }

    const { wav, blocks, speakers } = await generateScriptAudio(getGeminiClient(), {
      script,
      voices: voices && typeof voices === "object" ? voices : {},
      style: typeof style === "string" ? style.slice(0, 500) : undefined,
    });

    res.set({
      "Content-Type": "audio/wav",
      "Content-Length": String(wav.length),
      "X-Audio-Blocks": String(blocks),
      "X-Audio-Speakers": encodeURIComponent(speakers.join(",")),
    });
    res.send(wav);
  } catch (error: any) {
    console.error("Script Audio Error:", error);
    res.status(500).json({ error: error.message || "Error al generar el audio del guion." });
  }
});

async function start() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer } = await import("vite");
    const vite = await createServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, "0.0.0.0", () => {
    console.log(`Generador de audio escuchando en http://localhost:${port}`);
  });
}

start();
