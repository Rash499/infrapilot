import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "@/app/providers";

export const metadata: Metadata = {
  title: {
    default: "InfraPilot — Infrastructure Operations",
    template: "%s · InfraPilot",
  },
  description:
    "Assets, monitoring, security findings, incidents, maintenance and change management in one console.",
  applicationName: "InfraPilot",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6fa" },
    { media: "(prefers-color-scheme: dark)", color: "#080d18" },
  ],
};

/**
 * Runs before first paint: resolves the persisted theme (falling back to the OS
 * preference) and sets the class on <html>. Keeping this inline avoids both a
 * flash of the wrong theme and a hydration mismatch.
 */
const themeBootstrap = `(function(){try{var k="infrapilot-theme";var s=localStorage.getItem(k);var t=s==="light"||s==="dark"?s:(window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark");var e=document.documentElement;e.classList.toggle("dark",t==="dark");e.style.colorScheme=t;}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className="bg-canvas text-fg antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
        >
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
