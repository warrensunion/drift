# Web interface audit, 2026-10-13

Checked against Vercel's Web Interface Guidelines
(`docs/audit/web-interface-guidelines.md`, fetched 2026-10-13 from
https://github.com/vercel-labs/web-interface-guidelines) plus the items in the
audit brief. Scope: `index.html` (preloader, six-chapter story, globe section
with the Global / Salish switch, About), `src/story/*`, `src/styles/*`,
`src/globe/*`, `src/about.js`.

Method: code read of every file in scope, then a Playwright probe on a
`vite build --mode development` + `vite preview` at 1440x900 and 390x844
(touch): Tab order and focus ring of every stop from the preloader to About,
the timeline slider's keys and `aria-valuetext`, Escape, hit-target sizes of
every visible control, live regions, the Salish column's scroll height, then
`node scripts/shoot.mjs audit 1440x900,390x844` for regressions.

Verdicts: **pass** (already right), **fixed** (file:line of the fix),
**n/a** (does not apply to this site), **not fixed** (why).

## Interactions

| Rule | Verdict | Where / why |
|---|---|---|
| Keyboard works everywhere | fixed | The globe and the Salish chart were pointer-only (drag, tap to drop). The canvas is now a tab stop: arrows turn the globe / pan the chart, + and - zoom, Enter drops at a ring shown on focus (`src/globe/index.js:79`, `:466`; `src/globe/salish.js:226`, `:626`; `src/globe/globe.css:48-55`). Story, chapter buttons, switch, items, play, speeds, panel close, summary, About table were already keyboard-operable. |
| Keyboard: timeline is a real slider | fixed | It was an `<input type=range>` whose native step was 1/1000 of a log scale (a fraction of a day near 0, invisible with arrows). Arrows / Page / Home / End now move by readable units (day, month, year; hour, 6 h, day) (`src/globe/ui.js:79`, `:258-268`, `src/globe/salish.js:48`); `aria-valuetext` reads "1 year", "2 hours", "Day 0" (`src/globe/ui.js:348`). |
| Clear focus (visible ring on every focusable) | fixed | Play button and panel close had `outline: none` with only a border/background change; the slider showed a dark box from the global ring; the Salish marker drew a ring on a 0x0 box. Now: `src/globe/globe.css:223`, `:279`, `:344-346`, `:693`. Every other stop showed the global 2 px foam ring (probe). |
| Focus never obscured by overlays | fixed | During the preloader Tab reached citation links behind the full-screen overlay, and the "Scroll to begin" button was focusable while transparent. The page behind is `inert` until the story begins (`src/main.js:110-136`), the button until it is visible (`index.html:117`, `src/story/preloader.js:95`); a no-JS failsafe un-inerts (`index.html:75`). |
| Manage focus | pass | Begin hands focus to chapter 1's heading (`src/main.js`); focus landing in an off-screen chapter scrolls it in. |
| Tab order follows the layout | fixed | The Global / Salish switch (top centre) came after the whole globe UI; the chapter nav (bottom left, story only) came after About. Both moved in the DOM (`index.html:152`, `:166`). |
| Escape | fixed | Escape closed the fragment panel only when focus was on the canvas, not from its own close button, the slider or the item buttons (`src/globe/index.js:460`, `src/globe/salish.js:620`). |
| Match visual & hit targets (>= 24 px; 44 px on touch) | fixed | Citation numerals were 12x4 px links: an invisible 24 px (44 px touch) hit area (`src/styles/story.css:126-128`). On touch: switch pills 36 px, speed buttons 34 px, slider 30 px, chapter buttons 32 px wide, panel close 32 px: each grows to 44 px without changing the drawing (`src/styles/story.css:368`, `:409`; `src/globe/globe.css:225`, `:348-353`, `:402`). |
| Mobile input size >= 16 px | n/a | The only input is a range slider (no text entry, no iOS zoom). |
| Respect zoom | pass | `index.html:5` has no `maximum-scale` / `user-scalable`. |
| Hydration-safe inputs / don't block paste | n/a | No SSR, no text inputs. |
| Loading buttons / minimum loading-state duration | n/a | No async buttons; status lines ("Loading the ocean…", "Model loading…") are text, not spinners. |
| URL as state / deep-link everything | not fixed | Map mode, drops and timeline are not in the URL. Drops are seeded simulations computed in a worker; restoring them from a URL is a feature, not an audit fix. Section anchors (`#globe`, `#about`, `#src-N`) do work. |
| Optimistic updates | n/a | No server writes. |
| Ellipsis for loading states | pass | "Loading Drift…", "Loading the ocean…", "Loading the tides…", "Model loading…", "Loading the model’s numbers…"; the new computing announcement says "Still computing…". |
| Confirm destructive actions | n/a | Nothing destructive (closing the panel only deselects). |
| Prevent double-tap zoom on controls (`touch-action: manipulation`) | fixed | `src/styles/base.css:28`. The canvas keeps `touch-action: pan-y` (embedded) as designed. |
| Tap highlight follows design | fixed | Was the default grey outside the globe; now a glass tint (`src/styles/base.css:10`); the globe keeps `transparent` (`src/globe/globe.css:28`). |
| Forgiving interactions | pass | Tap = < 8 px and < 300 ms (`src/globe/pick.js`); member picking has a 16 px radius. |
| Tooltip timing | n/a | Only native `title` on speed buttons. |
| Overscroll behaviour in drawers | fixed | The phone sheet and the Salish column scroll; they now `overscroll-behavior: contain` (`src/globe/globe.css:652-654`); the About table's sideways scroll too (`src/styles/story.css:486`). |
| Desktop rubber-banding | fixed | `overscroll-behavior: none` on `html` under `(pointer: fine)` (`src/styles/base.css:13`). |
| Scroll positions persist | not fixed | `history.scrollRestoration = 'manual'` (`src/main.js`) is deliberate: every visit starts with the preloader at the top of the story, and restoring mid-story would land behind it. |
| Autofocus | n/a | No primary text input. |
| No dead zones | pass | Item buttons, pills and the summary bar are whole-surface buttons. |
| Clean drag interactions | pass | Drag happens on a canvas with pointer capture; story art is `draggable=false`. |
| Gestures have alternatives | fixed | See "Keyboard works everywhere": drag-to-turn, pinch and tap-to-drop now have key equivalents; the Salish view also has the "Drop at the river mouth" button. |
| Links are links | pass | Chrome, CTA, citations and sources are `<a href>`; chapter jumps and controls are `<button>`. |
| Announce async updates (polite live regions) | fixed | Toasts and status were `role=status` already, but the toast kept its stale text in the tree and a repeated toast was not re-announced (`src/globe/ui.js:325-339`). The fragment panel was a polite live region on the whole panel, updated every 6 frames, and the timeline readout was an `<output>` (implicit live) updated every frame: both flooded screen readers. Now one hidden status announces the selection and the computing state when it changes ("A plastic bottle. Still computing…" then "Computed, after 10 years.") (`src/globe/ui.js:204-210`, `:391`, `:297`). |
| Locale-aware keyboard shortcuts | pass | Keys are Space, Escape, arrows, Enter, `+`/`-` (also `=`/`_`); no letter shortcuts. |

## Animations

| Rule | Verdict | Where / why |
|---|---|---|
| Honor `prefers-reduced-motion` | pass | Story becomes 400 ms cross-fades (`.is-reduced`), preloader animations stop (`index.html` critical CSS), globe follow is instant and auto-rotation off, Salish pulse off, global `animation-duration: .01s` fallback (`src/styles/base.css`). Shot as `reduced-*`. |
| Prefer CSS / compositor-friendly | pass | Transforms and opacity throughout; the rAF controller writes transforms only. The fate bars animate `width` over 0.5 s on a 3 px bar (negligible). |
| Necessity / easing fits / interruptible | pass | Measured timings (docs/design.md); scroll and input interrupt everything. |
| Autoplay > 5 s has pause | pass | Globe timeline has Play/Pause; ambient loops (preloader drift, buoy bob, streamlines) are muted, non-essential and stop under reduced motion. |
| Correct transform origin | pass | Buoy bobs from its rope (`transform-origin: 50% 6%`), rays from the cap. |
| Never `transition: all` | pass | No `transition: all` anywhere (grep). |
| SVG transforms on `<g>` with `transform-box` | n/a | SVG is not transformed in CSS (the cap moves as a whole element). |

## Layout

| Rule | Verdict | Where / why |
|---|---|---|
| Optical / deliberate alignment, balance in lockups | pass | One 40 px chrome margin (20 under 600 px); unchanged. |
| Responsive coverage | pass | Shot at 1440x900, 1920x1080, 390x844 by `scripts/shoot.mjs`; no horizontal scroll check passes. |
| Respect safe areas | fixed | `viewport-fit=cover` was set but only the phone sheet's bottom used `env()`. Chrome, skip link, chapter nav, globe switch, globe column and timeline, and the phone sheet's sides now take `max(margin, env(safe-area-inset-*))` (`src/styles/base.css:52`, `:67`; `src/styles/story.css:343`, `:391`, `:417`; `src/globe/globe.css:94`, `:260-261`, `:655`). |
| No excessive scrollbars | fixed | The Salish column (item 3b below) now fits at 1440x900; where it must scroll it has a thin glass scrollbar (`src/globe/globe.css:652`). |
| Let the browser size things | pass | Layout is CSS; JS measures only for the canvas and tick-label collision. |

## Content

| Rule | Verdict | Where / why |
|---|---|---|
| Inline help first | pass | Hints under the items ("Click the ocean to drop a bottle."), "Hold Ctrl to zoom". |
| Stable skeletons | n/a | No skeletons. |
| Accurate page titles | pass | Single page: `<title>Drift</title>` with a description (`index.html:6-7`). |
| No dead ends | pass | Every error line says what to do ("Try another spot.", "Try reloading the page.", static fallback note). |
| All states designed | pass | Idle, computing, done, beached/sunk notes, static fallback, model fallback label, land/outside toasts. |
| Typographic quotes | pass | All copy uses ’ and “ ” (grep for straight quotes in visible strings: none). |
| Avoid widows / orphans | pass | Headlines are built word by word with `white-space: nowrap`; copy measure 34rem. |
| Tabular numbers for changing numbers | fixed | Readout and fate percentages had it; the panel's age and distance, its footnote count, the phone summary line, the speed buttons and the chapter numerals did not (`src/globe/globe.css:235`, `:252`, `:401`, `:680`; `src/styles/story.css:367`). |
| Redundant status cues | pass | Fates have text labels and percentages beside the coloured bars; pressed states use `aria-pressed` plus fill. |
| Icons have labels / icon-only buttons named | fixed | Play/Pause, close (×) and the Salish marker were named. Speed buttons were named "1 times", "30 times": now "1 simulated day per second" etc. (`src/globe/ui.js:73`). |
| Don't ship the schema | pass | Visually hidden h1/h2 give each section a heading. |
| Use the ellipsis character | pass | No "..." in UI strings. |
| Anchored headings (`scroll-margin-top`) | pass | `.sources li { scroll-margin-top: 30vh }`; `#globe` and `#about` are full-height sections with no sticky header over them (the chrome hides past the story). |
| Resilient to long content | pass | Summary line ellipsizes; tick labels hide on collision; long distance line spans the facts grid. |
| Locale-aware formats | fixed | Distances used `toLocaleString('en')`, the About numbers `'en-GB'` and `toFixed`, the panel's copy count was raw ("1536"). All now use the reader's locale (`src/globe/ui.js:47-51`, `:389`; `src/about.js:10-13`). |
| Prefer language settings over location | n/a | English only; no geolocation. |
| Shield verbatim content from translation | fixed | The "Drift" wordmark and preloader title are `translate="no"` (`index.html:115`, `:145`). |
| Accessible content / semantics before ARIA | pass | Native buttons, links, `dl`, `table` with `scope`, `figure`-less art `aria-hidden`; one persistent h1. |
| Headings & skip link | pass | h1 > h2 per chapter / section > h3/h4; "Skip to About the science" (`index.html:80`). |
| Accessible media: images | pass | Every story plate, cut-out and particle is `alt=""` inside `aria-hidden` art; About art `alt=""`; the static globe fallback has a real alt; the canvases are `role=img` with a label. |
| Non-breaking spaces for glued terms | fixed | Story: "77 %", "10 km", "79,000 tonnes", "1.6 million km²", "94 %", "8 %", "46 %", "10,898 m", "59 %", "15 years" (`src/story/scenes.js:70`, `:100`, `:120`, `:138-139`). About: "15 m", "10 m", "111 km", "0.1 % to 1 %" (`index.html:187-209`) and the generated km / % figures (`src/about.js:12`, `:57-61`). Panel: "45 km", "30 days" (`src/globe/ui.js:47-51`, `:374`, `:390`); the wrapped "after 30 / days." in the 1440 Salish shot is gone. |

## Forms

| Rule | Verdict | Where / why |
|---|---|---|
| Enter submits, textarea, submission rules, typing, autocomplete, spellcheck, input types, placeholders, unsaved changes, password managers, trimming | n/a | The site has no forms or text inputs. |
| Labels everywhere | pass | Slider `aria-label="Age of the drops"`; button groups have `aria-label`. |
| No dead zones on checkboxes / radios | fixed | Speed buttons are `role=radio`: on touch their hit area is now 44 px (see hit targets), and the group now follows the APG radio pattern, one Tab stop with arrow keys moving the choice (it had three Tab stops and no arrows) (`src/globe/ui.js:286-296`, `:355-359`). |
| Windows `<select>` colours | n/a | No `<select>`. |

## Performance

| Rule | Verdict | Where / why |
|---|---|---|
| Device matrix / measure reliably / throttling | not fixed | Only desktop Chrome (WebGPU) and Chromium mobile emulation here; Safari / iOS Low Power Mode cannot be run on this Windows machine. |
| Track re-renders / minimize layout work | fixed | The timeline rewrote `aria-valuetext`, the readout and the play label every frame; now only when they change (`src/globe/ui.js:348-361`). |
| Large lists | n/a | Sources list is 17 items. |
| Preload wisely | pass | Only the preloader's surface image and the paper tile are preloaded (`index.html:18-19`); About images are `loading="lazy"`. |
| No image-caused CLS | pass | Story art is absolutely positioned on a sticky stage (cannot shift layout); About sky, hills and rays are absolutely positioned; the buoy has `width`/`height`; item thumbnails sit in fixed 44 / 34 px boxes. |
| Preconnect to origins | pass | `fonts.googleapis.com` and `fonts.gstatic.com` (crossorigin) (`index.html:15-16`). |
| Preload fonts / `font-display` | pass | Google Fonts CSS with `display=swap`, loaded non-blocking; the preloader waits for the four faces it needs, so the story never shows a swap. |
| Subset fonts | not fixed | Anybody and Literata come from Google Fonts' variable files (Google subsets by unicode-range already); axis trimming would mean self-hosting. |
| No expensive main-thread work | pass | The simulation runs in a module worker; ONNX runs there too. |
| Video over GIF / Safari video-as-image | n/a | No video or GIF. |

## Design

| Rule | Verdict | Where / why |
|---|---|---|
| Layered shadows, crisp borders, nested radii, hue consistency | pass | Panels: 1 px glass border + scrim; radii 16 > 14 > 12 nested; shadows tinted petrol / fresh. |
| Accessible charts | pass | Fate bars are labelled with text and numbers; ages are the fresh-oxidised-bleached ramp plus words. |
| Minimum contrast | pass | Measured on the screenshots by `scripts/dev/aa.mjs` (WCAG AA) in every chapter; APCA not used (the project measures WCAG 2, by design). |
| Interactions increase contrast | pass | Hover / pressed states brighten borders and text. |
| Browser UI matches background (`theme-color`) | pass | `#0E2F36` (`index.html:8`). |
| Appropriate `color-scheme` | fixed | Missing: added `<meta name="color-scheme" content="dark">` and `color-scheme: dark` on `html` (`index.html:9`, `:23`; `src/styles/base.css:9`) so scrollbars (About table, Salish column) are dark. |
| Text anti-aliasing & transforms | pass | Headline shards animate wrapper spans; `will-change` on shards. |
| Avoid gradient banding | pass | Grain multiplied over everything. |

## Copywriting (Vercel-specific section)

| Rule | Verdict | Where / why |
|---|---|---|
| Title Case headings & buttons | n/a | Vercel's own brand choice; Drift's design rules say sentence case (docs/design.md), and the guideline itself says marketing pages use sentence case. Pass for sentence case. |
| Active voice, concise, numerals for counts, second person, positive errors that guide the exit | pass | e.g. "That drop did not work. Try another spot." The About text's single "we report it as small" is deliberate honesty, kept. |
| `&` over "and", placeholders, currency | n/a | Brand preference / not present. |
| Separate numbers & units with a (non-breaking) space | fixed | See "Non-breaking spaces". The fate percentages ("91%") stay unspaced as compact table figures. |

## Meta and brief-specific checks

| Check | Verdict | Where / why |
|---|---|---|
| `lang` | pass | `<html lang="en">`. |
| title, description | pass | `index.html:6-7`. |
| Open Graph / Twitter | fixed | `og:type`, `og:title`, `og:description`, `twitter:card` (`index.html:10-13`). No `og:image`: it needs an absolute URL and the site has no deployed origin yet. Canonical omitted (allowed by the brief). |
| `inert` on hidden UI | fixed | Preloader (above). Already right: chrome and chapter nav use `visibility: hidden` when hidden; the phone sheet's collapsed parts are `display: none`; the panel is `hidden`. |
| Custom cursor over UI | fixed | The 18 px cursor dot stayed visible over the globe section's switch and sat on the "h" of "Salish Sea" in the 1440 shots (item 3a). It now steps aside over the whole globe section, where the native cursor shows (`src/story/cursor.js:45`). |

## Known items from the brief

| Item | Verdict | Where / why |
|---|---|---|
| (a) Mode switch "clips" "Salish Sea" at 1440 | fixed | Not a clip: the switch measures 100 px for its label. The custom cursor dot, parked on the button after the shoot clicked it, covered the "h" (`src/story/cursor.js:45`). Also `white-space: nowrap` on the pills as a guard (`src/styles/story.css:407`). |
| (b) Salish footnote clipped at the bottom of the panel at 1440 | fixed | The column stopped 116 px above the bottom though the timeline starts to its right; it now reaches down beside it (`src/globe/globe.css:613`), an empty status line no longer takes 35 px (`:691`), and if a shorter screen still overflows it scrolls with a visible thin scrollbar (`:652`). Probe at 1440x900, Fraser drop at 30 days: scrollHeight 820 = clientHeight 820. |
| (c) Sunk rings pile into bright dots after a split | fixed | Copies of a fragment sink close together and the glow is additive, so 24 rings at 16 % made a white dot. Only one member column in 24 now keeps the ghost ring (about one per 24-copy ensemble), and the ring is drawn at half gain (`src/globe/particles.js:24-28`, `:174`, `:200`). Checked on the Pacific bottle at 10 years (64 pieces, 99 % on the seafloor): the white dots are gone, the rings read as faint marks. |

## Counts

- Rows checked: 97 (every bullet of the guidelines, some grouped where one verdict covers them, plus the brief's extra checks and its three known items).
- Fixed: 30.
- Not fixed (reasons above): 4 (URL state, scroll restoration, the Safari / iOS device matrix, font subsetting / axes).
- Pass: 47. Not applicable: 16.
