import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Safelabs Guard",
  description: "Runtime guard for vision/voice agents. PackProof demo.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
