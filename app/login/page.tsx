import Link from "next/link";
import { LoginForm } from "@/components/auth/auth-forms";

export default function LoginPage() {
  return (
    <main id="main-content" className="page-narrow">
      <h1>Sign in</h1>
      <LoginForm />
      <p>
        Need an account? <Link href="/register">Create one</Link>.
      </p>
    </main>
  );
}
