/**
 * FullTask AI Tutor v6.7 — Backend
 */
import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import fetch from "node-fetch";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Optional Redis, Firebase, pdf-parse
let Redis = null, redisClient = null, firebaseAdmin = null, pdfParse = null;
if (process.env.REDIS_URL) {
  Redis = await import("redis").then(m => m.default);
  redisClient = Redis.createClient({ url: process.env.REDIS_URL });
  redisClient.on("error", e => console.error("Redis error", e));
  await redisClient.connect();
}
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  const admin = await import("firebase-admin").then(m => m.default);
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(sa) });
  firebaseAdmin = admin;
}
try {
  pdfParse = await import("pdf-parse").then(m => m.default || m);
} catch (e) {
  // pdf-parse optional
}

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(rateLimit({ windowMs: 10 * 1000, max: 60 }));

const upload = multer({ dest: path.join(__dirname, "uploads/") });
if (!fs.existsSync(path.join(__dirname, "uploads"))) fs.mkdirSync(path.join(__dirname, "uploads"));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY");
  process.exit(1);
}
const OWNER_NAME = process.env.OWNER_NAME || "Akin S. Sokpah";
const OWNER_LOCATION = process.env.OWNER_LOCATION || "Liberia";
const APP_VERSION = process.env.APP_VERSION || "v6.7";
const MODEL = process.env.MODEL || "gpt-4o-mini";

const sessions = new Map();
function ensureSession(id = "anon") {
  if (!redisClient) {
    if (!sessions.has(id)) sessions.set(id, []);
    return sessions.get(id);
  }
  return null;
}
function basicSafetyCheck(text) {
  if (!text) return true;
  const banned = ["bomb", "terrorist", "kill", "harm", "attack"];
  const low = text.toLowerCase();
  return !banned.some(b => low.includes(b));
}
function systemPrompt(subject = "General", tone = "teaching") {
  return `You are FullTask AI Tutor (version ${APP_VERSION}). Subject: ${subject}. Tone: ${tone}. If asked who created you, reply: "${OWNER_NAME} from ${OWNER_LOCATION}". Provide step-by-step explanations and examples.`;
}

async function callOpenAI(messages, opts = {}) {
  const body = {
    model: opts.model || MODEL,
    messages,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.max_tokens ?? 800,
    top_p: opts.top_p ?? 1,
  };
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error("OpenAI error: " + text);
  }
  return resp.json();
}

async function verifyFirebaseToken(req, res, next) {
  if (!firebaseAdmin) return next();
  const token = req.headers["authorization"]?.split("Bearer ")[1] || req.headers["x-id-token"];
  if (!token) return res.status(401).json({ error: "Missing token" });
  try {
    const decoded = await firebaseAdmin.auth().verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (e) {
    console.error("Firebase token error", e);
    res.status(401).json({ error: "Invalid token" });
  }
}

// Endpoints:

app.get("/health", (req, res) => res.json({ status: "ok", version: APP_VERSION }));

app.post("/api/chat", verifyFirebaseToken, async (req, res) => {
  try {
    const { sessionId = "anon", subject = "General", mode = "concise", tone = "teaching", message } = req.body;
    if (!message) return res.status(400).json({ error: "No message" });
    if (!basicSafetyCheck(message)) return res.status(400).json({ error: "Unsafe content" });

    const low = message.toLowerCase();
    if (low.includes("who created you") || low.includes("who built you")) {
      const reply = `${OWNER_NAME} from ${OWNER_LOCATION}. (FullTask AI Tutor)`;
      if (redisClient) {
        await redisClient.rPush(`sess:${sessionId}`, JSON.stringify({ role: "assistant", content: reply }));
      } else {
        const sess = ensureSession(sessionId);
        sess.push({ role: "assistant", content: reply });
      }
      return res.json({ reply });
    }

    const messages = [{ role: "system", content: systemPrompt(subject, tone) }];
    if (redisClient) {
      const raw = await redisClient.lRange(`sess:${sessionId}`, 0, -1);
      for (const r of raw) messages.push(JSON.parse(r));
    } else {
      const sess = ensureSession(sessionId);
      for (const m of sess) messages.push(m);
    }

    messages.push({ role: "user", content: mode === "deep" ? `${message}\n\nPlease answer step-by-step.` : message });

    const j = await callOpenAI(messages);
    const reply = j.choices[0].message.content;

    // store
    if (redisClient) {
      await redisClient.rPush(`sess:${sessionId}`, JSON.stringify({ role: "user", content: message }));
      await redisClient.rPush(`sess:${sessionId}`, JSON.stringify({ role: "assistant", content: reply }));
    } else {
      const sess = ensureSession(sessionId);
      sess.push({ role: "user", content: message });
      sess.push({ role: "assistant", content: reply });
    }

    res.json({ reply });
  } catch (e) {
    console.error("chat error", e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/generate-quiz", verifyFirebaseToken, async (req, res) => {
  try {
    const { topic = "", count = 5 } = req.body;
    if (!topic) return res.status(400).json({ error: "Topic required" });
    const prompt = `Make ${count} multiple choice questions about "${topic}", with four options each, correct answer, and a brief explanation.`;
    const j = await callOpenAI([
      { role: "system", content: systemPrompt("Quiz", "teaching") },
      { role: "user", content: prompt }
    ]);
    const out = j.choices[0].message.content;
    res.json({ quiz: out });
  } catch (e) {
    console.error("quiz error", e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/flashcards", verifyFirebaseToken, async (req, res) => {
  try {
    const { topic = "", count = 10 } = req.body;
    if (!topic) return res.status(400).json({ error: "Topic required" });
    const prompt = `Generate ${count} flashcards for "${topic}". Provide front and back.`;
    const j = await callOpenAI([
      { role: "system", content: systemPrompt("Flashcards", "teaching") },
      { role: "user", content: prompt }
    ]);
    const out = j.choices[0].message.content;
    res.json({ flashcards: out });
  } catch (e) {
    console.error("flashcards error", e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/upload", verifyFirebaseToken, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file sent" });
    const data = fs.readFileSync(req.file.path);
    if (req.file.mimetype === "application/pdf" && pdfParse) {
      const parsed = await pdfParse(data);
      const text = parsed.text;
      const j = await callOpenAI([
        { role: "system", content: systemPrompt("PDFParser", "teaching") },
        { role: "user", content: `Summarize this document:\n\n${text.slice(0, 15000)}` }
      ], { max_tokens: 600 });
      fs.unlinkSync(req.file.path);
      return res.json({ text, summary: j.choices[0].message.content });
    } else {
      fs.unlinkSync(req.file.path);
      return res.json({ message: "File received but not a PDF" });
    }
  } catch (e) {
    console.error("upload error", e);
    res.status(500).json({ error: "Server error" });
  }
});

// Serve static frontend
app.use(express.static(path.join(__dirname, "public")));

// SPA fallback
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`FullTask AI Tutor ${APP_VERSION} listening on ${PORT}`));
