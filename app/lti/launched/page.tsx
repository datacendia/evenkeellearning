// ─────────────────────────────────────────────────────────────────────────────
// app/lti/launched/page.tsx
//
// v1.8.0 — Confirmation surface rendered after a successful LTI 1.3
// launch when the LMS's `target_link_uri` did not point at a more
// specific Even Keel page (or when a pilot wants a quick diagnostic).
//
// This is a SERVER COMPONENT — it reads the LTI session cookie from
// the request, verifies it, and either renders a short context card
// or surfaces a friendly "not launched yet" message.
// ─────────────────────────────────────────────────────────────────────────────

import { cookies } from "next/headers";
import {
  LTI_SESSION_COOKIE_NAME,
  verifyLtiSession,
} from "@/lib/lti/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function LtiLaunchedPage() {
  const cookieStore = cookies();
  const token = cookieStore.get(LTI_SESSION_COOKIE_NAME)?.value;
  const result = await verifyLtiSession(token ?? null);

  if (!result.ok) {
    return (
      <div
        className="min-h-screen"
        style={{ background: "#0b0d10", color: "#e8e6e3" }}
      >
        <div className="max-w-2xl mx-auto p-8 space-y-4">
          <p
            className="font-mono uppercase tracking-widest"
            style={{ fontSize: 11, opacity: 0.55 }}
          >
            Even Keel · LTI · /lti/launched
          </p>
          <h1 className="font-serif text-2xl">No active LTI session</h1>
          <p className="text-sm" style={{ opacity: 0.7 }}>
            This page is only reachable after a successful LTI 1.3
            launch from a configured LMS. If you arrived here directly,
            return to your LMS and click the Even Keel tool link.
          </p>
          <p
            className="text-xs font-mono"
            style={{ opacity: 0.4 }}
          >
            reason: {result.reason}
          </p>
        </div>
      </div>
    );
  }

  const s = result.session;
  return (
    <div
      className="min-h-screen"
      style={{ background: "#0b0d10", color: "#e8e6e3" }}
    >
      <div className="max-w-2xl mx-auto p-8 space-y-4">
        <p
          className="font-mono uppercase tracking-widest"
          style={{ fontSize: 11, opacity: 0.55 }}
        >
          Even Keel · LTI · /lti/launched
        </p>
        <h1 className="font-serif text-2xl">Launch confirmed</h1>
        <p className="text-sm" style={{ opacity: 0.75 }}>
          Welcome back. This page is a pilot landing surface — your
          school's deployment can configure a more specific{" "}
          <code>target_link_uri</code> to bypass it.
        </p>
        <dl
          className="grid grid-cols-1 gap-2 text-sm pt-4"
          style={{ borderTop: "1px dashed #333" }}
        >
          <Field label="Platform">{s.platformId}</Field>
          <Field label="Issuer">{s.iss}</Field>
          <Field label="Deployment">{s.deploymentId}</Field>
          <Field label="Role">{s.role}</Field>
          <Field label="Resource link">{s.resourceLinkId}</Field>
          {s.contextId && <Field label="Course / context">{s.contextId}</Field>}
        </dl>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt
        className="text-xs font-mono uppercase tracking-widest"
        style={{ opacity: 0.55 }}
      >
        {label}
      </dt>
      <dd className="text-sm mt-0.5 font-mono">{children}</dd>
    </div>
  );
}
