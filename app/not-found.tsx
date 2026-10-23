import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main-content" className="page-narrow">
      <h1>Not found</h1>
      <p>That page is not available.</p>
      <Link href="/">Return home</Link>
    </main>
  );
}
