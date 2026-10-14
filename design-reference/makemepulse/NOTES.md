# makemepulse 2019 ("Nomadic Tribe"): motion and craft measurements

Reference: https://2019.makemepulse.com/. Measured 2026-10-13 at 1440x900 and 1920x1080.

These notes are for **technique and timing only**. Drift uses none of its art, characters, logo, lettering or copy. The screenshots in `frames/` and `../compare/` exist for measurement and side-by-side comparison. Do not trace them.

## How the numbers were obtained

Each number carries a tag saying where it came from:

| Tag | Meaning |
|---|---|
| **[code]** | Read from their shipped `main.js` / `main.css` (browserify bundle, Vue 2, GSAP TweenLite + CustomEase, custom WebGL engine built on nanogl). I split the bundle into modules and grepped them for tweens, lerps and constants. None of their code is copied into Drift. |
| **[measured]** | Recorded in the live page by `tools/record.mjs`. A rAF sampler injected before their scripts logged every frame: the GL camera node position, the active transition's progress and the cursor DOM transform. These were fitted by `tools/analyze.mjs`. All timestamps are `performance.timeOrigin + now()` and line up with input events. |
| **[frames]** | Measured from screenshots with sharp: SAD block-matching of horizontal bands (4x downsample, ±160 px search), mean-abs-diff motion energy, and colour quantisation. |
| **[estimated]** | Inferred, not directly measured. |

**Test rig.** Headless Chromium (Playwright 1.64) on an RTX 3060 via `--use-angle=d3d11`, with a steady **60.1 / 60.3 fps** at both sizes. SwiftShader managed only 2.1 fps, so it was useless for timing (`tools/gpu-check.mjs`).

**Frame capture caveat.** On this machine `page.screenshot()` took 1.2–8.6 s per call (`tools/shot-speed.mjs`). Timed frames therefore come from a CDP screencast, which delivers frames irregularly when the machine is loaded. So:

- Frame-based timing is coarse (±100–300 ms).
- Every timing claim below comes from rAF samples or code. Frames are used only for spatial measures (px shifts, palettes) and for the contact sheets.

**Raw data:**
- `frames/<size>/log.json`: frames, DOM polls and type snapshots.
- `frames/<size>/samples.json`: per-frame samples.
- `frames/<size>/analysis.json`: all derived numbers.

### What the site is (it matters for the questions)

It is **not a scroll story**. The structure is:

1. Preloader.
2. A landing "Enter" disc.
3. An art-nouveau title plate.
4. Four full-screen **3D WebGL chapters** (glTF scenes rendered with toon shading and outlines).
5. A DOM ending card.

You move between chapters with a **"Next" button** that appears only after you complete each chapter's interaction (Drag / Click / Hold). There is no wheel handling at all; see section 4.

---

## 1. Preloader

**Measured timeline at 1440x900** (t = navigation commit). 1920x1080 is within ±1.5 s, because the network varies. 169 requests and 24.6 MB load before the landing appears.

