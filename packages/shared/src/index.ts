export const PLATFORM_NAME = "Udderly Platform";

export const PLATFORM_DESCRIPTION =
  "Private business operations platform";

export type HealthStatus = "ok" | "degraded" | "error";

export type HealthResponse = {
  status: HealthStatus;
};
