import { NextResponse } from "next/server";
import { callOpenAIChat } from "../../../lib/openaiServer";

export async function POST(req) {
  try {
    const { topic = "", count = 10 } = await req.json();
    if (!topic) return NextResponse.json({ error: "topic required" }, { status: 400 });

    const prompt = `Generate ${count} flashcards for the topic "${topic}". Provide front and back for each card.`;
    const messages = [
      { role: "system", content: "You are a helpful flashcard generator." },
      { role: "user", content: prompt }
    ];
    const j = await callOpenAIChat(messages, { max_tokens: 600 });
    return NextResponse.json({ flashcards: j.choices[0].message.content });
  } catch (err) {
    console.error("/api/flashcards", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
