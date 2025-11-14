import { NextResponse } from "next/server";
import { callOpenAIChat } from "../../../lib/openaiServer";

export async function POST(req) {
  try {
    const body = await req.json();
    const { sessionId = "anon", subject = "General", mode = "concise", message } = body;

    if (!message) return NextResponse.json({ error: "message required" }, { status: 400 });

    // safety check
    const low = message.toLowerCase();
    const banned = ["bomb", "terrorist", "kill", "harm", "attack"];
    if (banned.some(b => low.includes(b))) return NextResponse.json({ error: "Unsafe content" }, { status: 400 });

    // simple attribution check
    if (low.includes("who created you") || low.includes("who made you")) {
      const reply = "Akin S. Sokpah from Liberia (FullTask AI Tutor).";
      return NextResponse.json({ reply });
    }

    const system = { role: "system", content: `You are FullTask AI Tutor. Subject: ${subject}. Provide clear step-by-step answers.` };
    const user = { role: "user", content: mode === "deep" ? `${message}\n\nPlease answer with detailed steps.` : message };

    const messages = [system, user];

    const j = await callOpenAIChat(messages);
    const reply = j.choices?.[0]?.message?.content || "No reply";
    return NextResponse.json({ reply });
  } catch (err) {
    console.error("/api/chat error", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
