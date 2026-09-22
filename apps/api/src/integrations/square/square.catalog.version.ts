export function catalogObjectVersion(
  payload: Record<string, unknown>,
): number | undefined {
  return catalogVersionValue(payload.version);
}

export function catalogVersionValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return undefined;
}

/**
 * Provider catalog `version` is authoritative. `observed_at` is only a
 * tiebreaker when versions are equal or both missing.
 */
export function catalogSnapshotIsNewer(
  candidate: { observedAt: Date; payload: Record<string, unknown> },
  incumbent: { observedAt: Date; payload: Record<string, unknown> },
): boolean {
  const candidateVersion = catalogObjectVersion(candidate.payload);
  const incumbentVersion = catalogObjectVersion(incumbent.payload);
  if (candidateVersion !== undefined && incumbentVersion !== undefined) {
    if (candidateVersion !== incumbentVersion) {
      return candidateVersion > incumbentVersion;
    }
  } else if (candidateVersion !== undefined && incumbentVersion === undefined) {
    return true;
  } else if (candidateVersion === undefined && incumbentVersion !== undefined) {
    return false;
  }
  return candidate.observedAt.getTime() > incumbent.observedAt.getTime();
}
