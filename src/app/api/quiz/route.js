import { NextResponse } from "next/server";
import { callOpenAIChat } from "../../../lib/openaiServer";

export async function POST(req) {
  try {
    const { topic = "", count = 5 } = await req.json();
    if (!topic) return NextResponse.json({ error: "topic required" }, { status: 400 });

    const prompt = `Create ${count} multiple choice questions (A-D) about "${topic}". Return as plain human-readable text with answers and short explanations.`;
    const messages = [
      { role: "system", content: "You are a helpful quiz generator." },
      { role: "user", content: prompt }
    ];
    const j = await callOpenAIChat(messages, { max_tokens: 600 });
    return NextResponse.json({ quiz: j.choices[0].message.content });
  } catch (err) {
    console.error("/api/quiz", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
