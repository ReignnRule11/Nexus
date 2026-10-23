import { RequireSession } from "@/components/shell/require-session";
import { CommunitiesPage } from "@/components/pages/communities-page";

export default function Page() {
  return (
    <main id="main-content" className="page-content">
      <RequireSession>
        <CommunitiesPage />
      </RequireSession>
    </main>
  );
}
