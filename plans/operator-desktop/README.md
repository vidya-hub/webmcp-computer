# Operator desktop UI

This folder is the **source of truth** for the host-page UI work: desktop atmosphere, dock, spatial window motion, tabbed inspector (Tape + Recipes), per-window Timeline, [uisfx](https://uisfx.com/) sound, and 60 WPM agent typing.

It does **not** replace [REQUIREMENTS.md](../REQUIREMENTS.md). When chrome or the inspector drifts from §7, update REQUIREMENTS with one paragraph after this work lands — do not rewrite the whole spec first.

Older `plans/*` files (Nova/Forge, Axiom-on-paper, full-screen Action TimeLine) are stale for layout. This folder wins for the website chrome.

## Send this to the implementing agent

**[INSTRUCTIONS.md](INSTRUCTIONS.md) is the complete brief** (ownership, boot policy, layout, dock, motion, inspector, uisfx, 60 WPM typing, verification). If other files in this folder disagree, INSTRUCTIONS wins.

Supporting splits (same content, for navigation):

| File | What it is |
|------|------------|
| [HANDOFF.md](HANDOFF.md) | Claude’s in-flight APIs and file conflict map |
| [PLAN.md](PLAN.md) | Product spec (update when INSTRUCTIONS changes) |
| [VERIFY.md](VERIFY.md) | Browser checklist only |

## Product in one sentence

A dark macOS desktop whose apps are live Linux computers, with a Chrome-DevTools-class inspector that **pushes the desktop** (never covers it), a dock that **never hides** (it is the minimize target), **no page-load BIOS**, a boot overlay **only inside a computer that is starting**, and agent typing **paced at 60 WPM** with a soft per-key sound.

## Parallel track

Backend, policy, recipes API, archives, tests, deploy: not this folder. See the hardening plan; UI P3 lives **here**. Do not rewrite `ActionTimeline.tsx` / `Shell.tsx` / `axiom.css` on that track after this work starts.