| t (s) | What happens | Source |
|---|---|---|
| 0 – 4.9 | Flat page on a tiled blue "paper" texture (`#61667c`). Nothing moves while the 2 MB bundle parses. | [measured] |
| ~4.9 | Vue mounts. Three landing images load, then after **+0.6 s** the loader is shown, the "Best experienced with sound" line fades in (0.5 s), and **+0.8 s** later the WebGL asset load starts. | [code] + [measured] |
| 6.25 → 7.3 | The loader bar (an 8 x 283 px hand-drawn vertical stroke, centred) **slides up into place from below**: `translateY(100%) → 0`, **0.8 s `cubic-bezier(.215,.61,.355,1)`** (easeOutCubic). Polls showed 113 px at 6.41 s, 59 px at 6.53 s and 0 at 7.31 s. | [code] + [measured] |
| 7.7 → 21.8 | **Progress fill.** A white copy of the stroke is revealed bottom-to-top inside a mask. The foreground wrapper sits at `translateY(p%)` and the inner SVG at `translateY(-p%)`, so the stroke stays still while its mask moves. The track behind is the same stroke at **20 % opacity**. Each progress update is smoothed by a **0.5 s CSS `transform` transition (default `ease`)**. Progress came in 1/123 steps (one per loadable); 14.1 s at 1440 and ~13 s at 1920 on this connection. There is no percentage text. | [code] + [measured] |
| done + 0.5 s | `is-hidden`: the bar **exits upward** (`translateY(-100%)`, 0.8 s easeOutCubic) while its inner layer counter-moves `+100%`, so the stroke wipes out through its own mask. Polls showed −136 px at 23.88 s and −204 px at 24.0 s. | [code] + [measured] |
| done + 1.1 s | The loader is removed. **Hand-off:** a WebGL disc (paper texture) grows from the centre, `size 0 → 0.35` (radius = size x aspect / 1.333 x viewport height, i.e. **378 px at 1440x900**), **0.9 s Power2.easeOut**. The title lettering fades in `autoAlpha 0 → 1` and scales **1.3 → 1** over **1.4 s** with the custom ease (below), **delay 0.3 s**. The sound line fades out. Polls showed opacity 0 → 0.81 → 0.90 → 1.0 between 24.56 and 25.64 s, with scale reaching 1.0015 at 25.64 s. | [code] + [measured] |
| 26.1 | Landing interactive. | [measured] |

**Landing → title plate ("Enter" click).** The DOM poll confirmed the logo's final transform was `matrix(2.546…, ty 242 px)` at 1440.

| What | Duration and ease | Delay |
|---|---|---|
| Disc grows to cover the viewport (`size → 1`) | **1.2 s Power3.easeInOut** | – |
| Title moves and scales into its slot | **0.8 s Power4.easeInOut** | **0.3 s** |
| WebGL canvas fades in | **0.5 s Power2.easeInOut** | **0.55 s** |
| Centre panel `opacity 0→1`, `scale 0.6→1` | **0.85 s** custom ease | **0.7 s** |
| Side panels slide in from **±50 vw**: corners → bars → side blocks → bottom blocks | **1 s** custom ease each, **0.15 s stagger** | starts 0.6 s; finishes **2.05 s** |
| "Start" button | appears at **+10 s** | – |

**Custom ease** (used everywhere for "settle in"). The CustomEase path is `M0,0 C0.02,0.492 0.087,0.681 0.206,0.816 0.344,0.972 0.504,1 1,1`.
- Its y values at x = 0.1 / 0.25 / 0.5 / 0.75 are 0.644 / 0.869 / 0.972 / 0.996.
- **Best single CSS fit: `cubic-bezier(0.04, 1, 0.31, 0.98)`** (max error 0.007; grid-search fit).
- It is a very fast attack with a long, soft tail, roughly easeOutExpo.

**Title plate → chapter 1 ("Start").**
1. The landing DOM and the canvas slide **down** together: `y 0 → 100%`, **1 s Power2.easeInOut**.
2. At **0.7 s** the chapter swaps. The canvas jumps to `y -100%` and slides back to 0 over **1 s Power2.easeInOut**, so the new scene drops in from above. The poll at 1.47 s caught the canvas at `translate(0, -5.26%)`.
3. After that the chapter-1 camera "zooms in" (an offset tween of **1.5 s Power4.easeInOut**). The rAF sample showed the camera's world y easing 18.68 → 16.68 between 0.74 and 2.3 s.

## 2. Depth layers and parallax

The chapters are real 3D scenes. "Layers" are depth bands of one perspective camera, not 2D planes. The render stack per frame, back to front [code]:

1. Opaque glTF scene with toon lighting and hatched shadow maps.
2. Inverted-hull outline pass.
3. Blended cards: clouds and foliage sprites.
4. 300-sprite particle field: box 120 x 80 x 200, constant wind `[0, -1.8, -3]`.
5. Chapter-title quad pinned to the camera.
6. Transition foliage layer (only during transitions).
7. DOM UI: subtitles, buttons.
8. 2D-canvas cursor.

**How the mouse moves the camera** [code], with the size of the move confirmed by rAF samples:
- Each frame the camera *position* is pushed toward `initial + (kx * mouseX, ky * mouseY)`, with mouse in normalised −1..1.
- The camera keeps `lookAt` a fixed node.
- So the camera **orbits about the look-at point**: content behind it moves *with* the cursor and content in front of it moves *against* the cursor.

