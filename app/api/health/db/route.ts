import { getDatabaseHealth } from "@/lib/db-health";
import { applySecurityHeaders } from "@/lib/security-headers";

export async function GET() {
  const result = await getDatabaseHealth();
  const headers = new Headers({ "content-type": "application/json" });
  applySecurityHeaders(headers);
  return new Response(JSON.stringify(result.body), {
    status: result.httpStatus,
    headers,
  });
}
