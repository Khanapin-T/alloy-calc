# Project Summary

## 1. Name and description

**Alloy calculator** (`alloy-calc`, PWA name "Сплав") — a mobile-first web calculator
for a jewelry workshop that computes what metal to melt to reach a target gold
fineness (585/750/custom permille), given a flask mass and the scrap gold on hand.

Per the developer: this calculator is used in production by a jewelry workshop chef
and other jewelers. (Stated by the developer; not verifiable from the repository.)

## 2. Tech stack

- **Language:** HTML, CSS, and vanilla JavaScript (ES2015+). No framework.
- **Libraries/dependencies:** none. No `package.json`, no third-party runtime or build
  dependencies. The solver uses a UMD-style wrapper so it loads both as a plain
  `<script>` (`window.AlloySolver`) and as a CommonJS module in Node.
- **Build tool:** none — static files served as-is, no bundler or transpiler.
- **Tests:** Node's built-in test runner (`node --test`, `node:test` + `node:assert/strict`).
  No external test framework.
- **Hosting/deploy target:** GitHub Pages (static). `.nojekyll` present; README lists the URL.
- **3D / animation / calculation logic:**
  - 3D: none.
  - Animation: CSS transitions only (toggle switch, copy-button state); no JS animation library.
  - Calculation logic: `solver.js` — pure, DOM-free functions. Works in integer
    milligrams and permille fineness; implements alligation (pair mixing), a
    combinatorial "cut one lot" search, and blend-dilution fallback.

## 3. How it works

Static single-page app. `index.html` holds all markup, styles, and the UI script;
`solver.js` holds the math as pure functions; `sw.js` is the service worker.
The app has three tabs: **Расчёт** (what to melt), **Довести пробу** (raise/lower an
existing fineness), **Что получится** (predict the fineness of a given mix).
On every keystroke the UI reads the inputs, converts grams to integer milligrams,
calls the relevant solver function, and re-renders result cards live (no submit button).
State (inputs, tab, settings) is persisted to `localStorage` on each change and
restored on load; completed calculations are written to a capped history list
(max 20) after a 3-second debounce or when the page is hidden.
The service worker caches the app shell network-first for offline use.

## 4. Key features

- Compute a melt recipe for a given flask mass + target fineness, choosing from
  reference finenesses (585/750/999) and ligature, or from entered stock lots.
- Mark stock lots as "Весь в плавку" (must be fully used); solver respects/cuts them.
- Rank multiple recipe options (from stock vs. other), show shortages when stock is short.
- "Довести пробу" tab: raise or lower one or more pieces of any fineness to a target,
  using stock, ligature, or reference metals; can set part of the base aside.
- "Что получится" tab: enter several metals + ligature, see resulting total mass,
  fineness, and pure-gold content.
- Copy any recipe/result to clipboard (with `execCommand` fallback).
- History of past calculations, tappable to restore inputs; clearable.
- Custom ligature fineness in settings.
- Theme switch: light / dark / auto (follows device), persisted and applied before first paint.
- Installable PWA with offline support; "Очистить" resets inputs for the next flask.

## 5. Notable technical decisions

- **Integer-milligram / permille arithmetic.** All masses are integer mg and fineness
  is permille, so sums stay exact and rounding (to 0.01 g) is explicit — avoids
  floating-point drift in a domain where fractions of a gram of gold matter.
- **Pure solver separated from DOM.** `solver.js` is a DOM-free, dual-mode module, which
  is why the 34 unit tests (including fuzz tests) can run under `node --test` with no browser.
- **Result validation via a check line.** Each option recomputes the achieved fineness
  and flags (`check.ok`) when rounding pushes it outside a 0.5-permille tolerance,
  warning the user instead of silently returning a wrong recipe.
- **Combinatorial "cut one lot" search** (`cutOptions`, bitmask over up to 10 lots) with a
  blend-dilution fallback — chooses recipes that leave out the fewest lots, matching how
  a jeweler actually wants to consume scrap.
- **Device-local state with guarded storage.** Every `localStorage` read/write is wrapped
  in try/catch and degrades silently, so the app works in private mode or with storage blocked.
- **Mobile-first layout** with a fixed bottom tab bar, `env(safe-area-inset-*)` handling,
  48px tap targets, and a theme applied pre-paint to avoid a flash.

## 6. Project stats

- **First commit:** 2026-10-19
- **Last commit:** 2026-10-20
- **Number of commits:** 9
- **Tracked files:** 11 (6 code/config text files + 4 icon images + `.nojekyll`)
- **Lines of code (tracked text files, via `wc -l`):** 2279 total
  — `index.html` 1073, `solver.js` 672, `solver.test.js` 432, `sw.js` 62,
  `manifest.json` 17, `README.md` 23.
- **Tests:** 34, all passing (`node --test`).

## 7. Deployment

- **Production URL:** https://khanapin-t.github.io/alloy-calc/ (from README).
- **How it is deployed:** GitHub Pages serving the repository root as static files.
  `.nojekyll` disables Jekyll processing. No build step; relative paths (`./`) throughout.
  No CI/CD workflow file is present in the repo — deployment mechanism beyond GitHub
  Pages serving the branch is UNKNOWN.
- **Environment variables:** none required. No server, no API keys, no `.env`.

## 8. Assets

No screenshots, photos, or videos are in the repository. Only app icons:

- `icon.svg` — scalable app icon
- `icon-192.png` — 192×192 PNG icon
- `icon-512.png` — 512×512 PNG icon (maskable)
- `apple-touch-icon.png` — iOS home-screen icon

These are usable as a logo/favicon in a portfolio, but there is no product
screenshot or demo media checked in.

## 9. Weak spots

- **No tests for the UI.** Only `solver.js` is tested; all of `index.html`'s event
  wiring, rendering, storage, and theme logic is untested.
- **Accessibility gaps.** Numeric inputs use `type="text"` with `inputmode="decimal"`;
  live regions exist but result cards are dense and rely on color for warnings
  (`.warn`, `.danger`). No visible-focus audit or keyboard-navigation testing is evident.
- **Hardcoded domain values.** Reference finenesses (585/750/999), tolerance (0.5‰),
  history cap (20), debounce (3 s), and cut-search limit (10 lots) are constants in code,
  not configurable — fine for one workshop, limiting for reuse.
- **Everything in one HTML file.** ~1073 lines of markup + CSS + JS in `index.html` with
  no modularization or minification; will get harder to maintain as features grow.
- **No analytics, error reporting, or versioned cache invalidation beyond a manual
  `CACHE = 'alloy-calc-v1'` string** — bumping the app requires remembering to change it.
- **Very short history** (2-day commit span, 9 commits): limited real-world hardening
  visible in the repo itself.
- **Russian-only UI** with no i18n layer.

## 10. Suggested portfolio blurb

I built a mobile-first PWA that tells a jewelry workshop exactly what metal to melt
to hit a target gold fineness, running the alloy math (integer-milligram arithmetic,
alligation, and a combinatorial cut-lot search) in a pure, DOM-free module covered by
34 unit tests. It's a zero-dependency static site — vanilla JS, no build step — that
installs to the home screen, works fully offline via a service worker, and keeps all
data device-local. It's in daily use by jewelers in a working workshop.