| Chapter | kx, ky (world units) | Measured span centre→corner (x, y) | Notes |
|---|---|---|---|
| 1, 2, 4, ending/landing camera | **0.8, 0.45** | 0.797, 0.448 (normalised mouse at corner ≈ ±0.997) | Chapters 2 and ending use −kx (mirrored). |
| 3 (flight) | **2.0, 1.0** | 1.994, 0.995 | Holding also adds +5 z dolly, −2 x and +1 y, scaled by easeInOutQuart(holdSpeed), plus camera shake 0.05. |

**Measured screen parallax** [frames]: the shift of each horizontal band of the frame between "mouse centre, settled" and "mouse in corner, settled", as a ratio to cursor displacement. The cursor moved 718 x 448 px at 1440 and 958 x 538 px at 1920. Ambient animation (grass, birds, water) adds noise, so treat ±4 px as noise.

| Chapter | Far band (top 20–40 %) | Pivot (40–60 %) | Near (60–80 %) | Extreme foreground (bottom 20 %) |
|---|---|---|---|---|
| 1 @1440 | **+16 px (+2.2 %)**, moves with the cursor | 0 | **−20…−24 px (−2.8…−3.3 %)** | −28…−80 px (−3.9…−11 %) |
| 1 @1920 | +16…24 px (+1.7…2.5 %) | 0 | −24…−28 px (−2.5…−2.9 %) | −40…−112 px (−4.2…−11.7 %) |
| 4 @1440 / 1920 | +16…20 px (+1.7…2.8 %) | +12…16 px | 0 | −16…−20 px (−2.1…−2.2 %) |
| 2 | −1.7…−2.5 % in every band | | | Mirrored kx and a low pivot, so nearly everything shifts one way. Noisy because of birds and water. |
| 3 | 4–16 % | | | Very noisy (fast flight animation); **estimated ≈ 10–15 %**. |

**Rule of thumb.** In a resting chapter, the midground pivot is still, the background drifts **+2 %** of cursor travel and the foreground counter-drifts **−3 %**, rising to **−11 %** for frame-edge foliage. That is a 1 : 0 : −1.5 : −5 layer ratio. Chapter 3 is about 2.5x stronger.

**Landing / title-plate DOM layers.** The title plate has seven separately transformed DOM blocks (`will-change: transform`). Their parallax handler computes `4 / 14 / 10 px` offsets with lerp `0.001 * dt`, then throws them away: dead code [code]. Measured shift at both sizes was **0 px** [frames]. The intended design was ±4 px for the back blocks and ±14 x 10 px for the front, smoothed at about 1.7 % per frame.

## 3. Easing curves and durations (complete list found)

GSAP names map to CSS as follows:

| GSAP | Curve | CSS cubic-bezier |
|---|---|---|
| Power1 | Quad | – |
| Power2.easeOut | Cubic | `(.215,.61,.355,1)` |
| Power2.easeInOut | Cubic | `(.645,.045,.355,1)` |
| Power3.easeInOut | Quart | `(.77,0,.175,1)` |
| Power4.easeIn | Quint | `(.755,.05,.855,.06)` |
| Power4.easeOut | Quint | `(.23,1,.32,1)` |
| Power4.easeInOut | Quint | `(.86,0,.07,1)` |

Their CSS uses exactly one bezier: `cubic-bezier(.215,.61,.355,1)` (14 uses). Everything else is `ease` or linear.

**Scene and global moves:**

