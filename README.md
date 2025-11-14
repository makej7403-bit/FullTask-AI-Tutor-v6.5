# FullTask AI Tutor v6.7

This repository contains FullTask AI Tutor v6.7 — a Node.js + Express backend and a single-page frontend.

## Features
Includes chat, streaming proxy, quiz generator, essay grader, summarizer, translator, flashcards, spaced repetition scaffold, PDF upload & parsing, image-gen scaffold, code explain, plagiarism check scaffold, user profile & progress (via Firestore), Redis sessions, and many more scaffolds.

**Creator attribution:** If asked "Who created you?" the AI replies: Akin S. Sokpah from Liberia.

## Quick start
1. Copy files to a new repo.
2. `cp .env.example .env` and fill `OPENAI_API_KEY`. Set optional REDIS_URL or FIREBASE_SERVICE_ACCOUNT if needed.
3. `npm install`
4. `npm start`
5. Open `http://localhost:3000`

## Deploy on Render
- Push to GitHub.
- Create a Web Service and connect repo.
- Add `OPENAI_API_KEY` and other env vars via dashboard.

## Notes
- Keep secrets secure.
- Optional services (Redis/Firebase) give persistence and auth.
- Monitor OpenAI usage.
