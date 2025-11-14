import Link from "next/link";

export default function Home() {
  return (
    <section className="space-y-6">
      <div className="rounded-xl p-8 bg-white shadow">
        <h1 className="text-3xl font-bold">FullTask AI Tutor <span className="text-sm text-gray-500">v6.x</span></h1>
        <p className="mt-2 text-gray-700">AI tutor for Biology, Chemistry, Physics, Math, Nursing and English — built by Akin S. Sokpah from Liberia.</p>
        <div className="mt-6 flex gap-4">
          <Link href="/chat" className="px-4 py-2 rounded bg-primary text-white">Open Chat Assistant</Link>
          <Link href="/dashboard" className="px-4 py-2 rounded border">Dashboard</Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <FeatureCard title="Quiz Generator" desc="Auto-generate MCQs and practice tests." />
        <FeatureCard title="Flashcards" desc="Create flashcards and spaced repetition schedules." />
        <FeatureCard title="PDF Summaries" desc="Upload PDFs and get summaries and notes." />
      </div>
    </section>
  );
}

function FeatureCard({ title, desc }) {
  return (
    <div className="rounded-lg p-6 bg-white shadow">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-gray-600">{desc}</p>
    </div>
  );
}
