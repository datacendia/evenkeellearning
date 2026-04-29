// ─────────────────────────────────────────────────────────────────────────────
// lib/safety/notifications.ts
//
// Browser-Notification channel for crisis alerts.
//
// What this is
// ────────────
// A real, client-side, server-free out-of-band channel. When the parent
// has chosen the `"in-app+browser"` crisis channel AND has granted the
// browser's Notification permission, this module subscribes to the
// `safeguarding.escalation.requested` data-bus event and fires a system
// `Notification` with the same category-only payload the bus already
// carries. No new data leaves the device; the privacy contract pinned by
// `tests/unit/escalation-queue.test.ts` is preserved.
//
// What this is NOT
// ────────────────
// • Not Web Push. Web Push needs a service worker + VAPID + a push server.
//   That remains deferred (`CrisisChannel = "in-app+push"`).
// • Not SMS / email. Those need an out-of-band provider (Twilio, etc.)
//   and remain deferred (`"in-app+sms"`).
// • Not a service-worker-backed background notification. The Notification
//   only fires while at least one tab on this origin is open. If every
//   parent tab is closed the alert still lands on the in-app strip when
//   they reopen `/parent` (the data-bus ring buffer survives), but no
//   system notification will appear retroactively. Documented in the
//   Parent Safety Centre copy.
//
// Privacy
// ───────
// Notification body intentionally never contains the matched text, the
// learner's free-form input, or any field beyond what `safeguarding.
// escalation.requested` already publishes (category + jurisdiction + age
// band). See `lib/safeguarding/escalation-queue.ts` privacy contract.
// ─────────────────────────────────────────────────────────────────────────────

import { subscribe } from "@/lib/data-bus";
import { getSafetySettings } from "@/lib/safety/settings";

export type NotificationPermissionState =
  | "unsupported" // browser has no Notification API at all
  | "default" // not yet asked
  | "granted"
  | "denied";

/**
 * Inspects the browser's permission state without prompting. SSR-safe.
 */
export function getNotificationPermission(): NotificationPermissionState {
  if (typeof window === "undefined") return "unsupported";
  if (typeof Notification === "undefined") return "unsupported";
  const p = Notification.permission;
  if (p === "granted" || p === "denied" || p === "default") return p;
  return "default";
}

/**
 * Prompts the user for notification permission. Returns the resulting
 * state. SSR-safe (returns "unsupported"). Idempotent — calling when
 * already granted is a no-op.
 */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (typeof window === "undefined") return "unsupported";
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  try {
    const p = await Notification.requestPermission();
    if (p === "granted" || p === "denied" || p === "default") return p;
    return "default";
  } catch {
    return "default";
  }
}

/**
 * Translate an escalation event payload into a short, privacy-respecting
 * notification body. Pure function so it is trivially testable.
 *
 * Contract (pinned by tests):
 *   • Body never contains a free-form text field.
 *   • Body lists category + jurisdiction + (optional) age band.
 *   • Body is at most ~140 chars to fit in OS notification UIs.
 */
export function formatCrisisNotification(payload: {
  crisisPatternCategory?: string;
  jurisdiction?: string;
  studentAgeBand?: string;
}): { title: string; body: string } {
  const cat = payload.crisisPatternCategory ?? "unknown";
  const j = payload.jurisdiction ?? "—";
  const age = payload.studentAgeBand ? `, age ${payload.studentAgeBand}` : "";
  const title = "Even Keel — Safeguarding alert";
  const body =
    `Pattern category: ${cat}. Jurisdiction: ${j}${age}. ` +
    `Open the Parent surface to review and dispatch.`;
  return { title, body: body.slice(0, 240) };
}

/**
 * Subscribe to the data-bus and fire a browser Notification on every
 * `safeguarding.escalation.requested` event, **iff** all of the following
 * are true at firing time:
 *
 *   1. The Notification API is supported.
 *   2. The user has granted permission.
 *   3. The current Safety Centre settings have crisis enabled AND the
 *      channel is `"in-app+browser"`.
 *
 * Returns an unsubscribe function. SSR-safe (returns a no-op).
 *
 * The conditions are re-evaluated *per event*, not at subscription time.
 * That way, toggling the channel off in another tab takes effect on the
 * very next event without the parent having to refresh.
 */
export function subscribeCrisisNotifications(): () => void {
  if (typeof window === "undefined") return () => {};
  if (typeof Notification === "undefined") return () => {};

  return subscribe((ev) => {
    if (ev.type !== "safeguarding.escalation.requested") return;
    const settings = getSafetySettings();
    if (!settings.crisis.enabled) return;
    if (settings.crisis.channel !== "in-app+browser") return;
    if (Notification.permission !== "granted") return;
    try {
      const { title, body } = formatCrisisNotification(
        ev.payload as Record<string, string>,
      );
      new Notification(title, {
        body,
        // `tag` collapses repeated alerts of the same category on most
        // platforms — useful when a learner is in a sustained crisis
        // pattern and we don't want a notification flood.
        tag: `evenkeel-safeguarding-${(ev.payload as Record<string, string>).crisisPatternCategory ?? "unknown"}`,
        // The payload is short, no `data` is attached so the OS-level
        // notification cache cannot leak more than what is rendered.
      });
    } catch {
      // Some platforms throw inside the Notification constructor when
      // permission was revoked between the check and the call. We
      // swallow — the in-app feed strip is still live.
    }
  });
}