| Element | Duration | Ease | Delay / notes |
|---|---|---|---|
| Chapter transition (`offsetProgress` 0→1) | **1.75 s** | Power3.easeInOut | swap at p = 0.5; SFX at +0.7 s |
| Landing → chapter 1 slide (out, then in) | 1 s + 1 s | Power2.easeInOut | in starts at 0.7 s |
| Ending card drop (`y -100vh → 0`) | **2 s** | Power4.easeInOut | |
| Ending letters (`y -35vh → 0`) | 0.8 s each | Power2.easeOut | 1.0 s + 0.1 s stagger |
| Ending logo / social icons | 1 s / 0.7 s | custom | 2.6 s, +0.1 s stagger |
| Chapter title in / out (noise dissolve) | **8 s** each | linear | in at enter, out at +7 s |
| Other noise reveals | 6 s; 2 s | linear | 2 s one has delay 5 s |
| Character zoom-in / out | 1.5 s | Power4.easeInOut | |
| Ch.2 crystal activation | progress 2 s | Power1.easeIn | spin-up 0.6 s (delay 1.8 s), spin-down 2.2 s Power4.easeOut (delay 2.2 s), anim 2.5 s linear, camera shake 0.7 s decay from amplitude 0.1 |
| Ch.2 hotspot pop-in | 0.9 s each | – | 0 / 0.8 / 1.6 s stagger at +13 s |
| Hotspot hide | 0.5 s | Power4.easeIn | scale → 0 |

**Hover and UI:**

| Element | Duration | Ease | Notes |
|---|---|---|---|
| Landing disc hover | 0.9 s | Power2.easeOut | size 0.35 → 0.40 (378 → 432 px radius @1440) |
| Title on disc hover | 0.9 s | Power2.easeOut | scale 1 → 1.1, delay 0.25 s |
| Disc hover out | 0.9 s | Power2.easeOut | reverse |
| Button (Start / Next) hover | 0.5 s | CSS `ease` | end-caps `translateX ±36 %`, middle `scaleX 1.3` |
| Button hover texture cross-fade | 0.4 s | – | |
| Button show / hide | 0.5 s / 0.55 s | – | caps travel ±156 %, middle `scaleX 0 ↔ 1`, opacity 0.5 s, label 0.9 s (delay 0.1) |
| Audio button | 0.4 s | Power2.easeOut | hover scale 0.9; show 0.6 s from scale 0 |
| Social icon hover | 0.5 s | – | fill → `#838fa9` |
| Text box reveal | 0.5 s + 0.25 s | easeOutCubic | panel `scaleX 0.5 → 1` from left edge + opacity; text 0.8 s fade, delay 0.7 s |
| Subtitle card | 0.5 s | CSS `ease` | appears 200 ms after cue; text 400 ms after cue (per-letter spans exist but `spanify` is a no-op) |
| Cursor label | 0.25 s | – | delay 0.15 s |
| Cursor parts | 0.25 s | – | |
| Loader bar | 0.8 s; 0.5 s | easeOutCubic; `ease` | 0.5 s is the progress smoothing |
| Misc fades | 0.5 s | – | audio text, orientation handler |

**Audio:**

| Element | Timing |
|---|---|
| Scene audio fade-in / fade-out | 0.6 s / 1.3 s |
| Music stem cross-fades | `setTargetAtTime` time constant **1.4 s** (4 s on the landing) |

## 4. Scroll-to-scene mapping

**None. Scroll is not used.**
- `main.js` has no `wheel` / `mousewheel` / `DOMMouseScroll` listener [code].
- `body` is `overflow:hidden` and `.scroll-handler` is `display:none` on desktop [code].
- I sent 8–10 wheel steps of `deltaY=120` per scene, 300 ms apart [measured]:
  - `scrollY` stayed **0**.
  - The chapter index did not change.
  - Camera range was **0.0000** in all chapters.
  - Frame differences matched the ambient-animation baseline: chapter 3 differs 13–15 MAD with or without wheel; chapter 4 about 0.3.

On mobile only, `.scroll-handler` (`100vh + 300px`) exists so a swipe-up hides the browser chrome.

Progression is event-driven: complete the interaction, the Next button appears, click it for a 1.75 s transition. So there is no virtual scroll and no scroll lerp to report.

## 5. Cursor follow and mouse reactions

**Camera follow** [measured, 56 corner moves at each size, identical]:
- First reaction **1 frame** after the mousemove (13–18 ms).
- Fitted per-frame factor **0.0400** (fit range 0.0400–0.0401; one outlier 0.046 was a frame hitch).
- Time constant **τ = 408 ms**.
- **t50 = 283 ms, t90 = 950 ms, t99 = 1.88 s.**

