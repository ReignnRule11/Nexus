import { getApplicationHealth } from "@/lib/health";
import { applySecurityHeaders } from "@/lib/security-headers";

export async function GET() {
  const headers = new Headers({ "content-type": "application/json" });
  applySecurityHeaders(headers);
  return new Response(JSON.stringify(getApplicationHealth()), {
    status: 200,
    headers,
  });
}
