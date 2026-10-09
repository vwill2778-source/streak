# Habit Tracker

A tiny single-page habit tracker built with **plain HTML, CSS, and vanilla JavaScript**.
No frameworks, no dependencies, no build step, no backend — just open `index.html`
in a browser and start checking in.

## How to run

Double-click `index.html` (or drag it into any browser tab). That's it.

Optional: serve it locally if you prefer

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Features

- **Add a habit** — name (required) plus an optional emoji icon.
- **Habit list** — each habit shows its icon, name, current streak (`🔥 5 days`),
  and longest streak (`🏆 Longest: 5 days`).
- **Daily check-in** — a big "Done today" button per habit. Tap to complete for
  today, tap again to undo.
- **Week view** — the last 7 days as squares per habit: filled = done,
  empty = missed, today highlighted.
- **Streak logic** — a streak is the number of consecutive calendar days
  completed. Miss a day and the current streak resets to 0; your longest streak
  is kept forever. Today isn't counted as missed until it's actually past.
- **Streak milestones** — checking in on a round milestone (a full week, two
  weeks, tens of days…) pops a small 🎉 celebration on that day's card.
- **Delete a habit** — with an inline confirmation step (Escape or Cancel aborts).
- **Persistence** — everything lives in `localStorage`; state survives reloads
  and closed tabs. If storage is unavailable (some browsers on `file://`,
  private mode), the app degrades to in-memory so it still works for the session.
- **Empty state** — a friendly message and a call-to-action when you have no
  habits yet.
- **Responsive, accessible design** — looks good down to 360px wide, follows the
  system font stack, respects `prefers-color-scheme` (light/dark), keyboard
  focus outlines, ARIA labels/pressed states, and a polite live region that
  announces changes.

## Files

| File         | Purpose                             |
| ------------ | ----------------------------------- |
| `index.html` | Page structure                      |
| `styles.css` | All styling (light + dark)          |
| `app.js`     | All logic (streaks, storage, UI)    |
| `README.md`  | This file                           |

## Non-goals

No backend, no npm dependencies, no login, no cloud sync. Data never leaves
your browser; clearing site data (or the `habit-tracker:v1` localStorage key)
erases it.
