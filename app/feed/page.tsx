import { RequireSession } from "@/components/shell/require-session";
import { FeedPage } from "@/components/pages/feed-page";

export default function Page() {
  return (
    <main id="main-content" className="page-content">
      <RequireSession>
        <FeedPage />
      </RequireSession>
    </main>
  );
}
