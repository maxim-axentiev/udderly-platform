import { useMemo, useState } from "react";

import type { NamingObject } from "./api";
import { cn } from "./cn";
import { ObjectCard } from "./object-card";

export const CAMPAIGN_TIERS = [10_000, 25_000, 50_000, 100_000] as const;
const TIER_100 = 10_000;
const TIER_250 = 25_000;
const TIER_500 = 50_000;
const TIER_1000 = 100_000;
const CAMPAIGN_TIER_SET = new Set<number>(CAMPAIGN_TIERS);
/** Positions are 1-based. The second $1,000 object lands at index 29. */
const SECOND_THOUSAND_INDEX = 29;
const OPENING_PATTERN = [
  TIER_100, TIER_250, TIER_100, TIER_100, TIER_500,
  TIER_100, TIER_250, TIER_100, TIER_100, TIER_1000,
  TIER_100, TIER_250, TIER_100, TIER_100, TIER_500,
  TIER_250,
] as const;
const SPREAD_PRIORITY = [TIER_100, TIER_250, TIER_500, TIER_1000] as const;

function tierLabel(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-CA")}`;
}

function compareObjects(left: NamingObject, right: NamingObject): number {
  const byName = left.name.localeCompare(right.name, "en-CA");
  if (byName !== 0) {
    return byName;
  }
  return left.id.localeCompare(right.id);
}

function queues(objects: readonly NamingObject[]): {
  groups: Map<number, NamingObject[]>;
  other: NamingObject[];
} {
  const groups = new Map<number, NamingObject[]>();
  const other: NamingObject[] = [];
  for (const object of objects) {
    if (CAMPAIGN_TIER_SET.has(object.priceCents)) {
      const group = groups.get(object.priceCents) ?? [];
      group.push(object);
      groups.set(object.priceCents, group);
    } else {
      other.push(object);
    }
  }
  for (const group of groups.values()) {
    group.sort(compareObjects);
  }
  other.sort(compareObjects);
  return { groups, other };
}

function available(groups: Map<number, NamingObject[]>, tier: number): number {
  return groups.get(tier)?.length ?? 0;
}

function take(
  groups: Map<number, NamingObject[]>,
  tier: number,
): NamingObject | undefined {
  const group = groups.get(tier);
  if (!group || group.length === 0) {
    return undefined;
  }
  return group.shift();
}

function canPlaceOpening(groups: Map<number, NamingObject[]>): boolean {
  const need = new Map<number, number>();
  for (const tier of OPENING_PATTERN) {
    need.set(tier, (need.get(tier) ?? 0) + 1);
  }
  for (const [tier, count] of need) {
    if (available(groups, tier) < count) {
      return false;
    }
  }
  return true;
}

function spreadTiers(
  groups: Map<number, NamingObject[]>,
  limit: number,
): NamingObject[] {
  const wants = new Map(
    SPREAD_PRIORITY.map((tier) => [tier, available(groups, tier)]),
  );
  const total = SPREAD_PRIORITY.reduce(
    (sum, tier) => sum + (wants.get(tier) ?? 0),
    0,
  );
  const steps = Math.min(limit, total);
  if (steps === 0) {
    return [];
  }
  const placed = new Map(SPREAD_PRIORITY.map((tier) => [tier, 0]));
  const result: NamingObject[] = [];
  for (let index = 0; index < steps; index += 1) {
  let best: (typeof SPREAD_PRIORITY)[number] | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const tier of SPREAD_PRIORITY) {
      const want = wants.get(tier) ?? 0;
      const have = placed.get(tier) ?? 0;
      if (have >= want) {
        continue;
      }
      const score = ((index + 1) * want) / steps - have;
      if (score > bestScore) {
        bestScore = score;
        best = tier;
      }
    }
    if (best === null) {
      break;
    }
    const next = take(groups, best);
    if (!next) {
      break;
    }
    result.push(next);
    placed.set(best, (placed.get(best) ?? 0) + 1);
  }
  return result;
}

export function interleaveByTier(objects: readonly NamingObject[]): NamingObject[] {
  const { groups, other } = queues(objects);
  const mixed: NamingObject[] = [];
  if (canPlaceOpening(groups)) {
    for (const tier of OPENING_PATTERN) {
      const next = take(groups, tier);
      if (next) {
        mixed.push(next);
      }
    }
    const secondThousand = take(groups, TIER_1000);
    const rest = spreadTiers(groups, Number.POSITIVE_INFINITY);
    if (secondThousand) {
      const leadCount = Math.max(0, SECOND_THOUSAND_INDEX - mixed.length);
      mixed.push(...rest.slice(0, leadCount), secondThousand, ...rest.slice(leadCount));
    } else {
      mixed.push(...rest);
    }
  } else {
    mixed.push(...spreadTiers(groups, Number.POSITIVE_INFINITY));
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
