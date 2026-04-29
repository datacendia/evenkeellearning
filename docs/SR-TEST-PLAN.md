# Even Keel Learning — Screen Reader Test Plan (NVDA / JAWS / VoiceOver)

> **Purpose:** This plan is the human complement to `tests/e2e/a11y.spec.ts`.
> Axe-core catches many WCAG issues, but it cannot validate the lived
> experience of a student using a screen reader.
>
> **Scope:** Even Keel Learning v1.3.x learner surfaces and shared chrome.
>
> **Pass condition:** Every step below produces the expected announcements,
> and every interactive control is reachable by keyboard and has a unique,
> unambiguous name.

---

## 0. Test environment

- **Windows:** NVDA (latest) + Firefox OR Chrome
- **Windows (enterprise):** JAWS (latest) + Chrome
- **macOS / iPadOS:** VoiceOver + Safari

### Browser state

- Clear site data for `localhost:3000` (or the deployed domain).
- Start on the landing page `/`.
- Ensure the OS has both modes tested:
  - Normal motion
  - Reduced motion (Windows: Settings → Accessibility → Visual effects → Animation effects OFF)

---

## 1. Global chrome: skip link + landmarks

### 1.1 Skip link is the first focusable element

**Page:** any surface (e.g. `/student`)

Steps:

1. Reload the page.
2. Press `Tab` once.

Expected:

- Focus lands on the skip link, visible on screen.
- Screen reader announces: **"Skip to main content, link"** (or equivalent).

3. Press `Enter`.

Expected:

- Focus moves to the main region (`#kl-main`).
- Screen reader announces **"main"** / **"main landmark"**.

### 1.2 Landmarks are discoverable

Expected landmarks exist:

- **Banner** (`<header role="banner">`)
- **Navigation** (`<nav role="navigation" aria-label="Surface sections">`) when present
- **Main** (`<main role="main" id="kl-main">`)

NVDA:

- Press `D` to cycle landmarks.

Expected:

- NVDA cycles Banner → Navigation (if present) → Main.

VoiceOver:

- `VO+U` → Landmarks.

Expected:

- Banner / Navigation / Main listed.

---

## 2. Accessibility settings panel

**Page:** any surface, e.g. `/student`

Steps:

1. Tab until focus reaches the accessibility button.

Expected:

- Screen reader announces: **"Accessibility settings, button"**.

2. Activate it.

Expected:

- Panel opens.
- Screen reader announces dialog context:
  - **"Accessibility settings, dialog"**
  - Focus moves to the close button.

3. Toggle "Dyslexia-friendly typeface".

Expected:

- Switch is announced with `role="switch"` semantics:
  - **"Dyslexia-friendly typeface, switch, on/off"**

4. Press `Escape`.

Expected:

- Dialog closes.
- Focus returns to the accessibility button.

---

## 3. AgeBandGate (first visit to /student)

**Page:** `/student` with cleared site data.

Steps:

1. Load `/student`.

Expected:

- Heading announced: **"How old are you?"**
- The 3 age-band options are buttons and are reachable by Tab.

2. Choose "Under 13".

Expected:

- Guardian acknowledgement checkbox is reachable and announced:
  - **"A parent or guardian is with me, checkbox, not checked"**

3. Verify assistive input declaration exists.

Expected:

- Checkbox reachable and announced:
  - **"I use assistive input technology, checkbox"**
- The explanation is present as text.

4. Activate Continue.

Expected:

- Gate releases to the student surface.

---

## 4. EkeChat: conversation + input + hint + dictation

**Page:** `/student`

### 4.1 Conversation is announced as a log

Expected:

- Conversation container has `role="log"`, `aria-live="polite"`, `aria-relevant="additions"`.
- When a new Eke message arrives, it is announced without focus jumping.

Steps:

1. Focus the textarea.
2. Type a short message (e.g., "I think x is 6") and press Enter.

Expected:

- Screen reader announces the new Eke message content.
- Focus remains in the input area (no forced scroll focus shift).

### 4.2 Hint button has a name

Steps:

1. Tab to the Hint button.

Expected:

- Announces: **"Ask Eke for a tiered hint, button"**.

2. Activate.

Expected:

- A new Eke hint arrives; announced.

### 4.3 Send button has a name

Expected:

- Announces: **"Send message to Eke, button"**.

### 4.4 Speech-to-text disclosure is explicit

Steps:

1. Tab to the Mic button.
2. Activate.

Expected:

- Dialog opens; announced as dialog.
- Disclosure text is readable via screen reader.

3. Activate "Start dictation".

Expected:

- Screen reader announces that dictation started, or the UI changes to "Listening…".
- Transcript appears in the textarea.

4. Stop dictation.

Expected:

- UI returns to "Not listening".

---

## 5. Focus mode

**Page:** `/student`

Steps:

1. Open accessibility settings.
2. Toggle "Focus mode" ON.

Expected:

- Right rail (Cognitive Effort, Goals, Streak) disappears.
- Left rail disappears.
- Layout collapses to a single column.

Keyboard expectation:

- Focus order remains stable: you can still reach hint button, mic button, textarea, and send.

---

## 6. Regression checklist (per release)

Run this before tagging a release:

- `/` skip link works
- `/student` gate is accessible
- `/student` EkeChat SR announcements work
- Accessibility settings dialog closes on Escape and returns focus to the trigger
- Axe-core Playwright checks pass (see `tests/e2e/a11y.spec.ts`)

---

> If a step fails, file an issue with:
> - OS + browser + SR version
> - exact keystrokes
> - actual announcement
> - expected announcement
> - screenshot/video if possible
