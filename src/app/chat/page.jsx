"use client";

import { useState, useRef } from "react";
import ChatBox from "../../components/ChatBox";

export default function ChatPage() {
  const [subject, setSubject] = useState("General");
  const [mode, setMode] = useState("concise");
  const [tone, setTone] = useState("teaching");
  const [streaming, setStreaming] = useState(false);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <aside className="lg:col-span-1 rounded-xl bg-white p-6 shadow">
        <h2 className="text-lg font-semibold">Assistant Settings</h2>
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="text-sm text-gray-600">Subject</span>
            <select value={subject} onChange={(e) => setSubject(e.target.value)} className="mt-1 w-full rounded border px-3 py-2">
              <option>General</option><option>Mathematics</option><option>Physics</option><option>Chemistry</option><option>Biology</option><option>Nursing</option><option>English</option>
            </select>
          </label>
          <label>
            <span className="text-sm text-gray-600">Mode</span>
            <select value={mode} onChange={(e)=>setMode(e.target.value)} className="mt-1 w-full rounded border px-3 py-2">
              <option value="concise">Concise</option>
              <option value="deep">Deep (step-by-step)</option>
            </select>
          </label>
          <label>
            <span className="text-sm text-gray-600">Tone</span>
            <select value={tone} onChange={(e)=>setTone(e.target.value)} className="mt-1 w-full rounded border px-3 py-2">
              <option value="teaching">Teaching</option>
              <option value="friendly">Friendly</option>
              <option value="formal">Formal</option>
            </select>
          </label>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={streaming} onChange={() => setStreaming(s=>!s)} />
              <span className="text-sm">Enable streaming</span>
            </label>
          </div>
        </div>
      </aside>

      <div className="lg:col-span-2">
        <div className="rounded-xl bg-white p-6 shadow">
          <h2 className="text-lg font-semibold">FullTask AI Tutor — Chat</h2>
          <p className="text-sm text-gray-500 mt-1">Ask your question below.</p>
          <div className="mt-4">
            <ChatBox subject={subject} mode={mode} tone={tone} streaming={streaming} />
          </div>
        </div>
      </div>
    </div>
  );
}
