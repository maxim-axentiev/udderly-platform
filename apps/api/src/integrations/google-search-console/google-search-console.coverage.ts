import { gscDatesInclusive } from "./google-search-console.range";
import type { NormalizedGscFact } from "./google-search-console.normalize";

export type GscWindowCoverage = {
  publishedDates: string[];
  possiblyUnpublishedDates: string[];
};

/**
 * A date is published only when Search Analytics `final` actually returned
 * at least one row for it. Empty recent dates are possibly unpublished and
 * must not be treated as canonical zeros or used to wipe existing grains.
 */
export function classifyGscWindowCoverage(input: {
  from: string;
  to: string;
  factsByFamily: Record<string, NormalizedGscFact[]>;
}): GscWindowCoverage {
  const published = new Set<string>();
  for (const facts of Object.values(input.factsByFamily)) {
    for (const fact of facts) {
      published.add(fact.gscDate);
    }
  }
  const publishedDates = [...published].sort();
  const possiblyUnpublishedDates = gscDatesInclusive(input.from, input.to).filter(
    (date) => !published.has(date),
  );
  return { publishedDates, possiblyUnpublishedDates };
}

export function factsForDates(
  facts: readonly NormalizedGscFact[],
  dates: readonly string[],
): NormalizedGscFact[] {
  const allowed = new Set(dates);
  return facts.filter((fact) => allowed.has(fact.gscDate));
}
