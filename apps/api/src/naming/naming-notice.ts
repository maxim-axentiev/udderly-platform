import type { NamingNoticeKind } from "../database/schema/naming";

export function formatCad(cents: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
  }).format(cents / 100);
}

export function namingNoticeMessage(
  kind: NamingNoticeKind,
  objectName: string,
  priceCents: number,
): { subject: string; text: string } {
  const minimum = formatCad(priceCents);
  if (kind === "underpaid") {
    return {
      subject: `Gift card for ${objectName}`,
      text: [
        `Your gift card for ${objectName} is valid.`,
        "",
        `The purchase is below the ${minimum} minimum for naming rights, so this gift card does not include a naming link or certificate.`,
        "",
        "FareHarbor delivers the gift card itself in a separate message.",
      ].join("\n"),
    };
  }
  return {
    subject: `Gift card for ${objectName}`,
    text: [
      `Your gift card for ${objectName} is valid.`,
      "",
      "The purchase was completed after the naming campaign ended on December 31, 2026 at 11:59 p.m. Eastern Time, so it does not include a naming link or certificate.",
      "",
      `Naming rights for ${objectName} required a gift card of at least ${minimum}.`,
      "",
      "FareHarbor delivers the gift card itself in a separate message.",
    ].join("\n"),
  };
}
