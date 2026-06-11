# DragonMath — Design Spec (v1)

**Date:** 2026-06-11
**Status:** Approved (brainstorm), pending implementation plan
**Owner:** Amir (parent/developer)

## Summary

DragonMath is an offline Progressive Web App (PWA) that builds **1–10 multiplication
fluency** for one specific child (~11–12, currently shaky/slow on times tables), with an
ADHD diagnosis. The design is shaped by established ADHD-learning principles: one item on
screen, reward the attempt, trivial starts, concrete visible progress, and a hard session
stop. She runs it on her Android tablet via "Add to Home Screen" — no login, no internet,
no data collection.

## Goals

1. Take her from "shaky/slow on 1–10" to **automatic recall of 1–10 facts**.
2. Make practice feel like a treat she returns to, not a chore.
3. Teach the *concept* of multiplication (groups/arrays), so division, ×11–13, and primes
   later "click" from the same mental picture.

## Non-Goals (out of scope for v1)

- Multiple children / user profiles / accounts.
- Online sync, leaderboards, multiplayer.
- Google Play Store publishing and kids-privacy compliance paperwork.
- Parent analytics dashboard.
- Heavy/continuous sound design (optional light SFX only; must be mutable).

## Target User

- One child, ~11–12 years old, ADHD.
- Math level: shaky-to-slow on 1–10 tables (between "finger counting" and "knows but not
  automatic"). Difficulty starts low so she wins early.

## The Games

### 1. Build & Count — *first release, the foundation*
- Presents a fact as **rows/groups of dots** (e.g. "3 groups of 4").
- She taps each group and counts up (4, 8, 12…), then selects or types the total.
- Teaches what multiplication *is*. The same dot-picture is reused later to explain
  division ("split the dots into equal rows"), ×11–13 ("it extends the same way"), and
  primes ("a number that can't form a full rectangle").

### 2. Pet Layer (Dragon) — *first release, wraps everything*
- Every attempt earns **stars**; stars feed/grow a single dragon.
- Stars spend on **one growing dragon** (chosen over a sticker book): the dragon visibly
  grows / gains features as stars accumulate. This is the core dopamine engine.
- Stars animate flying to the dragon on every tap (visible progress).

### 3. Bubble Pop — *second release*
- A fact appears; candidate answers float up as bubbles; she pops the correct one.
- Combo streak meter + confetti. Drills **speed/automaticity** once facts are understood.

**Build order:** Build & Count + Dragon layer ship first. Bubble Pop is a fast follow.

## ADHD Design Rules → Features

| Principle | Feature |
|---|---|
| Working memory is small | One problem on screen; no clutter; no mid-round menus. |
| Reward the attempt, not just correctness | Stars for trying; wrong ≠ punishment. |
| Starting is hardest | Tap-to-play; first problem of every round is trivial (×1 or ×2). |
| Vague time fails | Always show "N left" + a shrinking progress bar. |
| Dopamine is scarce / wins must be visible | Stars fly to the dragon on every tap; dragon grows. |

## Wrong-Answer Behavior

- On a wrong answer: gentle "try again" (no red-X spiral).
- Allow **1–2 retries**, then reveal the correct answer with the dot-picture, and move on.
- A round still ends early on a **3-wrong-in-a-row streak** (see session stop), always
  finishing on an easy win.

## Session / Stop Rule (Combo "D")

A round ends on whichever triggers **first**:
- ~5 minutes elapsed, OR
- ~12 problems answered, OR
- 3 wrong answers in a row.

On stop: present one final easy problem to **end on a win**, show stars earned this round
and the dragon's growth, then a friendly "great job — come back later" screen. (Optional
soft lockout/cooldown is a later consideration, not v1-required.)

## Content & Progression

- **Core:** 1–10 multiplication facts.
- **Adaptive selection:** weight practice toward facts she misses; ease off facts she has
  mastered. (Simple per-fact mastery counter; no ML.)
- **Unlockables (later, optional):** ×11–13, simple division, primes — all taught through
  the Build & Count dot-picture.

## Technical Design

- **Type:** Offline-first PWA (installable via "Add to Home Screen").
- **Privacy:** No login, no network calls, no analytics, no data leaves the device.
  Progress (mastery counters, dragon growth, stars) stored locally on-device.
- **Visual design:** driven by the `ui-ux-pro-max` skill — colorful, large touch targets,
  playful, high-contrast, kid-friendly. Optional light SFX, muteable.
- **Orientation/target:** tablet/phone portrait, big tap targets, touch-first.
- **Runtime during dev:** runs locally on the dev PC (browser preview). Deploy to her
  tablet by opening a hosted/local URL once and adding to home screen. Optional `.apk`
  wrapper deferred.
- **Stack:** lightweight, low-build-complexity web stack (specific framework choice to be
  finalized in the implementation plan, optimized for fast iteration and a beginner-friendly
  maintenance story).

## Key Components (for planning)

1. **Round Engine** — picks facts (adaptive), enforces the stop rule, tracks streaks.
2. **Build & Count screen** — renders dot groups, handles tap-to-count + answer entry.
3. **Bubble Pop screen** (release 2) — floating-answer arcade interaction.
4. **Dragon/reward module** — star economy, dragon growth state, fly-to-dragon animation.
5. **Local storage layer** — persists mastery per fact, stars, dragon stage.
6. **Shell/PWA wiring** — manifest, service worker (offline), install prompt, mute toggle.

## Success Criteria

- She chooses to play it unprompted more than once.
- Measurable rise in 1–10 recall speed/accuracy over a few weeks (via in-app mastery
  counters).
- Sessions reliably end on a win, within the stop bounds, with no frustration spiral.

## Open Questions (deferred, not blocking)

- Exact dragon growth stages / art direction.
- Whether to add a soft cooldown lockout after a session.
- Whether to type answers vs. choose from options in Build & Count (decide in plan/design).
