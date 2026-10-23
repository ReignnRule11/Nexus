import { RequireSession } from "@/components/shell/require-session";
import { PostPage } from "@/components/pages/post-page";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <main id="main-content" className="page-content">
      <RequireSession>
        <PostPage postId={id} />
      </RequireSession>
    </main>
  );
}
