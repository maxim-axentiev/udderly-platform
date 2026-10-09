import { metaAdsDatesInclusive } from "./meta-ads.range";
import type { NormalizedMetaAdsFact } from "./meta-ads.normalize";

export type MetaAdsWindowCoverage = {
  publishedDates: string[];
  possiblyUnpublishedDates: string[];
  publishedDatesByLevel: Record<string, string[]>;
};

export function publishedDatesForFacts(
  facts: readonly NormalizedMetaAdsFact[],
): string[] {
  return [...new Set(facts.map((fact) => fact.metricDate))].sort();
}

export function classifyMetaAdsWindowCoverage(input: {
  from: string;
  to: string;
  factsByLevel: Record<string, NormalizedMetaAdsFact[]>;
}): MetaAdsWindowCoverage {
  const published = new Set<string>();
  const publishedDatesByLevel: Record<string, string[]> = {};
  for (const [level, facts] of Object.entries(input.factsByLevel)) {
    const dates = publishedDatesForFacts(facts);
    publishedDatesByLevel[level] = dates;
    for (const date of dates) {
      published.add(date);
    }
  }
  const publishedDates = [...published].sort();
  const possiblyUnpublishedDates = metaAdsDatesInclusive(input.from, input.to).filter(
    (date) => !published.has(date),
  );
  return { publishedDates, possiblyUnpublishedDates, publishedDatesByLevel };
}

export function factsForDates(
  facts: readonly NormalizedMetaAdsFact[],
  dates: readonly string[],
): NormalizedMetaAdsFact[] {
  const allowed = new Set(dates);
  return facts.filter((fact) => allowed.has(fact.metricDate));
}

/**
 * Dates present at some insight level but missing at another. Diagnostic only.
 * Those dates must not be replaced at the incomplete level.
 */
export function incompleteLevelCoverageDiagnostics(
  factsByLevel: Record<string, NormalizedMetaAdsFact[]>,
): string[] {
  const datesByLevel = Object.fromEntries(
    Object.entries(factsByLevel).map(([level, facts]) => [
      level,
      new Set(publishedDatesForFacts(facts)),
    ]),
  );
  const union = new Set<string>();
  for (const dates of Object.values(datesByLevel)) {
    for (const date of dates) {
      union.add(date);
    }
  }
  const lines: string[] = [];
  for (const date of [...union].sort()) {
    for (const [level, dates] of Object.entries(datesByLevel)) {
      if (!dates.has(date)) {
        lines.push(
          `${level} incomplete coverage date=${date} (not replaced at this level; not a gate)`,
        );
      }
    }
  }
  return lines;
}
