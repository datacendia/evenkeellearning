// ─────────────────────────────────────────────────────────────────────────────
// next.config.js
//
// v1.5.5 — adds security headers (M-7 in the v1.5.4 audit).
//
// What's enforced and why
// ───────────────────────
// • Strict-Transport-Security: HTTPS-only, 2 years, includeSubDomains.
//   Schools deploying behind a custom domain get HSTS by default.
// • Content-Security-Policy: scoped to the same origin plus
//   `cdn.jsdelivr.net` for the opt-in JSXGraph + Pyodide heavy-CAS
//   features (both documented as CDN-served unless self-hosted; see
//   lib/cas/heavy-client.ts and lib/geometry/figure-spec.ts).
//   - `'unsafe-inline'` on style-src is required by KaTeX (inline style
//      attributes on rendered math) and by Tailwind's runtime inline
//      style emission. It is *not* enabled on script-src.
//   - `'unsafe-eval'` is added on script-src ONLY in development, to
//      keep the Next.js HMR runtime working. Production CSP omits it.
//   - `frame-ancestors 'none'` is the modern replacement for
//      X-Frame-Options: DENY; both ship for compatibility with older
//      browsers.
// • Permissions-Policy: aggressively denies camera, microphone,
//   geolocation, accelerometer, gyroscope, magnetometer, payment, USB,
//   serial, midi, hid, bluetooth, idle-detection, otp-credentials,
//   storage-access, autoplay, fullscreen, picture-in-picture, web-share,
//   `interest-cohort` (FLoC), and `browsing-topics`. Even Keel's
//   "no biometrics ever" promise is enforced here at the browser level,
//   not just by absence of API calls.
// • X-Content-Type-Options: nosniff — defence-in-depth for static assets.
// • Referrer-Policy: strict-origin-when-cross-origin — never leak full
//   URLs (which may include problem ids or session ids) cross-origin.
// • X-Frame-Options: DENY — legacy peer of frame-ancestors.
//
// What is intentionally NOT enabled
// ─────────────────────────────────
// • `Cross-Origin-Opener-Policy: same-origin` — would break the
//   WebAuthn passkey ceremony in some authenticator configurations.
//   Revisit when passkey enrolment is the default flow.
// • `Cross-Origin-Embedder-Policy: require-corp` — would block
//   Pyodide's CDN-served wasm. Revisit alongside the self-host path
//   in docs/ROADMAP_HIGHER_MATHS.md.
// ─────────────────────────────────────────────────────────────────────────────

const isProd = process.env.NODE_ENV === "production";

const CSP_DIRECTIVES = [
  `default-src 'self'`,
  // Scripts: self + CDN for opt-in CAS/figure features.
  // Dev needs unsafe-eval for Next.js HMR; prod doesn't.
  `script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net${isProd ? "" : " 'unsafe-eval'"}`,
  // Web workers (heavy CAS) load from /workers/* on the same origin,
  // but Pyodide spawns its own worker imports from jsDelivr.
  `worker-src 'self' blob: https://cdn.jsdelivr.net`,
  // Styles: KaTeX + Tailwind both emit inline styles at runtime.
  `style-src 'self' 'unsafe-inline'`,
  // Images: chart.js renders to canvas → data:; uploads → blob:.
  `img-src 'self' data: blob:`,
  // Fonts: data: covers KaTeX font fallbacks.
  `font-src 'self' data:`,
  // Network: same-origin only; jsDelivr for opt-in CDN features.
  `connect-src 'self' https://cdn.jsdelivr.net`,
  // No <object>, <embed>, <applet>.
  `object-src 'none'`,
  // <base> can only point to same origin — defence against base-href hijacking.
  `base-uri 'self'`,
  // Forms post to same origin only.
  `form-action 'self'`,
  // Cannot be embedded in an iframe anywhere.
  `frame-ancestors 'none'`,
  // Upgrade insecure mixed content in production.
  ...(isProd ? [`upgrade-insecure-requests`] : []),
];

const PERMISSIONS_POLICY = [
  // Hard "no biometrics ever" promise — enforced at the browser level.
  "camera=()",
  "microphone=()",
  "geolocation=()",
  "accelerometer=()",
  "gyroscope=()",
  "magnetometer=()",
  "payment=()",
  "usb=()",
  "serial=()",
  "midi=()",
  "hid=()",
  "bluetooth=()",
  "idle-detection=()",
  "otp-credentials=()",
  "storage-access=()",
  "autoplay=()",
  "fullscreen=(self)",
  "picture-in-picture=()",
  "web-share=()",
  "interest-cohort=()",
  "browsing-topics=()",
].join(", ");

const SECURITY_HEADERS = [
  {
    key: "Content-Security-Policy",
    value: CSP_DIRECTIVES.join("; "),
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
];

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
    // HSTS: only enable once you have a confirmed HTTPS-only deployment.
    // max-age=31536000 (1 year) with includeSubDomains is HSTS-preload eligible.
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
        // Apply to every route, including API routes and static assets.
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

module.exports = nextConfig;
