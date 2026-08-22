# Number Drill Game — Design Spec
**Date:** 2026-08-22  
**Feature:** "אלוף המספרים" — per-number multiplication drill

## Overview
A new multiplication game where the player picks one number (1–10) and drills all 10 facts for that number until every fact has been answered correctly at least once. Wrong answers cycle back; the round ends only when the queue is empty.

## Game Flow

1. **Number picker** (`renderTablePicker`) — 2×5 grid of large tiles, numbers 1–10. Tap to start drill for that number.
2. **Drill loop** (`renderDrillQuestion`) — queue initialized as [1..10] shuffled.
   - Question: **N × K = ?**
   - 4 choices: all multiples of N (N×1 through N×10), 3 wrong + 1 correct, shuffled.
   - 5-second countdown bar.
3. **Answer handling:**
   - Correct → removed from queue, result recorded as `fast` (<2.5s) or `slow` (≥2.5s).
   - Wrong or timed-out → pushed to end of queue, result recorded as `wrong` (overwritten to `retry-ok` on eventual correct answer).
4. **End screen** (`renderDrillEnd`) — full table 1–10 color-coded:
   - ✅ green = correct first try, fast
   - ⚡ yellow = correct first try, slow
   - 🔁 orange = needed retry but cleared
   - Stars total + two buttons: "שוב!" (same number) / "בחרי מספר" (pick again)

## Stars

| Outcome | Stars |
|---|---|
| Correct, fast (<2.5s) | 3 |
| Correct, slow (≥2.5s) | 1 |
| Wrong / timed-out attempt | 0 |
| Retry eventually correct | 1 |
| Perfect round (all 10 first-try) | +5 bonus |

Stars flow through existing `awardStars()`. If 'drill' is today's craving, all stars double.

## State

In-memory only (no new localStorage keys):
```js
drill = {
  n,           // chosen number
  queue,       // remaining factors to answer correctly
  results,     // Map<factor, 'fast'|'slow'|'retry-ok'|'pending'>
  starsEarned, // accumulated this drill
  perfect,     // boolean — no wrong answers so far
  startedAt,   // timestamp of current question (for speed check)
}
```
`round = { mode: 'drill', starsEarned: 0 }` to integrate with existing star/craving system.

## UI Integration

- Button **"🏅 אלוף המספרים"** added to `renderMultiplicationMenu()`
- Number picker tiles cycle through teal/pink/coral/purple palette
- Question screen reuses existing round layout (progress pill, big question, 4 answer buttons, countdown bar)
- `CRAVING_MODES` gains `'drill'`, `CRAVING_HE` gets `drill: 'אלוף המספרים'`, `CRAVING_HOME_BTN` maps `drill → 'play-mul'`

## Files Changed

- `app.js` — add `renderTablePicker`, `startTableDrill`, `renderDrillQuestion`, `renderDrillEnd`; update `renderMultiplicationMenu`, `CRAVING_MODES`, `CRAVING_HE`, `CRAVING_HOME_BTN`
- `styles.css` — add `.number-picker`, `.number-tile`, `.drill-end-table` styles
- `sw.js` + `index.html` — bump to v28
