/**
 * FullTask AI Tutor v6.7
 * server.js
 *
 * Node 18+ ESM backend.
 * Serves static frontend from /public with SPA fallback.
 *
 * Env:
 * - OPENAI_API_KEY (required)
 * - APP_VERSION (optional)
 * - OWNER_NAME, OWNER_LOCATION (optional)
 * - MODEL (optional)
 * - PORT (optional)
 * - REDIS_URL (optional)
 * - FIREBASE_SERVICE_ACCOUNT (optional, stringified JSON)
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

let Redis = null;
let redisClient = null;
let firebaseAdmin = null;
let pdfParse = null;

if (process.env.REDIS_URL) {
  Redis = await import("redis").then(m => m.default);
  redisClient = Redis.createClient({ url: process.env.REDIS_URL });
  redisClient.on("error", e => console.error("Redis error", e));
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
  // optional
}

const app = express();
app.use(helmet());
app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// rate limiter
app.use(rateLimit({ windowMs: 10 * 1000, max: 60 }));

// multer upload dir
const upload = multer({ dest: path.join(__dirname, "uploads/") });
if (!fs.existsSync(path.join(__dirname, "uploads"))) fs.mkdirSync(path.join(__dirname, "uploads"));

// Env defaults
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY missing. Exiting.");
  process.exit(1);
}
const OWNER_NAME = process.env.OWNER_NAME || "Akin S. Sokpah";
const OWNER_LOCATION = process.env.OWNER_LOCATION || "Liberia";
const APP_VERSION = process.env.APP_VERSION || "v6.7";
const MODEL = process.env.MODEL || "gpt-4o-mini";

// simple in-memory fallback
const sessions = new Map();

function ensureSession(sessionId = "anon") {
  if (redisClient) return null;
  if (!sessions.has(sessionId)) sessions.set(sessionId, []);
  return sessions.get(sessionId);
}

function basicSafetyCheck(text) {
  if (!text) return true;
  const banned = ["bomb", "terrorist", "kill", "harm", "attack"];
  const low = text.toLowerCase();
  return !banned.some(b => low.includes(b));
}

function systemPromptFor(subject = "General", tone = "teaching") {
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
    const txt = await resp.text();
    throw new Error("OpenAI API error: " + txt);
  }
  return resp.json();
}

// optional Firebase token verification middleware
async function verifyFirebaseToken(req, res, next) {
  if (!firebaseAdmin) return next();
  const idToken = req.headers["authorization"]?.split("Bearer ")[1] || req.headers["x-id-token"];
  if (!idToken) return res.status(401).json({ error: "missing id token" });
  try {
    const decoded = await firebaseAdmin.auth().verifyIdToken(idToken);
    req.user = decoded;
    return next();
  } catch (err) {
    console.error("Firebase verify error", err);
    return res.status(401).json({ error: "invalid id token" });
  }
}

/* ---------- Endpoints ---------- */

app.get("/health", (req, res) => res.json({ status: "ok", version: APP_VERSION }));

app.post("/api/chat", verifyFirebaseToken, async (req, res) => {
  try {
    const { sessionId = "anon", subject = "General", mode = "concise", tone = "teaching", message } = req.body || {};
    if (!message) return res.status(400).json({ error: "message required" });
    if (!basicSafetyCheck(message)) return res.status(400).json({ error: "message failed safety check" });

    const low = message.toLowerCase();
    if (low.includes("who created you") || low.includes("who made you") || low.includes("who built you")) {
      const reply = `${OWNER_NAME} from ${OWNER_LOCATION}. (FullTask AI Tutor ${APP_VERSION})`;
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

    const messages = [{ role: "system", content: systemPromptFor(subject, tone) }];
    if (redisClient) {
      const raw = await redisClient.lRange(`sess:${sessionId}`, 0, -1);
      for (const r of raw) messages.push(JSON.parse(r));
    } else {
      const s = ensureSession(sessionId);
      for (const m of s) messages.push(m);
    }

    const userContent = mode === "deep" ? `${message}\n\nPlease answer step-by-step.` : `${message}\n\nBe concise.`;
    messages.push({ role: "user", content: userContent });

    const j = await callOpenAI(messages);
    const assistantText = j.choices?.[0]?.message?.content || "No response";

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
    console.error("/api/chat err", err);
    return res.status(500).json({ error: "server error", details: String(err) });
  }
});

// streaming proxy (fetch + stream) - supports Authorization header
app.post("/api/stream-fetch", verifyFirebaseToken, async (req, res) => {
  try {
    const { sessionId = "anon", subject = "General", mode = "concise", tone = "teaching", message } = req.body || {};
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

    const openaiResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
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

    if (redisClient) {
      await redisClient.rPush(`sess:${sessionId}`, JSON.stringify({ role: "user", content: message }));
      await redisClient.rPush(`sess:${sessionId}`, JSON.stringify({ role: "assistant", content: assistantText }));
    } else {
      const s = ensureSession(sessionId);
      s.push({ role: "user", content: message });
      s.push({ role: "assistant", content: assistantText });
    }
  } catch (err) {
    console.error("/api/stream-fetch err", err);
    return res.status(500).json({ error: "stream-fetch error", details: String(err) });
  }
});

// upload with optional pdf parsing
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
      fs.unlinkSync(req.file.path);
      return res.json({ ok: true, filename: req.file.filename, originalname: req.file.originalname });
    }
  } catch (err) {
    console.error("/api/upload err", err);
    return res.status(500).json({ error: "upload err", details: String(err) });
  }
});

// other endpoints (quiz, summarize, translate, etc.) can remain unchanged or be added here

// Serve frontend (static) and SPA fallback
app.use(express.static(path.join(__dirname, "public")));

// SPA fallback (so client-side routing works)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`FullTask AI Tutor ${APP_VERSION} listening on ${PORT}`));
