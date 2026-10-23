import Link from "next/link";
import { RegisterForm } from "@/components/auth/auth-forms";

export default function RegisterPage() {
  return (
    <main id="main-content" className="page-narrow">
      <h1>Create account</h1>
      <RegisterForm />
      <p>
        Already have an account? <Link href="/login">Sign in</Link>.
      </p>
    </main>
  );
}
