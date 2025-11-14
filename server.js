/**
 * FullTask AI Tutor v6.7
 * server.js
 *
 * Single-file backend implementing many features and scaffolds.
 *
 * Requirements:
 * - Node 18+ (fetch available)
 * - Optional: Redis (REDIS_URL), Firebase (FIREBASE_SERVICE_ACCOUNT)
 *
 * Env vars:
 * - OPENAI_API_KEY (required)
 * - APP_VERSION (v6.7)
 * - OWNER_NAME (Akin S. Sokpah)
 * - OWNER_LOCATION (Liberia)
 * - MODEL (default gpt-4o-mini)
 * - REDIS_URL (optional)
 * - FIREBASE_SERVICE_ACCOUNT (optional, stringified JSON)
 * - PORT
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

// optional imports will be loaded conditionally
let Redis = null;
let redisClient = null;
let firebaseAdmin = null;
let pdfParse = null;

// Load optional modules conditionally
if (process.env.REDIS_URL) {
  Redis = await import("redis").then(m => m.default);
  redisClient = Redis.createClient({ url: process.env.REDIS_URL });
  redisClient.on("error", (e) => console.error("Redis error", e));
  await redisClient.connect();
  console.log("Redis connected");
}

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  const admin = await import("firebase-admin").then(m => m.default);
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(sa) });
  firebaseAdmin = admin;
  console.log("Firebase Admin initialized");
}

try {
  pdfParse = await import("pdf-parse").then(m => m.default || m);
  console.log("pdf-parse loaded");
} catch (e) {
  console.log("pdf-parse not installed or failed to load (it's optional).");
}

const app = express();
app.use(helmet());
app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(rateLimit({ windowMs: 10 * 1000, max: 60 }));

// multer upload
const upload = multer({ dest: path.join(__dirname, "uploads/") });
if (!fs.existsSync(path.join(__dirname, "uploads"))) fs.mkdirSync(path.join(__dirname, "uploads"));

// config
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY missing. Set it in env.");
  process.exit(1);
}
const OWNER_NAME = process.env.OWNER_NAME || "Akin S. Sokpah";
const OWNER_LOCATION = process.env.OWNER_LOCATION || "Liberia";
const APP_VERSION = process.env.APP_VERSION || "v6.7";
const MODEL = process.env.MODEL || "gpt-4o-mini";

const sessions = new Map(); // fallback in-memory sessions

function ensureSession(sessionId = "anon") {
  if (!redisClient) {
    if (!sessions.has(sessionId)) sessions.set(sessionId, []);
    return sessions.get(sessionId);
  }
  return null; // use redis flow outside
}

function basicSafetyCheck(text) {
  if (!text) return true;
  const banned = ["bomb", "terrorist", "kill", "harm", "attack"];
  const low = text.toLowerCase();
  return !banned.some(b => low.includes(b));
}

function systemPromptFor(subject = "General", tone = "teaching") {
  return `You are FullTask AI Tutor (version ${APP_VERSION}). You are a friendly, precise tutor specialized in ${subject}. If asked who created you, reply: "${OWNER_NAME} from ${OWNER_LOCATION}". Tone: ${tone}. Provide step-by-step explanations, examples, and study aids as requested.`;
}

// Firebase admin verify middleware
async function verifyFirebaseToken(req, res, next) {
  if (!firebaseAdmin) return next();
  const idToken = req.headers["authorization"]?.split("Bearer ")[1] || req.headers["x-id-token"];
  if (!idToken) return res.status(401).json({ error: "Missing id token" });
  try {
    const decoded = await firebaseAdmin.auth().verifyIdToken(idToken);
    req.user = decoded;
    return next();
  } catch (err) {
    console.error("Firebase token verify error", err);
    return res.status(401).json({ error: "Invalid id token" });
  }
}

// OpenAI call helper (chat completions)
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
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error("OpenAI error: " + txt);
  }
  return resp.json();
}

// Basic attribution quick check
function isAttributionQ(text) {
  const t = text.toLowerCase();
  return t.includes("who created you") || t.includes("who made you") || t.includes("who built you");
}

// ========== Endpoints ==========

// Health
app.get("/health", (req, res) => res.json({ status: "ok", version: APP_VERSION }));

// Chat (multi-turn)
app.post("/api/chat", verifyFirebaseToken, async (req, res) => {
  try {
    const { sessionId = "anon", subject = "General", mode = "concise", tone = "teaching", message } = req.body || {};
    if (!message) return res.status(400).json({ error: "message required" });
    if (!basicSafetyCheck(message)) return res.status(400).json({ error: "Message failed safety" });

    if (isAttributionQ(message)) {
      const reply = `${OWNER_NAME} from ${OWNER_LOCATION} (FullTask AI Tutor ${APP_VERSION})`;
      if (redisClient) {
        await redisClient.rPush(`sess:${sessionId}`, JSON.stringify({ role: "user", content: message }));
        await redisClient.rPush(`sess:${sessionId}`, JSON.stringify({ role: "assistant", content: reply }));
      } else {
        const s = ensureSession(sessionId);
        s.push({ role: "user", content: message });
        s.push({ role: "assistant", content: reply });
      }
      return res.json({ reply, meta: { version: APP_VERSION } });
    }

    // Build messages (include session history)
    const messages = [{ role: "system", content: systemPromptFor(subject, tone) }];
    if (redisClient) {
      const raw = await redisClient.lRange(`sess:${sessionId}`, 0, -1);
      for (const r of raw) messages.push(JSON.parse(r));
    } else {
      const s = ensureSession(sessionId);
      for (const m of s) messages.push(m);
    }

    const userContent = mode === "deep" ? `${message}\n\nPlease answer step-by-step with examples.` : `${message}\n\nBe concise.`;
    messages.push({ role: "user", content: userContent });

    const j = await callOpenAI(messages);
    const assistantText = j.choices?.[0]?.message?.content || "No response";

    // store
    if (redisClient) {
      await redisClient.rPush(`sess:${sessionId}`, JSON.stringify({ role: "user", content: message }));
      await redisClient.rPush(`sess:${sessionId}`, JSON.stringify({ role: "assistant", content: assistantText }));
      await redisClient.lTrim(`sess:${sessionId}`, -48, -1);
    } else {
      const s = ensureSession(sessionId);
      s.push({ role: "user", content: message });
      s.push({ role: "assistant", content: assistantText });
      if (s.length > 48) s.splice(0, s.length - 24);
    }

    return res.json({ reply: assistantText, meta: { model: MODEL } , raw: j});
  } catch (err) {
    console.error("chat err", err);
    return res.status(500).json({ error: "server error", details: String(err) });
  }
});

// Stream fetch proxy (supports Authorization header)
app.post("/api/stream-fetch", verifyFirebaseToken, async (req, res) => {
  try {
    const { sessionId = "anon", subject = "General", mode = "concise", tone="teaching", message } = req.body || {};
    if (!message) return res.status(400).json({ error: "message required" });

    const messages = [{ role: "system", content: systemPromptFor(subject, tone) }];
    if (redisClient) {
      const raw = await redisClient.lRange(`sess:${sessionId}`, 0, -1);
      for (const r of raw) messages.push(JSON.parse(r));
    } else {
      const s = ensureSession(sessionId);
      for (const m of s) messages.push(m);
    }
    messages.push({ role: "user", content: mode === "deep" ? `${message}\n\nPlease answer step-by-step.` : `${message}\n\nBe concise.` });

    // OpenAI streaming request
    const openaiResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ model: MODEL, messages, stream: true, temperature: 0.2 }),
    });

    if (!openaiResp.ok) {
      const t = await openaiResp.text();
      return res.status(502).json({ error: "OpenAI stream error", details: t });
    }

    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });

    const reader = openaiResp.body.getReader();
    const decoder = new TextDecoder();
    let assistantText = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        const chunk = decoder.decode(value, { stream: true });
        assistantText += chunk;
        res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
      }
    }
    res.write("event: done\ndata: {}\n\n");
    res.end();

    // store final assistantText into session (best-effort; may contain streaming markers)
    if (redisClient) {
      await redisClient.rPush(`sess:${sessionId}`, JSON.stringify({ role: "user", content: message }));
      await redisClient.rPush(`sess:${sessionId}`, JSON.stringify({ role: "assistant", content: assistantText }));
    } else {
      const s = ensureSession(sessionId);
      s.push({ role: "user", content: message });
      s.push({ role: "assistant", content: assistantText });
    }
  } catch (err) {
    console.error("stream-fetch err", err);
    return res.status(500).json({ error: "stream fetch error", details: String(err) });
  }
});

// SSE simple stream (unauthenticated demo)
app.get("/api/stream", async (req, res) => {
  try {
    const message = req.query.message;
    if (!message) return res.status(400).json({ error: "message required" });

    // For demo, call openai non-streaming then send sentence chunks
    const messages = [{ role: "system", content: systemPromptFor("General") }, { role: "user", content: message }];
    const j = await callOpenAI(messages);
    const assistantText = j.choices?.[0]?.message?.content || "No response";
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });

    const sentences = assistantText.match(/[^.!?]+[.!?]+|\s*[^.!?]+$/g) || [assistantText];
    for (const s of sentences) {
      res.write(`data: ${JSON.stringify({ chunk: s.trim() })}\n\n`);
      await new Promise(r => setTimeout(r, 120));
    }
    res.write("event: done\ndata: {}\n\n");
    res.end();
  } catch (err) {
    console.error("sse err", err);
    res.status(500).json({ error: "sse error", details: String(err) });
  }
});

// Generate Quiz (MCQ)
app.post("/api/generate-quiz", verifyFirebaseToken, async (req, res) => {
  try {
    const { topic = "", count = 5, difficulty = "medium" } = req.body || {};
    if (!topic) return res.status(400).json({ error: "topic required" });

    const prompt = `Create ${count} multiple choice questions (A-D) about "${topic}" with difficulty ${difficulty}. Return a JSON array with objects: {question, options:[A,B,C,D], answer: "A", explanation: "..." }.`;
    const messages = [{ role: "system", content: systemPromptFor("QuizGenerator") }, { role: "user", content: prompt }];
    const j = await callOpenAI(messages);
    const out = j.choices?.[0]?.message?.content || "";
    // Attempt to extract JSON
    try {
      const idx = out.indexOf("[");
      const parsed = JSON.parse(out.slice(idx));
      return res.json({ quiz: parsed });
    } catch (e) {
      return res.json({ raw: out });
    }
  } catch (err) {
    console.error("quiz err", err);
    return res.status(500).json({ error: "server error", details: String(err) });
  }
});

// Essay grader
app.post("/api/essay-grade", verifyFirebaseToken, async (req, res) => {
  try {
    const { essay = "", rubric = "" } = req.body || {};
    if (!essay) return res.status(400).json({ error: "essay required" });

    const prompt = `Grade this essay out of 100. Provide rubric (content, structure, grammar), strengths, weaknesses, and suggestions.\n\nEssay:\n${essay}\n\n${rubric}`;
    const j = await callOpenAI([{ role: "system", content: systemPromptFor("EssayGrader") }, { role: "user", content: prompt }], { max_tokens: 700 });
    return res.json({ feedback: j.choices?.[0]?.message?.content || "" });
  } catch (err) {
    console.error("essay err", err);
    return res.status(500).json({ error: "server error", details: String(err) });
  }
});

// Summarizer
app.post("/api/summary", verifyFirebaseToken, async (req, res) => {
  try {
    const { text = "", length = "short" } = req.body || {};
    if (!text) return res.status(400).json({ error: "text required" });
    const prompt = `Summarize the following text in a ${length} summary:\n\n${text}`;
    const j = await callOpenAI([{ role: "system", content: systemPromptFor("Summarizer") }, { role: "user", content: prompt }], { max_tokens: 400 });
    return res.json({ summary: j.choices?.[0]?.message?.content || "" });
  } catch (err) {
    console.error("summary err", err);
    return res.status(500).json({ error: "server error", details: String(err) });
  }
});

// Translator
app.post("/api/translate", verifyFirebaseToken, async (req, res) => {
  try {
    const { text = "", to = "en" } = req.body || {};
    if (!text) return res.status(400).json({ error: "text required" });
    const prompt = `Translate to ${to}:\n\n${text}`;
    const j = await callOpenAI([{ role: "system", content: systemPromptFor("Translator") }, { role: "user", content: prompt }], { max_tokens: 400 });
    return res.json({ translated: j.choices?.[0]?.message?.content || "" });
  } catch (err) {
    console.error("translate err", err);
    return res.status(500).json({ error: "server error", details: String(err) });
  }
});

// Flashcard generator
app.post("/api/flashcards", verifyFirebaseToken, async (req, res) => {
  try {
    const { topic = "", count = 10 } = req.body || {};
    if (!topic) return res.status(400).json({ error: "topic required" });
    const prompt = `Create ${count} flashcards for the topic "${topic}". Return JSON array [{front: "...", back: "..."}]`;
    const j = await callOpenAI([{ role: "system", content: systemPromptFor("Flashcards") }, { role: "user", content: prompt }], { max_tokens: 500 });
    const out = j.choices?.[0]?.message?.content || "";
    try {
      const idx = out.indexOf("[");
      const parsed = JSON.parse(out.slice(idx));
      return res.json({ flashcards: parsed });
    } catch (e) {
      return res.json({ raw: out });
    }
  } catch (err) {
    console.error("flashcards err", err);
    return res.status(500).json({ error: "server error", details: String(err) });
  }
});

// Spaced repetition scheduler scaffold
app.post("/api/srs/generate", verifyFirebaseToken, async (req, res) => {
  try {
    const { flashcards = [], startDate = new Date().toISOString() } = req.body || {};
    // simple scaffold: schedule intervals using SM-2 style via prompts (server-side logic recommended)
    const schedule = flashcards.map((f, i) => ({ front: f.front, back: f.back, due: new Date(Date.now() + (i+1)*24*3600*1000).toISOString() }));
    return res.json({ schedule });
  } catch (err) {
    console.error("srs err", err);
    return res.status(500).json({ error: "server error", details: String(err) });
  }
});

// Reference generator (APA/MLA)
app.post("/api/reference", verifyFirebaseToken, async (req, res) => {
  try {
    const { text = "", style = "APA" } = req.body || {};
    if (!text) return res.status(400).json({ error: "text required" });
    const prompt = `Extract references from the text and format them in ${style} style. Text:\n\n${text}`;
    const j = await callOpenAI([{ role: "system", content: systemPromptFor("ReferenceGenerator") }, { role: "user", content: prompt }], { max_tokens: 400 });
    return res.json({ references: j.choices?.[0]?.message?.content || "" });
  } catch (err) {
    console.error("ref err", err);
    return res.status(500).json({ error: "server error", details: String(err) });
  }
});

// Hint generator
app.post("/api/hint", verifyFirebaseToken, async (req, res) => {
  try {
    const { question = "", level = "small" } = req.body || {};
    if (!question) return res.status(400).json({ error: "question required" });
    const prompt = `Provide a ${level} hint for this question: ${question}`;
    const j = await callOpenAI([{ role: "system", content: systemPromptFor("HintGenerator") }, { role: "user", content: prompt }], { max_tokens: 180 });
    return res.json({ hint: j.choices?.[0]?.message?.content || "" });
  } catch (err) {
    console.error("hint err", err);
    return res.status(500).json({ error: "server error", details: String(err) });
  }
});

// Resource recommender
app.post("/api/recommend", verifyFirebaseToken, async (req, res) => {
  try {
    const { topic = "", level = "beginner" } = req.body || {};
    const prompt = `Recommend books, videos, websites for ${topic} for ${level} learners. Return JSON {books:[], videos:[], links:[]}`;
    const j = await callOpenAI([{ role: "system", content: systemPromptFor("Recommender") }, { role: "user", content: prompt }], { max_tokens: 400 });
    const out = j.choices?.[0]?.message?.content || "";
    try {
      const idx = out.indexOf("{");
      const parsed = JSON.parse(out.slice(idx));
      return res.json({ recs: parsed });
    } catch (e) {
      return res.json({ raw: out });
    }
  } catch (err) {
    console.error("recommend err", err);
    return res.status(500).json({ error: "server error", details: String(err) });
  }
});

// File upload with PDF parsing and summarization
app.post("/api/upload", verifyFirebaseToken, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "file required" });
    const data = fs.readFileSync(req.file.path);
    if (req.file.mimetype === "application/pdf" && pdfParse) {
      const parsed = await pdfParse(data);
      const text = parsed.text || "";
      const j = await callOpenAI([{ role: "system", content: systemPromptFor("PDFParser") }, { role: "user", content: `Summarize the following document:\n\n${text.slice(0, 15000)}` }], { max_tokens: 600 });
      fs.unlinkSync(req.file.path);
      return res.json({ extracted_text: text, summary: j.choices?.[0]?.message?.content || "" });
    } else {
      // other file types: return names
      fs.unlinkSync(req.file.path);
      return res.json({ ok: true, filename: req.file.filename, originalname: req.file.originalname });
    }
  } catch (err) {
    console.error("upload parse error", err);
    return res.status(500).json({ error: "upload error", details: String(err) });
  }
});

// History endpoint
app.get("/api/history", verifyFirebaseToken, async (req, res) => {
  try {
    const { sessionId = "anon" } = req.query;
    if (redisClient) {
      const raw = await redisClient.lRange(`sess:${sessionId}`, 0, -1);
      const parsed = raw.map(r => JSON.parse(r));
      return res.json({ history: parsed });
    } else {
      const s = sessions.get(sessionId) || [];
      return res.json({ history: s });
    }
  } catch (err) {
    console.error("history err", err);
    return res.status(500).json({ error: "server error", details: String(err) });
  }
});

// Admin stats scaffold
app.get("/api/admin/stats", verifyFirebaseToken, async (req, res) => {
  try {
    // if firebaseAdmin, check uid is admin (you should implement admin claims)
    const stats = {
      activeSessions: redisClient ? await redisClient.dbSize?.() : sessions.size,
      env: { model: MODEL },
      version: APP_VERSION,
    };
    return res.json({ stats });
  } catch (err) {
    console.error("admin stats err", err);
    return res.status(500).json({ error: "server error", details: String(err) });
  }
});

// Image generation scaffold (calls OpenAI Images if available)
// Note: you must ensure your OpenAI account can generate images with the model you choose
app.post("/api/image-gen", verifyFirebaseToken, async (req, res) => {
  try {
    const { prompt = "", size = "1024x1024", n = 1 } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "prompt required" });

    // Example: call OpenAI images endpoint (if supported)
    // This is a scaffold; update endpoint or client based on your image API.
    const body = { prompt, n, size };
    // For demo we will ask chat model to return "image generation instructions" - real image call omitted
    const j = await callOpenAI([{ role: "system", content: systemPromptFor("ImageGen") }, { role: "user", content: `Create an image generation specification for: ${prompt}` }], { max_tokens: 200 });
    return res.json({ spec: j.choices?.[0]?.message?.content || "" });
  } catch (err) {
    console.error("image-gen err", err);
    return res.status(500).json({ error: "server error", details: String(err) });
  }
});

// Code explain / debug (explain-only)
app.post("/api/code-explain", verifyFirebaseToken, async (req, res) => {
  try {
    const { code = "", language = "javascript", question = "" } = req.body || {};
    if (!code) return res.status(400).json({ error: "code required" });

    // IMPORTANT: we do NOT execute user code on server. We only explain and propose fixes.
    const prompt = `You are a code assistant. Explain the following ${language} code and point out bugs or improvement suggestions. If the user asked a specific question, answer it.\n\nCode:\n${code}\n\nQuestion:${question}`;
    const j = await callOpenAI([{ role: "system", content: systemPromptFor("CodeHelper") }, { role: "user", content: prompt }], { max_tokens: 700 });
    return res.json({ explanation: j.choices?.[0]?.message?.content || "" });
  } catch (err) {
    console.error("code explain err", err);
    return res.status(500).json({ error: "server error", details: String(err) });
  }
});

// Plagiarism check scaffold
app.post("/api/plagiarism-check", verifyFirebaseToken, async (req, res) => {
  try {
    const { text = "" } = req.body || {};
    if (!text) return res.status(400).json({ error: "text required" });
    // simplistic similarity-based heuristic: ask model to check for originality
    const prompt = `Check whether the following text appears plagiarized or copied. Provide a short verdict (Likely Original / Possibly Plagiarized / Needs Manual Check) and highlight suspicious phrases.\n\nText:\n${text}`;
    const j = await callOpenAI([{ role: "system", content: systemPromptFor("PlagiarismChecker") }, { role: "user", content: prompt }], { max_tokens: 400 });
    return res.json({ result: j.choices?.[0]?.message?.content || "" });
  } catch (err) {
    console.error("plag err", err);
    return res.status(500).json({ error: "server", details: String(err) });
  }
});

// Save user profile (Firestore)
app.post("/api/user/save", verifyFirebaseToken, async (req, res) => {
  try {
    if (!firebaseAdmin) return res.status(400).json({ error: "firebase not configured" });
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "no uid" });
    const { profile = {} } = req.body || {};
    const db = firebaseAdmin.firestore();
    await db.collection("users").doc(uid).set({ profile, updatedAt: Date.now() }, { merge: true });
    return res.json({ ok: true });
  } catch (err) {
    console.error("user save err", err);
    return res.status(500).json({ error: "server", details: String(err) });
  }
});

// Get user progress
app.get("/api/user/progress", verifyFirebaseToken, async (req, res) => {
  try {
    if (!firebaseAdmin) return res.status(400).json({ error: "firebase not configured" });
    const uid = req.user?.uid;
    const db = firebaseAdmin.firestore();
    const doc = await db.collection("users").doc(uid).get();
    return res.json({ data: doc.exists ? doc.data() : {} });
  } catch (err) {
    console.error("user progress err", err);
    return res.status(500).json({ error: "server", details: String(err) });
  }
});

// Export history CSV
app.get("/api/export/csv", verifyFirebaseToken, async (req, res) => {
  try {
    const { sessionId = "anon" } = req.query;
    let history = [];
    if (redisClient) {
      const raw = await redisClient.lRange(`sess:${sessionId}`, 0, -1);
      history = raw.map(r => JSON.parse(r));
    } else {
      history = sessions.get(sessionId) || [];
    }
    // CSV: role,content
    const csv = history.map(h => `"${h.role.replace(/"/g,'""')}","${(h.content||"").replace(/"/g,'""')}"`).join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="history-${sessionId}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error("export csv err", err);
    res.status(500).json({ error: "server", details: String(err) });
  }
});

// Clear session (admin/test)
app.post("/api/clear-session", verifyFirebaseToken, async (req, res) => {
  try {
    const { sessionId = "anon" } = req.body || {};
    if (redisClient) await redisClient.del(`sess:${sessionId}`);
    else sessions.delete(sessionId);
    return res.json({ ok: true });
  } catch (err) {
    console.error("clear sess err", err);
    return res.status(500).json({ error: "server", details: String(err) });
  }
});

// A/B toggle scaffold (store flags in redis)
app.post("/api/feature-toggle", verifyFirebaseToken, async (req, res) => {
  try {
    const { key, value } = req.body || {};
    if (!key) return res.status(400).json({ error: "key required" });
    if (!redisClient) return res.status(400).json({ error: "redis required for feature flags" });
    await redisClient.hSet("feature_flags", key, JSON.stringify(value));
    return res.json({ ok: true });
  } catch (err) {
    console.error("toggle err", err);
    res.status(500).json({ error: "server", details: String(err) });
  }
});

// Serve static
app.use(express.static(path.join(__dirname, "public")));

// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FullTask AI Tutor ${APP_VERSION} listening on ${PORT}`));
