import { RequireSession } from "@/components/shell/require-session";
import { NotificationsPage } from "@/components/pages/notifications-page";

export default function Page() {
  return (
    <main id="main-content" className="page-content">
      <RequireSession>
        <NotificationsPage />
      </RequireSession>
    </main>
  );
}
