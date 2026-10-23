import { RequireSession } from "@/components/shell/require-session";
import { UserPage } from "@/components/pages/user-page";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <main id="main-content" className="page-content">
      <RequireSession>
        <UserPage userId={id} />
      </RequireSession>
    </main>
  );
}
