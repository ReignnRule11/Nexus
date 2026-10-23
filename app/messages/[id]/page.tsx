import { RequireSession } from "@/components/shell/require-session";
import { ConversationPage } from "@/components/pages/conversation-page";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <main id="main-content" className="page-content">
      <RequireSession>
        <ConversationPage conversationId={id} />
      </RequireSession>
    </main>
  );
}
