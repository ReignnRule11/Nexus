import { RequireSession } from "@/components/shell/require-session";
import { OwnProfilePage } from "@/components/pages/profile-page";

export default function Page() {
  return (
    <main id="main-content" className="page-content">
      <RequireSession>
        <OwnProfilePage />
      </RequireSession>
    </main>
  );
}
