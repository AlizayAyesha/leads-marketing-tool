import type { Metadata } from "next";
import { Geist_Mono, Outfit, Syne } from "next/font/google";

import { AppShell } from "@/components/layout/app-shell";
import { describeAuthConfig } from "@/lib/auth/config";
import { evaluateSenderConfiguration } from "@/lib/outreach/sender-config";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

const syne = Syne({
  variable: "--font-syne",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Leads Marketing Tool",
  description: "Open-source lead discovery, qualification and outreach. Built by Zar Labs (zarlabs.online).",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const auth = describeAuthConfig();
  const sender = evaluateSenderConfiguration();
  const notice = !auth.verifierReady
    ? auth.detail
    : auth.enforcement === "open"
      ? "Authentication is not enforced in this process. Do not expose it."
      : sender.blockCode
        ? sender.problems[0]
        : null;
  return (
    <html
      lang="en"
      className={`${outfit.variable} ${syne.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full" suppressHydrationWarning>
        <AppShell notice={notice}>{children}</AppShell>
      </body>
    </html>
  );
}
