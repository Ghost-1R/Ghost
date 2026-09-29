import type { Metadata } from "next";
import { IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
import { ExperienceProvider } from "@/components/ghost/experience";
import "./globals.css";

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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <ExperienceProvider>{children}</ExperienceProvider>
      </body>
    </html>
  );
}
