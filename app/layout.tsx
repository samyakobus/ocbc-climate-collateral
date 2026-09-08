import type { Metadata } from "next";
import "./globals.css";

// Deliberately no `next/font/google`: it downloads font files at build time, and the
// Day-5 rehearsal rebuilds with the host interface disabled (plan 4.9, AC-11).
export const metadata: Metadata = {
  title: "OCBC Climate Collateral",
  description:
    "Climate-adjusted collateral valuation over a synthetic portfolio. Illustrative figures.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
