import Image from "next/image";
import { CoreStateLabel, GhostCore } from "@/components/ghost/experience";

export const HERO_PATH = ["Plan", "Design", "Build", "Test", "Deploy", "Learn", "Grow"] as const;

export function DashboardHero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-art" aria-hidden="true">
        <Image
          className="hero-image"
          src="/ghost/hero.webp"
          alt=""
          fill
          sizes="(max-width: 899px) 100vw, 1100px"
          loading="eager"
          fetchPriority="high"
          unoptimized
        />
        <span className="hero-scrim" />
      </div>
      <div className="hero-content">
        <h1 className="hero-title" id="hero-title" aria-label="Ghost">
          <span aria-hidden="true">GH</span>
          <GhostCore size="title" />
          <span className="sr-only" aria-hidden="true">O</span>
          <span aria-hidden="true">ST</span>
        </h1>
        <p className="hero-tagline">Your second mind</p>
        <p className="hero-lede">From idea to launch — built your way.</p>
        <ul className="hero-path" aria-label="How Ghost works">
          {HERO_PATH.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ul>
        <p className="hero-status">
          Core <CoreStateLabel />
        </p>
      </div>
    </section>
  );
}
