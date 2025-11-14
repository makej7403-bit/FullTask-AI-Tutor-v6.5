"use client";

import { useState, useRef } from "react";

export default function ChatBox({ subject = "General", mode = "concise", tone = "teaching", streaming = false }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const sessionIdRef = useRef(() => {
    const id = localStorage.getItem("ft_session");
    if (id) return id;
    const newId = "web-" + Math.random().toString(36).slice(2,9);
    localStorage.setItem("ft_session", newId);
    return newId;
  })();

  async function send() {
    if (!input.trim()) return;
    const userMsg = { role: "user", content: input };
    setMessages((m) => [...m, userMsg]);
    const payload = { sessionId: localStorage.getItem("ft_session"), subject, mode, tone, message: input };
    setInput("");
    setLoading(true);

    try {
      if (streaming) {
        const res = await fetch("/api/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          setMessages((m) => [...m, { role: "assistant", content: "Error: " + (j.error || res.statusText) }]);
          setLoading(false);
          return;
        }
        // read streaming SSE lines
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let assistantText = "";
        const botIdx = messages.length; // index to update
        setMessages((m) => [...m, { role: "assistant", content: "..." }]);
        while(true) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = dec.decode(value);
          // server sends chunks plain; append
          assistantText += chunk;
          // update last assistant message
          setMessages((m) => {
            const copy = [...m];
            copy[copy.length - 1] = { role: "assistant", content: assistantText };
            return copy;
          });
        }
      } else {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const j = await res.json();
        if (!res.ok) {
          setMessages((m) => [...m, { role: "assistant", content: "Error: " + (j.error || "Server error")}]);
        } else {
          setMessages((m) => [...m, { role: "assistant", content: j.reply }]);
        }
      }
    } catch (e) {
      setMessages((m)=>[...m, { role: "assistant", content: "Network error: " + String(e) }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col">
      <div className="h-96 overflow-auto border rounded p-4 bg-slate-50 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`p-3 rounded ${m.role === "user" ? "bg-blue-50 text-right" : "bg-white"}`}>
            <div className="text-sm">{m.content}</div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex gap-3">
        <textarea value={input} onChange={(e)=>setInput(e.target.value)} rows={3} className="flex-1 rounded border p-2" placeholder="Ask a question..."></textarea>
        <div className="flex flex-col gap-2">
          <button onClick={send} disabled={loading} className="bg-primary text-white px-4 py-2 rounded">
            {loading ? "Thinking..." : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
