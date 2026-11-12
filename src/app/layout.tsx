import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MusicReleases",
  description: "Latest releases from the artists you follow",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
