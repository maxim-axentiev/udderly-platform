import {
  SQUARE_METHOD_CARD,
  SQUARE_METHOD_CASH,
  SQUARE_METHOD_EXTERNAL,
  SQUARE_METHOD_OTHER,
} from "./square.constants";

export function squareOrderStatus(state: unknown): string {
  if (typeof state !== "string" || !state.trim()) {
    return "unknown";
  }
  return state.trim().toLowerCase();
}

export function squarePaymentStatus(status: unknown): string {
  if (typeof status !== "string" || !status.trim()) {
    return "unknown";
  }
  return status.trim().toLowerCase();
}

export function squareRefundStatus(status: unknown): string {
  if (typeof status !== "string" || !status.trim()) {
    return "unknown";
  }
  return status.trim().toLowerCase();
}

export function squarePaymentMethod(sourceType: unknown): string | undefined {
  if (typeof sourceType !== "string" || !sourceType.trim()) {
    return undefined;
  }
  const normalized = sourceType.trim().toUpperCase();
  if (normalized === "CARD") {
    return SQUARE_METHOD_CARD;
  }
  if (normalized === "CASH") {
    return SQUARE_METHOD_CASH;
  }
  if (normalized === "EXTERNAL") {
    return SQUARE_METHOD_EXTERNAL;
  }
  return SQUARE_METHOD_OTHER;
}