The code matches: `pos += (target − pos) * 0.04` per rendered frame [code]. The factor is **not dt-corrected**, so at 120 Hz the camera would settle twice as fast [estimated from code].

**Cursor dot position.** There is **no lag**: the DOM transform is set from the raw mouse on the next rAF. Measured latency is a median of 16.6 ms (≈1 frame, max 42 ms under load).

**Cursor shape** [code] is eased at **0.12 per frame** (τ ≈ 130 ms, t90 ≈ 310 ms). It is drawn on a 150 px canvas:

| State | Radius |
|---|---|
| Idle | 9 px (0.12 x 75) |
| Over UI | 5.6 px |
| "Enter" / "Drag" / "Hold" label | 37.5 px |
| Dragging | 18 px plus a 3.6 px centre dot |

**Hold.** A ring of radius 44 px draws over **2 s** (+0.5/s) and unwinds at 0.9/s, with easeInOutCubic on the draw.

**Other mouse reactions:**
- Ch.3 hold ramps its speed by +0.02/frame and decays it by −0.015/frame.
- The flower-growth drag uses a plane raycast.
- The landing disc grows on hover.
- There is **no camera tilt in degrees**: the camera translates (orbit) and does not rotate. An unused orbit controller (`paralax-controler`, smoothing `dt*4`) exists in the bundle [code].

## 6. How scenes enter and leave

1. **Next button hides**: 0.5 s fade while the caps collapse over 0.55 s.
2. `next()` activates the next chapter immediately, rendering it to a zero-size viewport, so its shaders compile.
3. **Transition**, 1.75 s Power3.easeInOut [code; measured curve matches easeInOutQuart, max error 0.04–0.07 when it starts cleanly]:
   - **Both chapter cameras crane upward 20 world units** (100 for the ending). The outgoing camera rises 0 → 20 and the incoming rises from −20 → 0. Measured: the incoming camera's world y rose by 20.2 units (−0.80 → 19.37).
   - A dedicated **foreground transition scene** sweeps through the frame. Its camera y goes −100 → +100, so its cards cross the screen top-to-bottom. The cards are:
     - 1→2: bushes / foliage canopy;
     - 2→3: clouds;
     - 3→4: sand and clouds.
   - At p = 0.5 the old chapter is deactivated while it is fully hidden behind the cards (a "foreground wipe", not a fade).
   - Whoosh SFX at +0.7 s.
4. **Measured hitch**: s1→s2 and s2→s3 showed a **~0.7 s stall** at the start of the transition (no rAF for ~0.85 s, then the curve hit p = 0.5 at ~1.6 s instead of 0.875 s, at both sizes). The likely cause is the first render and shader compile of the incoming scene. The visible transition was ≈2.4 s instead of 1.75 s. s3→s4 started cleanly (p = 0.5 at 0.88 s; max error vs easeInOutQuart 0.04–0.07). s4→ending has a *scripted* 1 s delay (character zoom-out first), which is not a hitch. **Pre-warm the next scene** in Drift.
5. **Chapter enter**:
   - Title quad dissolves in through a noise threshold with a 0.005-wide dark edge outline (8 s linear).
   - The interaction unlocks at **+3 s**; the cursor gets its "Drag" / "Hold" label.
   - The title dissolves out from **+7 s** (8 s).
   - The voice-over starts at once and subtitle cards follow the SRT.
6. **Ending**:
   - The character zooms out (1.5 s).
   - After 1 s the transition runs.
   - At +0.5 s the ending DOM card drops 2 s Power4.easeInOut and the letters stagger in.
   - At 1.9 s the tribute GIF swaps in.

## 7. Typography and colour

**Families** [code + computed styles]. Gotham Book (400) and Gotham at 500 / 700 / 900. The display titles are **bespoke lettering delivered as SVG/PNG, not a font**.

