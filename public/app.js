// Frontend app.js (module)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// Firebase config (you provided earlier)
const firebaseConfig = {
  apiKey: "AIzaSyC7cAN-mrE2PvmlQ11zLKAdHBhN7nUFjHw",
  authDomain: "fir-u-c-students-web.firebaseapp.com",
  databaseURL: "https://fir-u-c-students-web-default-rtdb.firebaseio.com",
  projectId: "fir-u-c-students-web",
  storageBucket: "fir-u-c-students-web.firebasestorage.app",
  messagingSenderId: "113569186739",
  appId: "1:113569186739:web:d8daf21059f43a79e841c6"
};

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const provider = new GoogleAuthProvider();

// UI elements
const chatEl = document.getElementById("chat");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send");
const subjectEl = document.getElementById("subject");
const modeEl = document.getElementById("mode");
const toneEl = document.getElementById("tone");
const toggleStreamBtn = document.getElementById("toggleStream");
const signInBtn = document.getElementById("signIn");
const signOutBtn = document.getElementById("signOut");
const userDisplay = document.getElementById("userDisplay");
const quizBtn = document.getElementById("quiz");
const flashBtn = document.getElementById("flash");
const uploadBtn = document.getElementById("uploadBtn");
const fileInput = document.getElementById("file");

let streaming = false;

toggleStreamBtn.addEventListener("click", () => {
  streaming = !streaming;
  toggleStreamBtn.textContent = streaming ? "Streaming: ON" : "Streaming: OFF";
});

function addMessage(text, who = "bot") {
  const el = document.createElement("div");
  el.className = "msg " + (who === "user" ? "user" : "bot");
  el.textContent = text;
  chatEl.appendChild(el);
  chatEl.scrollTop = chatEl.scrollHeight;
  return el;
}

signInBtn.addEventListener("click", async () => {
  try {
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    const token = await user.getIdToken();
    localStorage.setItem("ft_id_token", token);
    userDisplay.textContent = user.displayName;
  } catch (err) {
    console.error("Signin error", err);
    alert("Sign-in failed");
  }
});
signOutBtn.addEventListener("click", async () => {
  await signOut(auth);
  userDisplay.textContent = "Not logged in";
  localStorage.removeItem("ft_id_token");
});

onAuthStateChanged(auth, (user) => {
  if (user) {
    user.getIdToken().then(t => localStorage.setItem("ft_id_token", t));
    userDisplay.textContent = user.displayName || "Logged in";
  } else {
    userDisplay.textContent = "Not logged in";
    localStorage.removeItem("ft_id_token");
  }
});

sendBtn.addEventListener("click", sendMessage);
inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }});

async function sendMessage() {
  const text = inputEl.value.trim();
  if (!text) return;
  addMessage(text, "user");
  inputEl.value = "";
  const sessionId = localStorage.getItem("ft_session") || "web-" + Math.random().toString(36).slice(2,9);
  localStorage.setItem("ft_session", sessionId);

  const payload = {
    sessionId,
    subject: subjectEl.value,
    mode: modeEl.value,
    tone: toneEl.value,
    message: text
  };

  const idToken = localStorage.getItem("ft_id_token");
  const resEl = addMessage("Thinking...", "bot");

  try {
    if (streaming) {
      // fetch-based streaming that supports Authorization header
      const r = await fetch("/api/stream-fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(idToken ? { "Authorization": "Bearer " + idToken } : {}) },
        body: JSON.stringify(payload)
      });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        resEl.textContent = "Error: " + (j?.error || r.statusText);
        return;
      }
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      resEl.textContent = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          // server wraps chunks as JSON sometimes; attempt to parse
          try {
            const parsed = JSON.parse(chunk);
            if (parsed.chunk) resEl.textContent += parsed.chunk;
            else resEl.textContent += chunk;
          } catch {
            resEl.textContent += chunk;
          }
          chatEl.scrollTop = chatEl.scrollHeight;
        }
      }
    } else {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(idToken ? { "Authorization": "Bearer " + idToken } : {}) },
        body: JSON.stringify(payload)
      });
      const j = await r.json();
      if (r.ok) resEl.textContent = j.reply || "No reply";
      else resEl.textContent = "Error: " + (j.error || JSON.stringify(j));
    }
  } catch (err) {
    console.error("send error", err);
    resEl.textContent = "Network error: " + String(err);
  }
}

// Quiz
quizBtn.addEventListener("click", async () => {
  const topic = prompt("Topic for quiz?");
  if (!topic) return;
  const idToken = localStorage.getItem("ft_id_token");
  const r = await fetch("/api/generate-quiz", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(idToken ? { "Authorization": "Bearer " + idToken } : {}) },
    body: JSON.stringify({ topic, count: 5 })
  });
  const j = await r.json();
  if (r.ok) addMessage(JSON.stringify(j.quiz || j.raw || j, null, 2), "bot");
  else addMessage("Quiz error: " + JSON.stringify(j), "bot");
});

// Flashcards
flashBtn.addEventListener("click", async () => {
  const topic = prompt("Topic for flashcards?");
  if (!topic) return;
  const idToken = localStorage.getItem("ft_id_token");
  const r = await fetch("/api/flashcards", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(idToken ? { "Authorization": "Bearer " + idToken } : {}) },
    body: JSON.stringify({ topic, count: 10 })
  });
  const j = await r.json();
  if (r.ok) addMessage(JSON.stringify(j.flashcards || j.raw || j, null, 2), "bot");
  else addMessage("Flashcards error: " + JSON.stringify(j), "bot");
});

// Upload PDF
uploadBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const form = new FormData();
  form.append("file", file);
  const idToken = localStorage.getItem("ft_id_token");
  const r = await fetch("/api/upload", { method: "POST", headers: idToken ? { "Authorization": "Bearer " + idToken } : {}, body: form });
  const j = await r.json();
  if (r.ok) addMessage("Upload result:\n" + JSON.stringify(j, null, 2), "bot");
  else addMessage("Upload error: " + JSON.stringify(j), "bot");
});
