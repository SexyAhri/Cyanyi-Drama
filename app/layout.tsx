import type { Metadata } from "next";

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";

import "./globals.css";

export const metadata: Metadata = {
  title: "Cyanyi Drama",
  description: "AI-powered creative workspace for Cyanyi Drama.",
  icons: {
    icon: "/brand/agent-ui-logo.png",
    apple: "/brand/agent-ui-logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      className="h-full overflow-hidden"
      lang="zh-CN"
      suppressHydrationWarning
    >
      <body className="h-full overflow-hidden">
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
