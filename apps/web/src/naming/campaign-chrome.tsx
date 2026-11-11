import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Button } from "./button";

function CampaignLogo() {
  return (
    <img
      src="/campaign/farm-logo.png"
      alt="Udderly Ridiculous Farm Life"
      width={1588}
      height={629}
      className="h-auto w-full"
    />
  );
}

export function CampaignHeader({ navigation = true }: { navigation?: boolean }) {
  return (
    <header className="no-print sticky top-0 z-40 border-b-2 border-headline bg-background">
      <div className="mx-auto flex min-h-20 max-w-[1500px] items-center justify-between gap-4 px-5 md:px-8">
        {navigation ? (
          <Link to="/" aria-label="Name That Thing! home" className="block w-32 shrink-0 md:w-40">
            <CampaignLogo />
          </Link>
        ) : (
          <div className="w-32 shrink-0 md:w-40">
            <CampaignLogo />
          </div>
        )}
        {navigation ? (
          <Button asChild>
            <a href="/#objects">Browse the Things</a>
          </Button>
        ) : null}
      </div>
    </header>
  );
}

export function CampaignFooter() {
  return (
    <footer className="no-print bg-footer py-10 text-footer-foreground">
      <div className="mx-auto max-w-5xl px-5 text-center text-sm md:px-8">
        <p className="font-display text-2xl font-black uppercase">Name That Thing!</p>
        <p className="mt-2 opacity-80">
          An Udderly Ridiculous Farm Life campaign. Gift cards are processed by FareHarbor.
        </p>
        <p className="mt-1 opacity-60">© 2026 Udderly Ridiculous Farm Life</p>
      </div>
    </footer>
  );
}

export function CampaignFrame({
  children,
  navigation = true,
}: {
  children: ReactNode;
  navigation?: boolean;
}) {
  return (
    <div className="min-h-screen">
      <CampaignHeader navigation={navigation} />
      {children}
      <CampaignFooter />
    </div>
  );
}

export function JourneyPage({
  eyebrow,
  title,
  printHeading = true,
  children,
}: {
  eyebrow: string;
  title: string;
  printHeading?: boolean;
  children: ReactNode;
}) {
  return (
    <main className="bg-farm-beige">
      <section className="px-5 py-14 md:py-20">
        <div className="mx-auto max-w-2xl">
          <p
            className={`font-accent text-xl italic text-primary-accent ${printHeading ? "" : "print-hidden"}`}
          >
            {eyebrow}
          </p>
          <h1
            className={`mt-1 font-display text-5xl font-black uppercase leading-none text-headline ${printHeading ? "" : "print-hidden"}`}
          >
            {title}
          </h1>
          <div className="mt-8 space-y-6">{children}</div>
        </div>
      </section>
    </main>
  );
}
