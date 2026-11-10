const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type NamingLinkCommand = {
  action: "issue";
  reservationId: string;
  reissue: boolean;
};

export function parseNamingLinkCommand(
  argv: string[],
): NamingLinkCommand | undefined {
  const [action, ...rest] = argv;
  if (action !== "issue") {
    return undefined;
  }
  let reservationId: string | undefined;
  let reissue = false;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--reissue") {
      reissue = true;
      continue;
    }
    const matched = /^--reservation(?:=([\s\S]*))?$/.exec(arg);
    if (!matched) {
      return undefined;
    }
    const value = matched[1] ?? rest[index + 1];
    if (matched[1] === undefined) {
      index += 1;
    }
    if (!value || value.startsWith("--") || reservationId) {
      return undefined;
    }
    reservationId = value.trim();
  }
  if (!reservationId || !UUID_PATTERN.test(reservationId)) {
    return undefined;
  }
  return { action: "issue", reservationId, reissue };
}

export function usageText(): string {
  return [
    "Usage: npm run naming:link:dev -- issue --reservation <uuid>",
    "   or: npm run naming:link:dev -- issue --reservation <uuid> --reissue",
    "Issues one naming link for a claimed reservation and prints it once.",
    "--reissue invalidates the previous link.",
  ].join("\n");
}
