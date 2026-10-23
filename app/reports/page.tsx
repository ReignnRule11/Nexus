import { RequireSession } from "@/components/shell/require-session";
import { ReportsPage } from "@/components/pages/reports-page";

export default function Page() {
  return (
    <main id="main-content" className="page-content">
      <RequireSession>
        <ReportsPage />
      </RequireSession>
    </main>
  );
}
