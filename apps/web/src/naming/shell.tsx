import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

export function CampaignShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="print-hidden border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <Link to="/" className="text-lg font-semibold tracking-tight">
            Udderly Ridiculous
          </Link>
          <p className="text-sm text-stone-600">Gift card naming</p>
        </div>
      </header>
      {children}
      <footer className="print-hidden mx-auto max-w-5xl px-6 py-10 text-sm text-stone-500">
        <Link to="/health" className="underline">
          Platform status
        </Link>
      </footer>
    </div>
  );
}