| Role | 1440 | 1920 | Weight | Line-height | Tracking | Other |
|---|---|---|---|---|---|---|
| Subtitle / voice-over card | **16 px** | **16 px** | Book 400 | **24 px (1.5)** | normal | Black on a textured paper card, padding 30 / 40 px, max-width 500 px (card 455–580 px wide). `.8em` + padding 25 / 30 below 1200 px wide. |
| Button label (Start) | **16 px** | 16 px | 700 caps | 1.0 | normal | `#f8f4ec`. 12 px below 1440 px wide. |
| Button label (Next) | 12 px | 12 px | 700 caps | 1.0 | normal | Button 175 x 58 px. |
| Cursor label | 12.8 px | 12.8 px | 400 | 1.0 | normal | Black, inside the cream cursor disc. |
| Micro UI ("Best experienced…") | 12 px | 12 px | Book | 0.74 | normal | White. |
| Title plate lettering | ≈ 22 vw block | | | | | SVG; scaled x2.55 into the plate at 1440. |

**Type-scale ratio.** UI 12 : body 16 is 1.33 (perfect fourth). Body does not scale between 1440 and 1920 [measured]. Display lettering scales with the viewport (vw-based).

**Layout scaling** [code]:
- Title plate width is `79.24vw`, max 1180 px (1141 px at 1440).
- At ≥1700 x ≥1000 the max becomes 1600 px (1521 px at 1920).
- Height-limited viewports shrink it to 65 vw or 63.5 vw.

**Dominant palettes** [frames: 4-bit quantised buckets, share of pixels]:

| Scene | Palette |
|---|---|
| Loader / landing ground | `#61667c` (92–95 %); cream disc `#f1ece6` / `#eeeae3` |
| Title plate | `#f1ece6` 36 %, `#eee9e3`, slate `#777d96`, blush `#f3e1dd` |
| Ch.1 meadow | mint `#c2e6ca` 17–19 %, deep teal `#556969`, parchment `#ddd8ca` / `#e3d7c9`, jade `#77b59b`; terracotta rocks |
| Ch.2 shore | blush sky `#ebcccb`, periwinkle `#a9b3c6`, slate `#6b728b`, sage-grey `#98a8a9` |
| Ch.3 night flight | navy-blue `#456282` (53 %), lavender `#b7bbd8`, `#354b63`; dominant cool monochrome with yellow streak accents |
| Ch.4 desert dawn | sand `#e4dcd1` 32–35 %, pale sky `#d7e7ea`, rust `#765a57` |
| Ending | cream `#f1ede4` 71–79 %, slate ink `#656a85` |

**Ink and grade** [code]:
- Outline colour is `#111111`; the stroke thickness constant is 8e-4, divided by 0.5 x DPR when DPR > 1 (so unchanged at DPR 2); it reads as ≈1–1.5 px lines in the frames.
- Colours are pastel and desaturated with one saturated accent per scene.
- A per-material colour-correct chunk applies hue shift, brightness/contrast and saturation.
- Noise-dissolve reveals also hue-shift by −0.63 rad, darken 0.2 and desaturate to 0.4 at the edge.

**Grain, vignette, bloom.**
- **Paper grain everywhere.** In GL, the fragment colour is *multiplied* by a tiling paper texture (`bg-tile.png`) at `gl_FragCoord / (0.5 x texture width)`. In DOM, every flat area uses tiled paper JPGs (blue, white).
- Measured high-frequency luminance std: about 2 on the flat loader and **10–16** in scenes.
- **No vignette, bloom or chromatic aberration** in the GL code. The darker corners in ch.1 (corner luminance 132 vs centre 214) come from framing foreground foliage, not a shader.
- No FXAA. MSAA is on only when DPR < 1.5. Pixel ratio is capped at 2.

## 8. Other craft details

**Audio** [code; the network log shows the files]:
- Adaptive score: **4 music stems** all looping in sync. Each chapter calls `setStep(n)` to bring in stems 0..n at gain **0.45** (time constant 1.4 s).
- Each chapter has an ambient bed loop plus interaction one-shots (birds, grass, leaves, waterfall, crystals).
- Narrated voice-over with `.srt` subtitles.
- UI hover and click sounds, plant-grow / grown sounds and a transition whoosh.
- Mute toggle bottom-right.
- The preloader states "Best experienced with sound".

