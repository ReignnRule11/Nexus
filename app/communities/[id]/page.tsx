import { RequireSession } from "@/components/shell/require-session";
import { CommunityDetailPage } from "@/components/pages/community-detail-page";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <main id="main-content" className="page-content">
      <RequireSession>
        <CommunityDetailPage communityId={id} />
      </RequireSession>
    </main>
  );
}
