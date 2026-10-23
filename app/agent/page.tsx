import { RequireSession } from "@/components/shell/require-session";
import { AgentPage } from "@/components/pages/agent-page";

export default function Page() {
  return (
    <main id="main-content" className="page-content">
      <RequireSession>
        <AgentPage />
      </RequireSession>
    </main>
  );
}
