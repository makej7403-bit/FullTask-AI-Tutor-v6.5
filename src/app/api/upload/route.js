import { NextResponse } from "next/server";
import formidable from "formidable";
import fs from "fs";
import { promisify } from "util";
import { callOpenAIChat } from "../../../lib/openaiServer";
const readFile = promisify(fs.readFile);

export const runtime = "nodejs";

export async function POST(req) {
  try {
    const form = new formidable.IncomingForm();
    // parse request
    const parsed = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) return reject(err);
        resolve({ fields, files });
      });
    });

    const file = parsed.files?.file;
    if (!file) return NextResponse.json({ error: "file required" }, { status: 400 });
    const data = await readFile(file.filepath, { encoding: "utf8" }).catch(()=>null);

    // if pdf binary, we only send a note to OpenAI; for full parse use pdf-parse in Node (optional)
    const text = data || "Binary or non-text file uploaded. Please download and view.";
    const prompt = `Summarize the uploaded document (first 8000 characters):\n\n${text.slice(0,8000)}`;
    const messages = [
      { role: "system", content: "You are a document summarizer." },
      { role: "user", content: prompt }
    ];
    const j = await callOpenAIChat(messages, { max_tokens: 800 });
    return NextResponse.json({ summary: j.choices[0].message.content });
  } catch (err) {
    console.error("/api/upload error", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
