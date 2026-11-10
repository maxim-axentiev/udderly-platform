const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type NamingDeliverCommand = {
  reservationId: string;
  reissue: boolean;
};

export function parseNamingDeliverCommand(
  argv: string[],
): NamingDeliverCommand | undefined {
  let reservationId: string | undefined;
  let reissue = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--reissue") {
      reissue = true;
      continue;
    }
    const matched = /^--reservation(?:=([\s\S]*))?$/.exec(arg);
    if (!matched) {
      return undefined;
    }
    const value = matched[1] ?? argv[index + 1];
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
  return { reservationId, reissue };
}

export function deliverUsageText(): string {
  return [
    "Usage: npm run naming:deliver:dev -- --reservation <uuid>",
    "   or: npm run naming:deliver:dev -- --reservation <uuid> --reissue",
    "Emails the naming link for a verified claim. The link is not printed or stored.",
    "--reissue invalidates the previous link and emails a replacement.",
    "If the provider accepted a message but the token hash was not stored, run the command again.",
    "That sends a new link. An earlier message from that failed attempt will not work.",
  ].join("\n");
}

export function deliverResultText(
  outcome:
    | "sent"
    | "already_sent"
    | "already_issued"
    | "already_named"
    | "in_progress"
    | "not_eligible"
    | "not_found"
    | "not_configured"
    | "smtp_failed"
    | "uncommitted",
): string {
  switch (outcome) {
    case "sent":
      return "Naming link emailed. It is not stored. Delivery is not exactly once.";
    case "already_sent":
      return "A naming link was already emailed. Reissue with --reissue to invalidate it and send a new one.";
    case "already_issued":
      return "A naming link already exists. Reissue with --reissue to invalidate it and email a new one.";
    case "already_named":
      return "This item is already named. The current link stays valid.";
    case "in_progress":
      return "A send is in progress. If it is still unfinished after 90 seconds, run this command again. A replacement link is sent only when no token hash is stored.";
    case "not_eligible":
      return "This reservation cannot receive a naming link.";
    case "not_found":
      return "Naming reservation was not found.";
    case "not_configured":
      return "Naming email is not configured.";
    case "smtp_failed":
      return "The email was not accepted. No naming link is active. Run the command again to retry.";
    case "uncommitted":
      return "The email was accepted, but the naming token was not stored. No link is active. Run the command again to send a replacement. The earlier message will not work.";
  }
}
