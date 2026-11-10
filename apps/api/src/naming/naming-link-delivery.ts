import { namingLinkPath } from "./naming-gift-card";

export function namingLinkUrl(baseUrl: string, token: string): string {
  return new URL(namingLinkPath(token), baseUrl).toString();
}

export function namingCertificateMessage(
  objectName: string,
  submittedName: string,
  url: string,
): { subject: string; text: string } {
  return {
    subject: `Updated naming certificate for ${objectName}`,
    text: [
      `The name recorded for ${objectName} is ${submittedName}.`,
      "",
      "Open the updated certificate with this private link:",
      url,
      "",
      "This link replaces any earlier naming link. The name is already recorded, so this page does not accept another name.",
    ].join("\n"),
  };
}

export function namingLinkMessage(
  objectName: string,
  url: string,
): { subject: string; text: string } {
  return {
    subject: `Naming rights for ${objectName}`,
    text: [
      `You have claimed naming rights for ${objectName} at Udderly Ridiculous.`,
      "",
      "Use this private link to submit one name:",
      url,
      "",
      "Share that link with the person who will receive the gift card. They open it and submit the name.",
      "",
      "FareHarbor delivers the gift card itself in a separate message. This email only delivers the naming link.",
    ].join("\n"),
  };
}

/**
 * Reads the purchaser address from a stored FareHarbor payload.
 * The address is not written onto campaign tables.
 */
export function readNamingPurchaserAddress(payload: unknown): string | undefined {
  if (!isRecord(payload) || !isRecord(payload.booking) || !isRecord(payload.booking.contact)) {
    return undefined;
  }
  const email = payload.booking.contact.email;
  if (typeof email !== "string") {
    return undefined;
  }
  const trimmed = email.trim();
  if (!/^[^@\s]+@[^@\s]+$/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