**UI chrome** [code]:
- One margin, **40 px**, from every edge:
  - audio button 32 x 32 px at bottom/right 40;
  - sound hint at bottom/right 40;
  - ending logo top-left 40 (122 x 20 px);
  - GIF bottom-left 40 / 30;
  - socials bottom 37 / right 100.
- "Next" sits top-centre at 50 px with a 42 px hairline above it.
- Subtitle cards rotate through 4 fixed anchors so they never cover the same spot twice in a row:
  - top 80 % / right 10 %;
  - top 45 % / left 6 %;
  - top 12 % / right 10 %;
  - other anchors on the landing and ending.
- The native cursor is hidden and replaced by the canvas cursor (`cursor:none`).

**Responsive** [code]:
- Phones get a separate path: an orientation prompt (rotate to landscape), swipe-up to collapse the browser chrome, the cursor hidden, title at 63.4 vw, subtitles 11 px with padding 15 / 20.
- Below 1200 px wide, subtitles are 0.8 em.
- The GL canvas is rounded to multiples of 4 px.
- The camera keeps **hfov 53.13° / vfov 31.42°**, whichever limits, so wide and tall screens never crop the composed shot.

**Performance** [code]:
- The DOM rAF manager is throttled to ≥16 ms ticks.
- The GL loop clamps dt to 1/60 when a frame is >200 ms or <5.5 ms.
- All chapters, and all 4 transition scenes, are loaded up front (24.6 MB) before the landing shows.

**Idle animation** never stops: grass wind-deform shader, particles drifting in a constant wind, crystal bob (`0.4 * sin(t)`), look-at wobble (`0.1 * cos(6.5 t * 0.8)`). A paused scene still breathes.

---

## Techniques to reuse in Drift

These are concrete targets. Use them with our own art and copy.

1. **Camera mouse-follow**
   - `k = 1 − 0.96^(dt / 16.67 ms)`: the same 0.04-per-60 Hz-frame feel (τ ≈ 408 ms, t50 ≈ 0.28 s, t90 ≈ 0.95 s), but dt-corrected.
   - Orbit the camera position about a fixed look-at. Do not rotate the camera.
   - Amplitude ±0.8 (x) / ±0.45 (y) world units for calm scenes. Use ±2 / ±1 for one "rush" scene (e.g. the drift-current / storm beat).
2. **Parallax ratios to cursor travel**
   - Background **+2 %**, pivot 0, foreground **−3 %**, frame-edge foliage / debris **−8…−11 %**.
   - The DOM-layer equivalent of their intended values: back layers ±4 px, front ±14 x 10 px, smoothed at ~0.017 per frame.
   - For our DOM scroll story: map 1 viewport of scroll to ±2 % / −3 % / −10 % layer translation ratios around a still midground.
3. **Cursor**
   - Position follows with **zero lag**: write the transform on the next rAF.
   - Ease only its scale and opacity at **0.12 per frame** (τ ≈ 130 ms).
   - Idle dot 18 px diameter, 75 px with a label, 11 px over UI.
   - Label fade 0.25 s with 0.15 s delay.
   - Press-and-hold ring fills in 2.0 s and unwinds at 0.9/s.
4. **Signature ease.** "Settle" ease `cubic-bezier(0.04, 1, 0.31, 0.98)` (≈ their CustomEase) for anything arriving: titles, panels, logo.
5. **Other eases**
   - Scene moves: `cubic-bezier(.77,0,.175,1)` (easeInOutQuart).
   - Big DOM slides: `(.645,.045,.355,1)`.
   - Hovers and reveals: `(.215,.61,.355,1)`.
   - Hide/collapse: `(.755,.05,.855,.06)` (easeInQuint).
6. **Scene transition**
   - **1.75 s easeInOutQuart**.
   - Swap scenes at progress 0.5 behind a full-frame foreground layer sweeping vertically. For Drift: a wave crest, a kelp curtain or a drifting plastic bloom.
   - Both scene cameras crane the same way over the transition.
   - SFX at +0.7 s.
   - **Pre-warm (compile and render) the next scene before triggering**; theirs stalls ≈0.7 s.
