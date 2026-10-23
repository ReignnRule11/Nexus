import { RequireSession } from "@/components/shell/require-session";
import { ModerationPage } from "@/components/pages/moderation-page";

export default function Page() {
  return (
    <main id="main-content" className="page-content">
      <RequireSession>
        <ModerationPage />
      </RequireSession>
    </main>
  );
}
