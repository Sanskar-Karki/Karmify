import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * Clerk's sign-in server (e.g. https://clerk.karmaluoriginals.com), read from the
 * publishable key, which is "pk_live_" + base64("<host>$"). Empty if it can't be read.
 */
function clerkFrontendApi() {
  const encoded = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.split("_")[2] ?? "";
  const host = Buffer.from(encoded, "base64").toString("utf8").replace(/\$$/, "");
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host) ? `https://${host}` : "";
}

const clerk = clerkFrontendApi();

/**
 * What a Karmify page may load: its own scripts, Clerk's sign-in (with
 * Cloudflare's bot check), and product photos from any https address.
 * Nothing may frame it. Clerk's list: clerk.com/docs/guides/secure/best-practices/csp-headers
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${clerk} https://challenges.cloudflare.com https://*.protect.clerk.com${isDev ? " 'unsafe-eval'" : ""}`,
  `connect-src 'self' ${clerk} https://*.protect.clerk.com:* https://img.clerk.com https://clerk-telemetry.com https://*.clerk-telemetry.com${isDev ? " ws: wss:" : ""}`,
  "img-src 'self' data: blob: https:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "frame-src 'self' https://challenges.cloudflare.com https://*.protect.clerk.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
        ],
      },
    ];
  },
};

export default nextConfig;
