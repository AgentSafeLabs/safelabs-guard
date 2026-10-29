import type { Metadata } from "next";
import SiteNav from "@/components/SiteNav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Safelabs Guard",
  description:
    "Checks what a vision/voice agent proposes against what it sees and hears, and blocks it when they disagree. PackProof demo.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <SiteNav />
        {children}
      </body>
    </html>
  );
}
