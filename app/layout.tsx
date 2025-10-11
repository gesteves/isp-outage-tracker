import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ISP Outage Tracker",
  description: "Track and monitor internet outages from your ISP",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50">
        {children}
      </body>
    </html>
  );
}

