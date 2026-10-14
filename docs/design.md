# Drift — design system

Made with frontend-design; the motion numbers are measured from
2019.makemepulse.com (`design-reference/makemepulse/NOTES.md`), the art and
words are ours. Design comps (one per section, ChatGPT) are in
`design-reference/comps/` — build to match them.

## Idea

The page descends through the water column. Colour follows depth: the
surface chapters are light sea glass and foam, the deep is petrol teal. The
only artificial colour is plastic, and its colour encodes its age the way
real plastic weathers: fresh dye magenta, photo-oxidised amber, sun-bleached
bone. Land is chart paper. One memorable thing: headlines that break into
fragments and drift apart as you scroll on (Anybody's width axis + split
glyph pieces). Everything else stays quiet.

## Colour tokens (`src/styles/tokens.css`)

| token | hex | role |
|---|---|---|
| `--petrol` | #0E2F36 | deep water, dark surfaces, ink on light |
| `--deep` | #1F5A5E | mid water, secondary surfaces |
| `--glass` | #7FB7AE | shallow water, current streamlines, quiet UI lines |
| `--foam` | #E6EEE9 | surface light, land, ink on dark |
| `--fresh` | #FF4D8D | fresh plastic (age 0), the one call-to-action colour |
| `--oxidised` | #F2B544 | plastic ~1–3 years old |
| `--bleached` | #F1E9D2 | plastic 10 years old |

Age ramp for particles and trails: fresh (day 0) → oxidised (day 730) →
bleached (day 3650), interpolated in OKLab. Text pairs must meet AA:
foam on petrol, petrol on foam; glass is never body text on foam.

## Type

- **Anybody** (Google Fonts, variable wdth 50–150, wght 100–900) — display
  headlines and UI labels. Headlines are wide and light (wdth 125, wght 300)
  and narrow as they fragment. Labels: wdth 100, wght 600, 13 px, sentence
  case (no all caps, no tracking-out).
- **Literata** (Google Fonts, variable opsz, italic) — body, captions,
  place names. Place names on maps are italic, as on nautical charts.
- Scale (1.333, from 16 px body; measured makemepulse body 16/24): 13, 16,
  21, 28, 38, 50, 67, 89 px; display uses `clamp()` to scale with the
  viewport (theirs does), body does not grow from 1440 to 1920.
- Measure: body ≤ 34 rem (~62 ch); line-height 1.6 for Literata body.

## Layout

- One 40 px chrome margin for every fixed control (makemepulse); 20 px under
  600 px wide. Icon buttons 32 px (44 px hit area).
- Story text sits left (as the comps leave the left third calm), a narrow
  column, left aligned, never centred paragraphs.
- Globe: the globe fills the right two-thirds on desktop, the control panel
  is a quiet column on the left; on a phone the globe fills the screen and
  the panel is a bottom sheet.

## Motion (measured numbers)

- Cursor/camera follow: `k = 1 − 0.96^(dt/16.67)` per frame.
- Mouse parallax as a share of cursor travel: background +2 %, midground 0,
  foreground −3 %, frame-edge foreground −11 %.
- Eases: settle `cubic-bezier(0.04,1,0.31,0.98)`; scene
  `cubic-bezier(.77,0,.175,1)`; slide `cubic-bezier(.645,.045,.355,1)`;
  reveal/hover `cubic-bezier(.215,.61,.355,1)`; hide
  `cubic-bezier(.755,.05,.855,.06)`.
- Chapter transition 1.75 s (scene ease): a full-frame foreground layer
  (water/bubbles, reeds, cloud) sweeps vertically; the scenes swap at 50 %.
  Render the incoming chapter before starting it.
- Reveal: side panels slide from ±50 vw, 1 s each, staggered 0.15 s.
- Cursor dot 18 px idle, 75 px with a label, 11 px over UI; size eases at
  12 %/frame; label fades in 0.25 s after 0.15 s.
- Preloader: one painted stroke fills inside a mask over a 20 % copy of
  itself; each progress step smoothed over 0.5 s; slides out up over 0.8 s;
  hand-off: a disc grows over 0.9 s, the title settles from 1.3× to 1× over
  1.4 s after 0.3 s. No percentage.
- Paper grain multiplied over everything (`public/art/ui-paper.webp`).
- `prefers-reduced-motion`: no parallax, no sweeps, no follow; every move
  becomes a 400 ms cross-fade.

## Copy rules

Plain words, sentence case, active voice. Every view with tracks says
"Simulation with uncertainty, not a forecast." Numbers only from DATA.md,
docs/science.md or MODEL.md.