7. **Reveal choreography**
   - Big covering disc / mask 1.2 s easeInOutQuart.
   - Hero mark moves into place 0.8 s easeInOutQuint after 0.3 s.
   - Content fades in at 0.55 s.
   - Side panels slide in from ±50 vw at **0.15 s stagger**, 1 s settle ease.
   - The whole beat lands in **≈ 2.05 s**.
8. **Preloader**
   - One hand-drawn vertical stroke (8 x 283 px) revealed by a mask, track at 20 % opacity.
   - Progress smoothed with a 0.5 s transition.
   - In and out 0.8 s easeOutCubic, sliding *up* through its own mask.
   - Hand-off: a growing disc (0.9 s easeOutCubic) plus the title fading from scale 1.3 → 1 over 1.4 s with the settle ease (0.3 s delay).
   - No numbers or percentages.
9. **Chapter beat**
   - Title dissolves in over 8 s via a noise threshold with a thin dark edge.
   - Interaction unlocks at +3 s; title dissolves out from +7 s.
   - The Next control appears only after the visitor acts.
10. **Text**
    - Body / subtitle 16 / 24 px (1.5).
    - UI 12 px uppercase bold labels (ratio 1.33).
    - Body does not grow from 1440 to 1920; display art scales in vw.
    - Card padding 30 / 40 px, max measure 500 px; cards rotate through 3–4 fixed anchors.
    - Subtitle card fades 0.5 s, 200 ms after the cue.
11. **Chrome.** Single **40 px** edge margin for all chrome; 32 px icon buttons; hover scale 0.9 in 0.4 s.
12. **Texture and grade**
    - Multiply a tiling paper/grain texture over both GL and DOM (target HF luminance std ≈ 10–16 in scenes).
    - Ink outlines `#111` at ~1 px.
    - Pastel palettes with one saturated accent per scene.
    - **No bloom, vignette or chromatic aberration**: frame with foreground elements instead.
13. **Sound**
    - 4-stem adaptive score, one stem added per chapter (gain 0.45, 1.4 s time constant).
    - Per-scene ambient loop, interaction one-shots, UI hover/click, transition whoosh.
    - "Best experienced with sound" hint during load; mute bottom-right.
14. **Performance**
    - Cap DPR at 2.
    - MSAA only when DPR < 1.5.
    - Clamp dt (≤ 200 ms).
    - Keep idle animation running so no scene is ever frozen.

## Not measured, or only partly measured

- **Camera tilt in degrees.** The camera translates around a look-at node. I did not sample the look-at distance, so there is no angle. The world-unit amplitude and the screen-px parallax are given instead.
- **Chapter 2 and 3 band parallax** is noisy because of constant animation (birds, water, fast flight). Chapter 3 is only an estimate (≈10–15 %).
- **Frame-accurate timings from screenshots.** Screencast delivery was irregular on this loaded machine. Contact-sheet labels show the real frame offset. All timing numbers above come from rAF samples or code.
- **Audio levels.** Gains are from code only; I did not do any loudness analysis of the audio.
- **Mobile / touch behaviour.** Read from code only; not run on a device.
- **Preloader progress duration** depends on network (14 s here). The fixed parts (0.8 s in/out, +0.5 s / +1.1 s hand-off, 1.4 s title) are reliable.

## Files

| Path | Purpose |
|---|---|
| `tools/record.mjs` | Playwright recorder. `MODE=video` gives the video pass. |
| `tools/analyze.mjs` | Fits, parallax, palettes, contact sheets. |
| `tools/probe.mjs` | Dumps their JS/CSS for reading. |
| `tools/gpu-check.mjs` | GL backend and fps check. |
| `tools/shot-speed.mjs` | Screenshot vs screencast speed check. |
| `frames/1440x900/`, `frames/1920x1080/` | Frames by phase; `log.json`, `samples.json`, `analysis.json`. |
| `video/makemepulse_<size>.webm` | Gitignored. |
| `../compare/makemepulse_<size>_keyframes.jpg` | Contact sheet: preloader → landing → reveal → 4 chapters → ending. |
| `../compare/makemepulse_<size>_motion.jpg` | Contact sheet: s1→s2 transition sequence + mouse-lag frames. |
