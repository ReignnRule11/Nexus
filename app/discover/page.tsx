import { RequireSession } from "@/components/shell/require-session";
import { DiscoverPage } from "@/components/pages/discover-page";

export default function Page() {
  return (
    <main id="main-content" className="page-content">
      <RequireSession>
        <DiscoverPage />
      </RequireSession>
    </main>
  );
}
