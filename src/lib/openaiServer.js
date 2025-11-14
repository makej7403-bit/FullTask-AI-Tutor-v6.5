import fetch from "node-fetch";

export async function callOpenAIChat(messages, opts = {}) {
  const body = {
    model: opts.model || process.env.MODEL || "gpt-4o-mini",
    messages,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.max_tokens ?? 800
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error("OpenAI error: " + txt);
  }
  return res.json();
}
