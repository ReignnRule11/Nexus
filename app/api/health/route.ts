import { getApplicationHealth } from "@/lib/health";

export async function GET() {
  return Response.json(getApplicationHealth(), { status: 200 });
}
