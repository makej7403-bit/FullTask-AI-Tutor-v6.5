import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyC7cAN-mrE2PvmlQ11zLKAdHBhN7nUFjHw",
  authDomain: "fir-u-c-students-web.firebaseapp.com",
  projectId: "fir-u-c-students-web",
  storageBucket: "fir-u-c-students-web.firebasestorage.app",
  messagingSenderId: "113569186739",
  appId: "1:113569186739:web:d8daf21059f43a79e841c6"
};
const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const provider = new GoogleAuthProvider();

const subjectEl = document.getElementById("subject");
const modeEl = document.getElementById("mode");
const toneEl = document.getElementById("tone");
const toggleStreamBtn = document.getElementById("toggleStream");
const signInBtn = document.getElementById("signIn");
const signOutBtn = document.getElementById("signOut");
const userDisplay = document.getElementById("userDisplay");
const chatEl = document.getElementById("chat");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send");
const quizBtn = document.getElementById("quiz");
const flashBtn = document.getElementById("flash");
const uploadBtn = document.getElementById("uploadBtn");
const fileInput = document.getElementById("fileInput");

let streaming = false;
toggleStreamBtn.addEventListener("click", () => {
  streaming = !streaming;
  toggleStreamBtn.textContent = streaming ? "Streaming: ON" : "Streaming: OFF";
});

function addMessage(text, role = "bot") {
  const d = document.createElement("div");
  d.className = `msg ${role}`;
  d.textContent = text;
  chatEl.appendChild(d);
  chatEl.scrollTop = chatEl.scrollHeight;
  return d;
}

signInBtn.onclick = async () => {
  try {
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    const token = await user.getIdToken();
    localStorage.setItem("ft_id_token", token);
    userDisplay.textContent = user.displayName;
  } catch (e) {
    console.error("Signin error", e);
    alert("Google sign-in failed");
  }
};
signOutBtn.onclick = async () => {
  await signOut(auth);
  userDisplay.textContent = "Not logged in";
  localStorage.removeItem("ft_id_token");
};

onAuthStateChanged(auth, (user) => {
  if (user) {
    user.getIdToken().then(t => localStorage.setItem("ft_id_token", t));
    userDisplay.textContent = user.displayName || "Logged in";
  } else {
    userDisplay.textContent = "Not logged in";
  }
});

sendBtn.onclick = () => sendChat();
inputEl.onkeydown = (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
};

async function sendChat() {
  const message = inputEl.value.trim();
  if (!message) return;
  addMessage(message, "user");
  inputEl.value = "";
  const sessionId = localStorage.getItem("ft_session") || ("web-" + Math.random().toString(36).slice(2));
  localStorage.setItem("ft_session", sessionId);

  const payload = {
    sessionId,
    subject: subjectEl.value,
    mode: modeEl.value,
    tone: toneEl.value,
    message
  };
  const idToken = localStorage.getItem("ft_id_token");

  let responseElem = addMessage("Thinking …", "bot");

  try {
    if (streaming) {
      const res = await fetch("/api/stream-fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(idToken ? { "Authorization": "Bearer " + idToken } : {}) },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        responseElem.textContent
