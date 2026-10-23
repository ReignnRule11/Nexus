import { RequireSession } from "@/components/shell/require-session";
import { MessagesPage } from "@/components/pages/messages-page";

export default function Page() {
  return (
    <main id="main-content" className="page-content">
      <RequireSession>
        <MessagesPage />
      </RequireSession>
    </main>
  );
}
