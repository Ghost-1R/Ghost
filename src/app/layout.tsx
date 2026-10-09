import type { Metadata } from "next";
import { IBM_Plex_Mono, Instrument_Sans, Syne } from "next/font/google";
import { cookies } from "next/headers";
import { ExperienceProvider } from "@/components/ghost/experience";
import { APPEARANCE_COOKIE, REDUCE_MOTION_COOKIE } from "@/lib/preferences/cookies";
import "./globals.css";

const display = Syne({
  subsets: ["latin"],
  variable: "--font-display-family",
});

const sans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-sans-family",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono-family",
});

export const metadata: Metadata = {
  title: {
    default: "GHOST",
    template: "%s · GHOST",
  },
  description: "Your second mind. Turn ideas into products while remembering how you build.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const jar = await cookies();
  const appearance = jar.get(APPEARANCE_COOKIE)?.value ?? "DARK";
  const reduceMotion = jar.get(REDUCE_MOTION_COOKIE)?.value === "1" ? "1" : "0";
  const theme = appearance === "LIGHT" ? "light" : appearance === "SYSTEM" ? "system" : "dark";

  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable}`}
      data-theme={theme === "system" ? undefined : theme}
      data-appearance={appearance}
      data-reduce-motion={reduceMotion}
    >
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <ExperienceProvider>{children}</ExperienceProvider>
      </body>
    </html>
  );
}
