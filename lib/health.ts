export const APP_NAME = "nexus";
export const APP_VERSION = "0.1.0";

export type HealthStatus = "ok";

export type HealthResponse = {
  status: HealthStatus;
  service: typeof APP_NAME;
  version: typeof APP_VERSION;
};

export function getApplicationHealth(): HealthResponse {
  return {
    status: "ok",
    service: APP_NAME,
    version: APP_VERSION,
  };
}
