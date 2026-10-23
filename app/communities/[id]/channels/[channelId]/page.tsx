import { RequireSession } from "@/components/shell/require-session";
import { ChannelPage } from "@/components/pages/channel-page";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string; channelId: string }>;
}) {
  const { id, channelId } = await params;
  return (
    <main id="main-content" className="page-content">
      <RequireSession>
        <ChannelPage communityId={id} channelId={channelId} />
      </RequireSession>
    </main>
  );
}
