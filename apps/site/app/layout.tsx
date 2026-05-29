import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

const sans = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const mono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

const display = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://nixway.dev"),
  title: {
    default: "Nixway · Self-hosted Platform-as-a-Service for your fleet",
    template: "%s · Nixway",
  },
  description:
    "Nixway is a self-hosted PaaS. Push to a Git repo, Nixway builds it, deploys it across your own servers, and gives you a Heroku-grade console without the Heroku-grade bill.",
  openGraph: {
    title: "Nixway · Self-hosted Platform-as-a-Service",
    description:
      "Heroku-grade developer experience. Your own servers. Your AWS bill, not a 10x markup.",
    type: "website",
    images: [{ url: "/og.png", width: 600, height: 600, alt: "Nixway" }],
  },
  twitter: {
    card: "summary",
    title: "Nixway · Self-hosted Platform-as-a-Service",
    description: "Heroku-grade developer experience. Your own servers.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`dark ${sans.variable} ${mono.variable} ${display.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
