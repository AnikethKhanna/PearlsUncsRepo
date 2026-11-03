import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "NMU Onboarding", template: "%s · NMU Onboarding" },
  description: "No More Under program onboarding management",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
