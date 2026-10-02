export function gaScopedExternalId(
  propertyId: string,
  ...parts: string[]
): string {
  return [propertyId, ...parts].join(":");
}

export function gaReportExternalId(
  propertyId: string,
  family: string,
  startDate: string,
  endDate: string,
): string {
  return gaScopedExternalId(propertyId, family, startDate, endDate);
}

export function gaAdminExternalId(
  propertyId: string,
  resourceId = propertyId,
): string {
  return gaScopedExternalId(propertyId, resourceId);
}
