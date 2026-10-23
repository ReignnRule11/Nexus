import Link from "next/link";

export default function Home() {
  return (
    <main id="main-content" className="page-narrow">
      <h1>Project Nexus</h1>
      <p>Connect with purpose.</p>
      <p>
        Sign in to use the feed, communities, messages, and notifications. Product features
        require an account.
      </p>
      <p className="row">
        <Link className="btn btn-primary" href="/login">
          Sign in
        </Link>
        <Link className="btn btn-secondary" href="/register">
          Create account
        </Link>
      </p>
    </main>
  );
}
