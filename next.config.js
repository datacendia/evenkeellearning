/** @type {import('next').NextConfig} */

// Content Security Policy.
//
// The app loads fonts from fonts.googleapis.com / fonts.gstatic.com
// (see app/globals.css @import). All other resources are self-hosted.
// KaTeX inlines SVG data URIs for math rendering (image-src data:).
//
// In production, tighten `script-src` further: remove 'unsafe-eval'
// (only needed by the Next.js dev server HMR runtime) and pin the
// nonce or hash of any inline scripts.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",   // unsafe-eval: Next.js dev HMR
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",                               // data: for KaTeX SVG
  "connect-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: CSP,
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-XSS-Protection",
    value: "1; mode=block",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    // Camera/microphone/geolocation are decorative in the current build.
    // Tighten or expand when real device access is wired up.
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    // HSTS: only set this once you have a stable HTTPS deployment.
    // max-age of 1 year (31536000 seconds) plus preload eligibility.
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
];

const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  async headers() {
    return [
      {
        // Apply security headers to every route.
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

module.exports = nextConfig;
