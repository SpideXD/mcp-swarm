import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NavRail } from "@/components/layout/nav-rail";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MCP Swarm Dashboard",
  description: "Monitor and manage MCP servers",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <TooltipProvider>
          <Toaster
            theme="dark"
            position="bottom-right"
            toastOptions={{
              style: {
                background: "#2b2d31",
                border: "1px solid #383a40",
                color: "#f2f3f5",
              },
            }}
          />
          <div className="flex h-screen overflow-hidden">
            <NavRail />
            <Sidebar />
            <main className="flex flex-1 flex-col overflow-hidden">
              <Header />
              <div className="flex-1 overflow-auto p-6">{children}</div>
            </main>
          </div>
        </TooltipProvider>
      </body>
    </html>
  );
}
