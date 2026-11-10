import { NAMING_SUBMITTED_NAME_MAX } from "./naming.constants";

const UNSAFE_NAME = /[<>]|[\p{Cc}\p{Zl}\p{Zp}]/u;

export function normalizeSubmittedName(input: string): string | undefined {
  const name = input.trim();
  if (!name || [...name].length > NAMING_SUBMITTED_NAME_MAX) {
    return undefined;
  }
  if (UNSAFE_NAME.test(name)) {
    return undefined;
  }
  return name;
}
