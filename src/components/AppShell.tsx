import Link from "next/link";
import { EVIDENCE_WARNING } from "@/lib/drive-utils";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-cockpit-950 text-slate-50">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 py-5 sm:px-6">
        <header className="mb-5 flex items-center justify-between gap-4 border-b border-cockpit-line pb-4">
          <Link href="/" className="text-xl font-black tracking-wide">
            Black Box <span className="text-signal-blue">V4</span>
          </Link>
          <nav className="flex gap-2 text-sm text-slate-300">
            <Link className="rounded-md px-3 py-2 hover:bg-cockpit-800" href="/review">
              Review
            </Link>
            <Link className="rounded-md px-3 py-2 hover:bg-cockpit-800" href="/settings">
              Settings
            </Link>
          </nav>
        </header>
        {children}
        <footer className="mt-auto pt-6 text-xs leading-5 text-slate-500">{EVIDENCE_WARNING}</footer>
      </div>
    </main>
  );
}
