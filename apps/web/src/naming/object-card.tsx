import { Check, Clock, Lock, Tag } from "lucide-react";

import { cn } from "./cn";
import { Button } from "./button";
import type { NamingAvailability } from "./format";
import { formatCatalogPrice, safePhotoUrl } from "./format";

const STATE: Record<
  NamingAvailability,
  {
    label: string;
    button: string;
    note: string | null;
    icon: typeof Check;
    badge: string;
    card: string;
    image: string;
    srText: string;
  }
> = {
  available: {
    label: "Available",
    button: "Buy & Claim",
    note: null,
    icon: Check,
    badge: "bg-status-available text-background",
    card: "bg-background chunky-card",
    image: "",
    srText: "Available to claim.",
  },
  held: {
    label: "On Hold",
    button: "Currently on hold",
    note: "Someone is checking out. It may become available again.",
    icon: Clock,
    badge: "bg-status-held text-headline",
    card: "border-2 border-dashed border-headline/50 bg-farm-silver/60",
    image: "grayscale opacity-60",
    srText: "Temporarily on hold by another customer. Not available right now.",
  },
  claimed: {
    label: "Claimed",
    button: "Claimed",
    note: "Someone has secured this piece of farm history.",
    icon: Lock,
    badge: "bg-status-claimed text-background",
    card: "border-2 border-headline/40 bg-farm-beige",
    image: "grayscale contrast-75 opacity-70",
    srText: "Already claimed. Someone has secured this piece of farm history.",
  },
};

export function ObjectCard({
  id,
  name,
  description,
  photoUrl,
  priceCents,
  currency,
  availability,
  purchasingEnabled,
  pending,
  onClaim,
}: {
  id: string;
  name: string;
  description: string | null;
  photoUrl: string | null;
  priceCents: number;
  currency: string;
  availability: NamingAvailability;
  purchasingEnabled: boolean;
  pending: boolean;
  onClaim: (objectId: string) => void;
}) {
  const state = STATE[availability];
  const Icon = state.icon;
  const photo = safePhotoUrl(photoUrl);
  const canBuy = purchasingEnabled && availability === "available" && !pending;
  const price = formatCatalogPrice(priceCents);

  return (
    <article
      aria-label={`${name}, ${price} ${currency}. ${state.srText}`}
      className={cn("flex flex-col overflow-hidden rounded-2xl", state.card)}
    >
      <div className="relative aspect-square overflow-hidden bg-farm-beige">
        {photo ? (
          <img
            src={photo}
            alt={name}
            className={cn("h-full w-full object-cover", state.image)}
          />
        ) : (
          <div
            className={cn(
              "flex h-full items-center justify-center px-4 text-center font-display text-2xl font-black uppercase text-headline/40",
              state.image,
            )}
          >
            Photograph coming soon
          </div>
        )}
        <span
          className={cn(
            "absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-display text-sm font-extrabold uppercase",
            state.badge,
          )}
        >
          <Icon aria-hidden="true" size={14} /> {state.label}
        </span>
        <span className="absolute right-3 top-3 rounded-full bg-headline px-3 py-1 font-display text-lg font-black text-background">
          {price}
        </span>
        {availability === "held" ? (
          <div aria-hidden="true" className="held-stripes absolute inset-0 flex items-center justify-center">
            <span className="rounded-lg bg-background px-4 py-2 font-display text-2xl font-black uppercase text-headline shadow-[4px_4px_0_var(--headline)]">
              On Hold
            </span>
          </div>
        ) : null}
        {availability === "claimed" ? (
          <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center bg-headline/30">
            <span className="stamp-in -rotate-12 rounded-md border-4 border-primary-accent bg-background/90 px-5 py-1 font-display text-4xl font-black uppercase tracking-widest text-primary-accent">
              Claimed
            </span>
          </div>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col p-5">
        <h3
          className={cn(
            "font-display text-2xl font-black uppercase leading-none break-words",
            availability === "available" ? "text-headline" : "text-headline/60",
          )}
        >
          {name}
        </h3>
        <p className="mt-1 flex items-center gap-1 text-sm font-semibold text-muted-foreground">
          <Tag aria-hidden="true" size={14} /> Requires a {price} gift card
        </p>
        {description ? (
          <p
            className={cn(
              "mt-3 flex-1 break-words text-[0.95rem] leading-relaxed",
              availability === "available" ? "text-body-copy" : "text-muted-foreground",
            )}
          >
            {description}
          </p>
        ) : (
          <div className="flex-1" />
        )}
        <div className="mt-5">
          {canBuy ? (
            <Button className="w-full" onClick={() => onClaim(id)}>
              Buy & Claim
            </Button>
          ) : (
            <>
              <Button className="w-full" variant="outline" disabled>
                {pending ? "Reserving…" : state.button}
              </Button>
              {state.note ? (
                <p className="mt-2 text-center text-xs font-medium text-muted-foreground">
                  {state.note}
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </article>
  );
}
