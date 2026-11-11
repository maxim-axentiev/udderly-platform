import { useMemo, useState } from "react";

import type { NamingObject } from "./api";
import { cn } from "./cn";
import { ObjectCard } from "./object-card";

export const CAMPAIGN_TIERS = [10_000, 25_000, 50_000, 100_000] as const;
const MIXED_TIER_ORDER = [100_000, 50_000, 25_000, 10_000] as const;

function tierLabel(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-CA")}`;
}

export function interleaveByTier(objects: readonly NamingObject[]): NamingObject[] {
  const groups = new Map<number, NamingObject[]>();
  const other: NamingObject[] = [];
  for (const object of objects) {
    if (MIXED_TIER_ORDER.includes(object.priceCents as (typeof MIXED_TIER_ORDER)[number])) {
      const group = groups.get(object.priceCents) ?? [];
      group.push(object);
      groups.set(object.priceCents, group);
    } else {
      other.push(object);
    }
  }
  const cursors = new Map<number, number>(MIXED_TIER_ORDER.map((tier) => [tier, 0]));
  const mixed: NamingObject[] = [];
  let remaining = objects.length - other.length;
  while (remaining > 0) {
    for (const tier of MIXED_TIER_ORDER) {
      const group = groups.get(tier) ?? [];
      const cursor = cursors.get(tier) ?? 0;
      if (cursor < group.length) {
        const next = group[cursor];
        if (next) {
          mixed.push(next);
          cursors.set(tier, cursor + 1);
          remaining -= 1;
        }
      }
    }
  }
  return [...mixed, ...other];
}

export function ObjectCatalog({
  objects,
  purchasingEnabled,
  pendingId,
  onClaim,
}: {
  objects: NamingObject[];
  purchasingEnabled: boolean;
  pendingId: string | null;
  onClaim: (objectId: string) => void;
}) {
  const [tier, setTier] = useState<number | "all">("all");
  const ordered = useMemo(() => interleaveByTier(objects), [objects]);
  const visible = useMemo(
    () => ordered.filter((object) => tier === "all" || object.priceCents === tier),
    [ordered, tier],
  );
  const options: { value: number | "all"; label: string }[] = [
    { value: "all", label: "All Objects" },
    ...CAMPAIGN_TIERS.map((cents) => ({ value: cents, label: tierLabel(cents) })),
  ];

  return (
    <div>
      <div className="min-w-0 max-w-full">
      <div
        role="group"
        aria-label="Filter objects by gift card tier"
        className="grid grid-cols-2 gap-2 md:flex md:flex-wrap md:justify-center"
      >
        {options.map((option) => (
          <button
            key={option.label}
            type="button"
            aria-pressed={tier === option.value}
            className={cn(
              "min-h-12 w-full rounded-full border-2 border-headline px-3 font-display text-lg font-extrabold uppercase transition md:w-auto md:px-5",
              option.value === "all" && "col-span-2",
              tier === option.value
                ? "bg-headline text-background"
                : "bg-background text-headline hover:bg-secondary-accent",
            )}
            onClick={() => setTier(option.value)}
          >
            {option.label}
            <span className="sr-only"> CAD</span>
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <div className="mx-auto mt-10 max-w-md rounded-2xl border-2 border-dashed border-headline/40 bg-background p-8 text-center">
          <p className="font-display text-2xl font-black uppercase text-headline">
            Nothing here (yet)
          </p>
          <p className="mt-2 text-body-copy">
            No objects in this tier right now. Try another tier — or check back soon.
          </p>
        </div>
      ) : (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((object) => (
            <ObjectCard
              key={object.id}
              id={object.id}
              name={object.name}
              description={object.description}
              photoUrl={object.photoUrl}
              priceCents={object.priceCents}
              currency={object.currency}
              availability={object.availability}
              purchasingEnabled={purchasingEnabled}
              pending={pendingId === object.id}
              onClaim={onClaim}
            />
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
