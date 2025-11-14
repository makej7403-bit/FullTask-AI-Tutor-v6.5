import Link from "next/link";

export default function Navbar() {
  return (
    <header className="bg-white shadow">
      <div className="container mx-auto px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/" className="font-bold text-xl">FullTask AI Tutor</Link>
          <span className="text-sm text-gray-500">v6.x</span>
        </div>
        <nav className="flex items-center gap-4">
          <Link href="/chat" className="text-sm">Chat</Link>
          <Link href="/dashboard" className="text-sm">Dashboard</Link>
          <Link href="/admin" className="text-sm">Admin</Link>
          <div className="text-sm text-gray-500">By Akin S. Sokpah (Liberia)</div>
        </nav>
      </div>
    </header>
  );
}
