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
    icon: Check,
    badge: "bg-status-available text-background",
    card: "bg-background chunky-card",
    image: "",
    srText: "Available to claim.",
  },
  held: {
    label: "On Hold",
    button: "On Hold",
    icon: Clock,
    badge: "bg-headline/70 text-background",
    card: "border-2 border-headline/30 bg-farm-silver/80",
    image: "grayscale",
    srText: "Temporarily on hold by another customer. Not available right now.",
  },
  claimed: {
    label: "Claimed",
    button: "Claimed",
    icon: Lock,
    badge: "bg-headline/70 text-background",
    card: "border-2 border-headline/30 bg-farm-silver/80",
    image: "grayscale",
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

  const unavailable = availability !== "available";

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
        {unavailable ? (
          <div className="absolute inset-0 flex items-center justify-center bg-headline/45 px-4">
            {availability === "held" ? (
              <div className="max-w-xs rounded-lg bg-background/95 px-4 py-3 text-center">
                <span className="block font-display text-3xl font-black uppercase text-headline">
                  {state.label}
                </span>
                <span className="mt-2 block text-sm font-semibold leading-snug text-headline">
                  Someone is currently trying to claim this item. It may become
                  available again.
                </span>
              </div>
            ) : (
              <span className="rounded-lg bg-background/95 px-4 py-2 text-center font-display text-3xl font-black uppercase text-headline">
                {state.label}
              </span>
            )}
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
            <Button
              className={cn(
                "w-full",
                unavailable && "border-headline/30 bg-farm-silver text-headline/60 shadow-none",
              )}
              variant="outline"
              disabled
            >
              {pending ? "Reserving…" : state.button}
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
