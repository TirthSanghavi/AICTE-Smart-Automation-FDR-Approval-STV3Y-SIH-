import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FDR Register — AICTE prototype",
  description:
    "Synthetic-data prototype for security deposit and FDR lifecycle management. Not a live AICTE or bank system.",
};

export const viewport: Viewport = {
  themeColor: "#173a34",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
