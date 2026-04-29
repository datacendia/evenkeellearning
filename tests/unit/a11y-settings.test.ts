// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/a11y-settings.test.ts
//
// Pin the observable contract of the accessibility settings module:
//   1. Defaults are all-false.
//   2. Round-trip through localStorage preserves every key.
//   3. Malformed JSON falls back to defaults silently.
//   4. Non-boolean values for known keys are coerced back to defaults.
//   5. Per-key updates do not stomp other keys.
//   6. resetA11ySettings() restores defaults.
//   7. applyA11ySettingsToDocument writes every data-a11y-* attribute.
//   8. hasA11yOverrides reflects whether any setting is non-default.
//
// Why these specific properties: SAFEGUARDING.md §1.5 makes
// `assistiveInput=true` an equity-critical signal, so we test that it
// survives a malformed-input round trip and that nothing else can
// silently turn it off.
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_A11Y_SETTINGS,
  applyA11ySettingsToDocument,
  getA11ySettings,
  hasA11yOverrides,
  resetA11ySettings,
  setA11ySettings,
  updateA11ySetting,
  type A11ySettings,
} from "@/lib/a11y/settings";

const STORAGE_KEY = "evenkeel/a11y/v1";

describe("a11y/settings", () => {
  beforeEach(() => {
    window.localStorage.clear();
    // Reset documentElement attributes before each test so applyA11y…
    // assertions are not polluted by previous runs.
    const html = document.documentElement;
    [
      "data-a11y-dyslexia-font",
      "data-a11y-large-spacing",
      "data-a11y-large-text",
      "data-a11y-high-contrast",
      "data-a11y-focus-mode",
      "data-a11y-assistive-input",
      "data-a11y-literal-tone",
    ].forEach((attr) => html.removeAttribute(attr));
  });

  it("returns all-false defaults when storage is empty", () => {
    const s = getA11ySettings();
    expect(s).toEqual(DEFAULT_A11Y_SETTINGS);
    Object.values(s).forEach((v) => expect(v).toBe(false));
  });

  it("round-trips a fully-true settings object", () => {
    const all: A11ySettings = {
      dyslexiaFont: true,
      largeSpacing: true,
      largeText: true,
      highContrast: true,
      focusMode: true,
      assistiveInput: true,
      literalTone: true,
    };
    setA11ySettings(all);
    expect(getA11ySettings()).toEqual(all);
  });

  it("falls back to defaults on malformed JSON", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not json");
    expect(getA11ySettings()).toEqual(DEFAULT_A11Y_SETTINGS);
  });

  it("ignores non-boolean values for known keys", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        dyslexiaFont: "yes",
        assistiveInput: 1,
        focusMode: null,
      }),
    );
    expect(getA11ySettings()).toEqual(DEFAULT_A11Y_SETTINGS);
  });

  it("updateA11ySetting changes one key without touching others", () => {
    setA11ySettings({ ...DEFAULT_A11Y_SETTINGS, dyslexiaFont: true });
    const after = updateA11ySetting("assistiveInput", true);
    expect(after.dyslexiaFont).toBe(true);
    expect(after.assistiveInput).toBe(true);
    expect(after.focusMode).toBe(false);
  });

  it("resetA11ySettings restores defaults and clears prior toggles", () => {
    setA11ySettings({ ...DEFAULT_A11Y_SETTINGS, assistiveInput: true });
    expect(getA11ySettings().assistiveInput).toBe(true);
    const after = resetA11ySettings();
    expect(after).toEqual(DEFAULT_A11Y_SETTINGS);
    expect(getA11ySettings()).toEqual(DEFAULT_A11Y_SETTINGS);
  });

  it("applyA11ySettingsToDocument writes every data-a11y-* attribute", () => {
    const s: A11ySettings = {
      ...DEFAULT_A11Y_SETTINGS,
      dyslexiaFont: true,
      assistiveInput: true,
      focusMode: false,
    };
    applyA11ySettingsToDocument(s);
    const html = document.documentElement;
    expect(html.getAttribute("data-a11y-dyslexia-font")).toBe("true");
    expect(html.getAttribute("data-a11y-assistive-input")).toBe("true");
    expect(html.getAttribute("data-a11y-focus-mode")).toBe("false");
    expect(html.getAttribute("data-a11y-high-contrast")).toBe("false");
  });

  it("hasA11yOverrides distinguishes default from any non-default state", () => {
    expect(hasA11yOverrides(DEFAULT_A11Y_SETTINGS)).toBe(false);
    expect(
      hasA11yOverrides({ ...DEFAULT_A11Y_SETTINGS, assistiveInput: true }),
    ).toBe(true);
    expect(
      hasA11yOverrides({ ...DEFAULT_A11Y_SETTINGS, literalTone: true }),
    ).toBe(true);
  });
});
