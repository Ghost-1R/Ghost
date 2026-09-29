import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Your Second Mind",
};

export default function HomePage() {
  return (
    <div className="public-page">
      <header className="public-header">
        <Link className="wordmark" href="/">
          <span className="mark" aria-hidden="true" />
          GHOST
        </Link>
        <Link className="button-secondary" href="/login">
          Sign in
        </Link>
      </header>
      <main className="public-main" id="main">
        <p className="eyebrow">Founder operating system</p>
        <h1>Your second mind.</h1>
        <p className="lede">
          Ghost helps a founder take an idea through research, planning, design, build, test, and
          deployment — and keeps the rules of how you build. Day 1 is the foundation: project state,
          memory, and proof. It does not pretend the rest already exists.
        </p>
        <div className="actions">
          <Link className="button" href="/login">
            Enter Ghost
          </Link>
        </div>
      </main>
      <footer className="public-footer">
        <p>Deployment provider: not selected. Vercel is not used.</p>
      </footer>
    </div>
  );
}
