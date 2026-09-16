import {
  SQUARE_STATUS_ACTIVE,
  SQUARE_STATUS_ARCHIVED,
  SQUARE_STATUS_DELETED,
} from "./square.constants";

export function squareCatalogStatus(input: {
  isDeleted?: boolean;
  isArchived?: boolean;
}): string {
  if (input.isDeleted) {
    return SQUARE_STATUS_DELETED;
  }
  if (input.isArchived) {
    return SQUARE_STATUS_ARCHIVED;
  }
  return SQUARE_STATUS_ACTIVE;
}
