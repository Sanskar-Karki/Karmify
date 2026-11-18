import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter, Plus_Jakarta_Sans } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import { PwaSetup } from "@/components/shared/PwaSetup";

// Inter for everything you read (clear at small sizes, numbers line up in
// tables); Plus Jakarta Sans for headings.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Karmify",
  description: "Smart Inventory & ERP for growing businesses",
  applicationName: "Karmify",
  // Added to an iPhone home screen, it opens full-screen like an app, named "Karmify".
  // (The manifest, app/manifest.ts, does the same for Android and computers.)
  appleWebApp: { capable: true, title: "Karmify", statusBarStyle: "default" },
};

// No themeColor here: the colour of the phone's status bar follows Karmify's own
// light/dark switch (not the phone's setting), so it's set by the script below.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/**
 * Runs before the page paints: applies the saved theme, gives the status bar
 * the top bar's colour, and holds on to the install prompt if it fires before
 * the app has loaded (lib/pwa.ts picks it up).
 */
const HEAD_SCRIPT = `try{var d=localStorage.getItem("theme")==="dark";if(d)document.documentElement.classList.add("dark");var m=document.createElement("meta");m.name="theme-color";m.id="app-theme-color";m.content=d?"#171717":"#ffffff";document.head.prepend(m)}catch(e){}window.addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__karmifyInstallPrompt=e});`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${jakarta.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: HEAD_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <PwaSetup />
        {/* No "Sign in / Sign up" bar: every page needs a login, so signed-out
            visitors land on /sign-in, which is the form itself. */}
        <ClerkProvider>{children}</ClerkProvider>
      </body>
    </html>
  );
}
