# Drift: science notes and cited constants

Drift is a **simulation with uncertainty, not a forecast**. Every number the code uses is either
(a) taken from a cited source, or (b) flagged as an **assumption** that bridges sources, with the
reasoning written down. Citation keys such as `[Chamas2020]` match the `src` fields in the JSON
block at the end of this file.

Sources were researched in October 2026. Where I could only reach an abstract or a secondary
summary, and not the full text, the entry says so. A value marked "not verified" should not be
quoted in story copy until someone checks it against the primary source.

Size classes used throughout (following the request): **macro** > 25 mm, **meso** 5 to 25 mm,
**micro** 1 to 5 mm, **smallMicro** < 1 mm. Seawater density is taken as ~1.025 g/cm3: a material
denser than that sinks unless it traps air.

---

## 1. Fragmentation and degradation timescales

### 1.0 Reasons for caution

- **The "450 years for a bottle" figure has no traceable source.** `[WardReddy2020]` reviewed 57
  public infographics that give plastic lifetimes (255 estimates across 13 countries). The authors
  could not find a citable or credible scientific source behind them. Many credit NOAA, but NOAA
  program staff could not produce underlying data either. Estimates for a single item ranged from
  about a year to "forever". **Drift does not use 450 years or any number from those posters.**
- **Almost no fragmentation data come from the floating open ocean.** Most measurements come from
  buried or land-exposed samples, lab UV chambers, or beaches. Beaches are where UV, heat and
  abrasion combine, and they are thought to be where most fragmentation happens. A floating item is
  cooler, often fouled and shaded, so it degrades more slowly.
- **Mass loss is a different quantity from fragmentation into pieces.** `[Chamas2020]` reports
  surface ablation (mass loss). `[Song2017]` counts fragments. We need "time until an item breaks
  into the next size class", and no paper measures that directly. Every per-class half-life below
  is therefore an **assumption** derived from the cited rates.

### 1.1 Key quantitative sources

**[Chamas2020]** Chamas, A., Moon, H., Zheng, J., Qiu, Y., Tabassum, T., Jang, J.H., Abu-Omar, M.,
Scott, S.L., Suh, S. (2020). Degradation Rates of Plastics in the Environment. *ACS Sustainable
Chemistry & Engineering* 8(9), 3494-3511. https://doi.org/10.1021/acssuschemeng.9b06635
- *What it did:* a literature meta-analysis that converts reported degradation into a "specific
  surface degradation rate" (SSDR, µm of thickness lost per year). It then extrapolates half-lives
  for typical items, assuming constant surface area (zeroth order).
- *Numbers (Table 1, marine):* HDPE SSDR 4.3 µm/yr (range 0-11). LDPE SSDR 15 µm/yr (range 0-37).
  Half-lives: **LDPE bag (100 µm) 3.4 yr (1.4 to >2500 yr)**, HDPE bottle (500 µm) 58 yr (23 to
  >2500 yr), HDPE pipe 1200 yr. **PET: no marine data, and no degradation detected in buried
  tests.** Nylon is not covered.
- *Certainty:* low. The authors stress that the data are sparse and the upper bounds unbounded. A
  shrinking-geometry model gives half-lives about 2x longer. (The page text of Table 1 was partly
  garbled when fetched. The LDPE bag and HDPE bottle values were confirmed by the authors' blog and
  the abstract.)

**[Song2017]** Song, Y.K., Hong, S.H., Jang, M., Han, G.M., Jung, S.W., Shim, W.J. (2017). Combined
Effects of UV Exposure Duration and Mechanical Abrasion on Microplastic Fragmentation by Polymer
Type. *Environ. Sci. Technol.* 51(8), 4368-4376. https://doi.org/10.1021/acs.est.6b06155
- *What it did:* exposed PE, PP and EPS pellets to lab UV for 0, 2, 6 or 12 months, then tumbled
  them with sand for 2 months to mimic a beach.
- *Numbers:* after 12 months of UV plus abrasion, PE gave ~20 particles per pellet and PP ~6,084.
  EPS gave ~12,152 particles per pellet after 6 months of UV plus abrasion, and ~4,220 with abrasion
  alone.
- *Lab-to-field conversion:* **12 months of lab UV is roughly equal to 4.2 years of environmental
  exposure** in South Korea. This is the conversion used by `[Kaandorp2021]`, who attribute it to
  Song et al.
- *Certainty:* medium for the ranking (EPS fragments fastest, then PP, then PE). Low for absolute
  field timescales.

**[Kaandorp2021]** Kaandorp, M.L.A., Dijkstra, H.A., van Sebille, E. (2021). Modelling size
distributions of marine plastics under the influence of continuous cascading fragmentation.
*Environ. Res. Lett.* 16, 054075. https://doi.org/10.1088/1748-9326/abe9ea (full preprint text read:
arXiv:2011.01775)
- *What it did:* fitted a cascading fragmentation model to the `[Song2017]` data and placed it in a
  Mediterranean ocean, coast and beach box model.
- *Numbers:* fragmentation rate 1.8e-2 to 6.9e-2 "f per year" (PE to PP). In their baseline run,
  about 6.5e-5 % of macroplastic mass becomes microplastic **per week**. Removal by sinks is much
  faster, at ~5e-2 % per week. The authors call the rate "very uncertain".
- *Takeaway for Drift:* by mass, fragmentation is slow compared with removal. By particle count it
  dominates, because one parent item produces many fragments.

**[Ioakeimidis2016]** Ioakeimidis, C., Fotopoulou, K.N., Karapanagioti, H.K., Geraga, M., Zeri, C.,
Papathanassiou, E., Galgani, F., Papatheodorou, G. (2016). The degradation potential of PET bottles
in the marine environment: An ATR-FTIR based approach. *Scientific Reports* 6, 23501.
https://doi.org/10.1038/srep23501
- *What it did:* measured surface chemistry (FTIR) on PET bottles of known age recovered from the
  Greek seafloor.
- *Numbers:* PET bottles stayed chemically robust for **about 15 years**. After that, their native
  functional groups declined markedly.
- *Certainty:* medium for seafloor conditions (dark and cold). This is the only real-world marine
  PET timescale we found.

**[WeldenCowie2017]** Welden, N.A., Cowie, P.R. (2017). Degradation of common polymer ropes in a
sublittoral marine environment. *Mar. Pollut. Bull.* 118(1-2), 248-253.
https://doi.org/10.1016/j.marpolbul.2017.02.072 *(DOI from memory and not verified. Volume and
pages were verified.)*
- *What it did:* deployed PP, PE and nylon ropes on the seabed at 10 m depth for 12 months.
- *Numbers:* average mass loss per month was **nylon 1.02 %**, PE 0.45 % and PP 0.39 %. Surfaces
  roughened and shed fibres even with little sunlight.
- *Certainty:* medium. These are ropes rather than monofilament, and benthic rather than floating.

**[Brakstad2022]** Brakstad, O.G. et al. (2022). The fate of conventional and potentially degradable
gillnets in a seawater-sediment system. *Mar. Pollut. Bull.* 180, 113759.
https://doi.org/10.1016/j.marpolbul.2022.113759
- *What it did:* kept nylon and PBSAT gillnet filaments in seawater-sediment microcosms at 20 °C
  for 36 months, in the dark.
- *Numbers:* **nylon filaments were unchanged** in tensile strength and under SEM after 36 months.
- *Certainty:* medium. The result shows that without UV, nylon monofilament barely degrades.

### 1.2 Per item

#### (a) PET bottle

- **Density:** PET ~1.37 g/cm3 `[Andrady2011]` *(the PET row of Andrady's Table 1 was not seen
  directly; a secondary table that cites Andrady gives 1.37)*. **A PET bottle floats only because
  it is capped and air-filled.** Fragments of PET are denser than seawater and sink.
- **Onset of visible fragmentation:** **5,475 days (15 yr)**, taken from `[Ioakeimidis2016]`.
  This is a seafloor value, so for a sunlit, floating or beached bottle it is probably an
  overestimate. No study gives a floating-PET onset.
  - Plausible lower bound for beached exposure: **~255 days**. This is 2 months of lab UV in
    `[Song2017]` converted at 4.2 yr per 12 months, and it is the first UV level at which
    polyolefin pellets fragmented more under abrasion. That evidence is for PP and PE, not PET.
    **Range: 255 to 5,475 days.**
  - Consequence for the story: on a 10-year timeline, the honest default is that an open-ocean
    bottle is still largely intact. The "It breaks" chapter should show the bottle breaking up
    **on a beach, or after it has stranded and refloated**. Alternatively, it can say that the
    timing is uncertain.
- **Half-life to the next size class:** **5,475 days per class** (assumption). In the SSDR picture
  of `[Chamas2020]`, the half-life scales with thickness and not with lateral size. A shard of
  bottle wall keeps the wall's thickness, so each class takes about as long as the first.
- **Certainty:** low. There are no quantitative marine data for PET fragmentation.

#### (b) LDPE plastic bag or film

- **Density:** 0.91-0.93 g/cm3 `[Andrady2011]` (confirmed via a secondary reproduction of Table 1).
  It floats.
- **Mass half-life:** **3.4 yr (1,241 days)** in the marine setting `[Chamas2020]`, with a range of
  1.4 yr to >2,500 yr. The accelerated land test gives 2.3 yr.
- **Onset:** **365 days** (assumption). A 100 µm bag losing 15 µm/yr from each face
  `[Chamas2020]` has lost about 30 % of its thickness after a year. That is the point at which
  embrittled film plausibly starts to tear into meso pieces. The figure also sits between the
  ~255-day polyolefin lower bound from the `[Song2017]` conversion and the 3.4-yr half-life.
- **Half-life to the next size class:** **1,241 days per class** (assumption). This is the Chamas
  marine half-life, applied per class on the same thickness argument as for PET.
- **Certainty:** low to medium. LDPE has the most data of the four items, but the range spans three
  orders of magnitude.

#### (c) Nylon (PA) monofilament fishing line

- **Density:** ~1.13-1.15 g/cm3 (PA). Secondary tables cite Sundt et al. 2014 and `[Andrady2011]`.
  **Nylon is denser than seawater, so monofilament sinks** unless it is tangled with floats or
  other debris. Drift should treat loose line as non-floating.
- **Onset:** **365 days** (assumption). Gillnet yarns 0.16-0.20 mm thick exposed to sunlight in
  air lost about 55 % of their break-load in 300 days. That figure comes from a secondary summary
  of an Indian gillnet study (J. Mar. Biol. Assoc. India) and is *not verified*. In the dark at
  20 °C, nylon was unchanged after 36 months `[Brakstad2022]`. So onset depends heavily on light.
  We take about one sunlit year for floating line and note that sunken line effectively never
  starts.
- **Half-life to the next size class:** **1,490 days** (assumption). This is 50 % of 1.02 % per
  month, extrapolated linearly from `[WeldenCowie2017]` (about 49 months).
- **Certainty:** low. The rope data come from the seabed, and the monofilament strength-loss data
  are not a fragmentation rate.

#### (d) Tyre wear particles (TWP / TRWP)

- They are **emitted already as micro-particles**, so they have no onset and no macro stage.
- **Size:** the median diameter of tyre-and-road-wear particles is **44-54 µm** (mass-weighted;
  highway tunnel and road simulator) `[Dittmar2025]`. They start in the **smallMicro** class.
- **Density:** TRWP fall at **1.20-1.70 g/cm3** `[JungChoi2022]`. Pure tread particles are ~1.2
  g/cm3. The mineral road material that sticks to them makes them denser. A 2024 conference
  abstract reported 1.9 g/cm3 falling to 1.2 as biofilm formed (*not peer reviewed*). We use
  **1.5 g/cm3** (mid-range). **They sink.** The "~1.8" figure you may see in trade press is within
  the reported spread but was not traced to a primary source.
- **Settling velocity:** median **0.22-0.65 mm/s** `[Dittmar2025]`. That works out to about 2-5
  days to fall 100 m in still water. Turbulence will lengthen this.
- **Context:** tyre wear may contribute **5-10 %** of the plastics reaching the ocean
  `[Kole2017]` (from the abstract).
- **Certainty:** medium for the facts that they sink and their size. Low for the share of
  emissions that reaches the sea.

**[Dittmar2025]** Dittmar, S., Weyrauch, S., Reemtsma, T., Eisentraut, P., Altmann, K., Ruhl, A.S.,
Jekel, M. (2025). Settling velocities of tire and road wear particles. *Environ. Sci. Technol.*
59(26), 13434-13446. https://doi.org/10.1021/acs.est.5c04165

**[JungChoi2022]** Jung, U., Choi, S.-S. (2022). Classification and Characterization of Tire-Road
Wear Particles in Road Dust by Density. *Polymers* 14(5), 1005.
https://doi.org/10.3390/polym14051005 *(DOI built from the MDPI URL.)*

**[Kole2017]** Kole, P.J., Löhr, A.J., Van Belleghem, F.G.A.J., Ragas, A.M.J. (2017). Wear and Tear
of Tyres: A Stealthy Source of Microplastics in the Environment. *Int. J. Environ. Res. Public
Health* 14(10), 1265. https://doi.org/10.3390/ijerph14101265

**[Andrady2011]** Andrady, A.L. (2011). Microplastics in the marine environment. *Mar. Pollut.
Bull.* 62(8), 1596-1605. https://doi.org/10.1016/j.marpolbul.2011.05.030. Table 1 gives densities
for common marine plastics. The LDPE value was seen in a secondary copy. The PET and nylon rows were
not seen directly.

**[WardReddy2020]** Ward, C.P., Reddy, C.M. (2020). Opinion: We need better data about the
environmental persistence of plastic goods. *PNAS* 117(26), 14618-14621.
https://doi.org/10.1073/pnas.2008009117 *(DOI not verified; PMC7334500)*

---

## 2. Windage (leeway)

Windage is the extra drift, as a percentage of the 10 m wind speed, of an object that sticks out of
the water, beyond the drift of the surface current. **Drift's model has only a 0..1 drifter-drogue
feature** (0 = drogued SVP drifter, 1 = drogue lost). This is a proxy for windage, so each physical
windage value has to be mapped onto it (see 2.3).

### 2.1 Drifter slip (the proxy itself)

- **Undrogued SVP drifters slip downwind at about 1 % of wind speed.**
  - `[PazanNiiler2001]` Pazan, S.E., Niiler, P.P. (2001). Recovery of near-surface velocity from
    undrogued drifters. *J. Atmos. Oceanic Technol.* 18, 476-489. The globally averaged slip is about
    9.7 cm/s per 10 m/s of wind, or ~1 %. *(Value from secondary NOAA material.)*
  - `[Poulain2009]` Poulain, P.-M., Gerin, R., Mauri, E., Pennel, R. (2009). Wind Effects on Drogued
    and Undrogued Drifters in the Eastern Mediterranean. *J. Atmos. Oceanic Technol.* 26,
    1144-1156. https://doi.org/10.1175/2008JTECHO618.1 *(DOI not verified)*. The abstract states that
    co-located undrogued drifters slip downwind at about 1 % of wind speed relative to drogued ones.
    The wind-driven current seen by drogued drifters is ~0.7 % of wind speed. That is a separate
    quantity, not slip.
  - `[Lumpkin2013]` Lumpkin, R., Grodsky, S.A., Centurioni, L., Rio, M.-H., Carton, J.A., Lee, D.
    (2013). Removing spurious low-frequency variability in drifter velocities. *J. Atmos. Oceanic
    Technol.* 30, 353-360. https://doi.org/10.1175/JTECH-D-12-00139.1. The abstract says downwind
    slip of undrogued drifters is about 50 % higher than previously believed (that is, roughly
    1.5 %). *(The full text could not be fetched, so this is the abstract-level claim.)*
  - `[Laurindo2017]` Laurindo, L.C., Mariano, A.J., Lumpkin, R. (2017). An improved near-surface
    velocity climatology for the global ocean from drifter observations. *Deep-Sea Res. I* 124,
    73-92. https://doi.org/10.1016/j.dsr.2017.04.009. They apply a **spatially varying** slip
    correction to undrogued drifters, which make up ~56 % of the 1979-2015 data. **I could not
    retrieve their coefficient values** (the PDF returned HTTP 403), so this paper is cited for the
    method only. Do not quote a Laurindo percentage.
- **Drogued SVP drifters slip at about 0.1 % of wind speed** (less than 1 cm/s per 10 m/s wind).
  This is Niiler et al. (1995) as reported by NOAA AOML. The "0.07 %" figure in the request was
  **not found** in any source.

### 2.2 Debris windage

- `[Maximenko2018]` Maximenko, N., Hafner, J., Kamachi, M., MacFadyen, A. (2018). Numerical
  simulations of debris drift from the Great Japan Tsunami of 2011 and their verification with
  observational reports. *Mar. Pollut. Bull.* 132, 5-25.
  https://doi.org/10.1016/j.marpolbul.2018.03.056 (full text read)
  - *What it did:* ran five ocean models with windage from 0 up to 5-6 %, then fitted them against
    sightings of 327 tsunami boats.
  - *Numbers:* the optimal boat windage was **1.1-2.8 %**, depending on the model (at sea: 1.1 %
    SCUD, 1.3 % SCUD-HYCOM, 2.1 % FORA, 2.8 % MOVE; West Coast arrivals: 1.5-1.9 %). High-windage
    items reached North America within the first year. **Low-windage items collected in the North
    Pacific garbage patch.**
  - *Note:* the windage that fits best depends on the model, because each model represents the
    wind-driven surface current differently.
- `[Onink2021]` (full citation in section 4) used **no explicit windage**. They added Stokes drift
  instead, arguing that windage and Stokes drift are similar at global scale and that open-ocean
  floating-plastic models perform best without a separate windage term.
- The commonly used "1-3 %" range for debris is consistent with `[Maximenko2018]`. Duhec et al.
  2015 (Seychelles) used the SCUD model. **I found no windage coefficient in their abstract**, so
  they are not cited for a value.

### 2.3 Values chosen and mapping to the 0..1 feature

`windageFeature = clamp((w - 0.1 %) / (1.0 % - 0.1 %), 0, 1)`. This anchors the feature to the two
drifter states: drogued slip ~0.1 % and undrogued slip ~1 %. **Anything above 1 % saturates at 1.**
That is a known limit of the proxy: the drifter record contains nothing that drifts like a 2 %
object.

| Item or class | Physical windage | Feature | Basis |
|---|---|---|---|
| PET bottle (capped, riding high) | 2.0 % | 1.0 | `[Maximenko2018]` boats 1.1-2.8 %; assumption that a capped bottle is comparable |
| LDPE bag or film (any size, floating) | 1.0 % | 1.0 | assumption: film lies flush, like an undrogued drifter `[Poulain2009]` |
| Fishing line | 0 % | 0.0 | sinks (density) |
| Tyre particles | 0 % | 0.0 | sinks (density) |
| meso fragment (rigid) | 1.0 % | 1.0 | assumption: flush-floating, undrogued-like |
| micro fragment | 0.1 % | 0.0 | assumption: mm pieces are mixed below the surface by wind, so they behave like a drogued drifter |
| smallMicro fragment | 0.1 % | 0.0 | as above |

---

## 3. Sinking by biofouling

- **[FazeyRyan2016]** Fazey, F.M.C., Ryan, P.G. (2016). Biofouling on buoyant marine plastics: An
  experimental study into the effect of size on surface longevity. *Environmental Pollution* 210,
  354-360. https://doi.org/10.1016/j.envpol.2016.01.026
  - *What it did:* tethered 15 sizes of PE pieces (cm-scale sheets) in False Bay, South Africa, for
    12 weeks.
  - *Numbers:* all sizes sank within the 12 weeks. **The time to a 50 % chance of sinking was 17
    days for the smallest pieces and 66 days for the largest.** Smaller pieces lost buoyancy
    faster, because fouling scales with surface area while buoyancy scales with volume.
    (`[Kooi2017]` quotes the range as 17-62 days. The Fazey & Ryan abstract says 17-66.)
  - *Certainty:* medium for a productive coastal site. Probably fast compared with the open ocean.
- **[Kooi2017]** Kooi, M., van Nes, E.H., Scheffer, M., Koelmans, A.A. (2017). Ups and Downs in the
  Ocean: Effects of Biofouling on Vertical Transport of Microplastics. *Environ. Sci. Technol.*
  51(14), 7963-7971. https://doi.org/10.1021/acs.est.6b04702
  - *What it did:* built a 1D model of biofilm growth combined with settling.
  - *Numbers:* the predicted onset of settling is **24-26 days** for spheres of 1 mm and 10 mm
    radius. A 0.1 mm particle settled within 100 days under North Pacific conditions, after about
    700 days under South Pacific conditions, and **never** under the North Atlantic scenario.
    Buoyant particles **oscillate**: mm-scale particles resurface, while particles of 10 µm and
    smaller do not.
- **[Lobelle2021]** Lobelle, D., Kooi, M., Koelmans, A.A., Laufkötter, C., Jongedijk, C.E., Kehl, C.,
  van Sebille, E. (2021). Global Modeled Sinking Characteristics of Biofouled Microplastic. *J.
  Geophys. Res. Oceans* 126(4), e2020JC017098. https://doi.org/10.1029/2020JC017098 (full text read)
  - *What it did:* ran a global 3D simulation over 90 days with biofouling from NEMO-MEDUSA.
  - *Numbers:* the median global sinking timescale is **33-43 days** for particles of 10 µm-1 mm
    radius (LDPE 40-43, PP 35-38, EPS 33-36.5; SD ±18 d). Size matters more than density.
    Equatorial and upwelling regions: **< 10 days**. **Subtropical gyres: particles of 10 µm-1 mm
    did not sink within 90 days.** In a 1,000-day gyre run, only 2 of 25 LDPE particles of 1 mm
    radius sank.
- `[Onink2021]` points out that floating items have been found up to **50 years** after their
  estimated production date. This suggests that in the open ocean, biofouling needs longer than
  66 days to sink larger items.

**Chosen e-folding timescales τ** (daily sink probability `p = 1 - exp(-1/τ)`), for floating
polyolefin outside gyres:

| Class | τ (days) | p/day | Basis |
|---|---|---|---|
| smallMicro | 30 | 0.0328 | `[Lobelle2021]` median 33-43 d; `[FazeyRyan2016]` smallest 17 d; assumption at the low end, because smaller sinks faster |
| micro | 40 | 0.0247 | `[Lobelle2021]` median; `[Kooi2017]` 24-26 d onset |
| meso | 66 | 0.0150 | `[FazeyRyan2016]` largest size, 66 d |
| macro | 11,984 (≈32.8 yr) | 0.0000834 | assumption, set to the upper bound on removal from `[Lebreton2019]` (3 %/yr); see below |

**Why macro is ~33 years and not 365 days (revised).** No study measures how quickly a buoyant
*macro* item (a capped bottle, a bag) sinks from biofouling in the open ocean. The fouling
experiments stop at cm-sized sheets after 12 weeks. The age of floating debris does constrain it,
though:
- `[Lebreton2018]`: 50 debris items from the Great Pacific Garbage Patch, collected in 2015, had a
  readable production date: **1 from 1977, 7 from the 1980s, 17 from the 1990s, 24 from the 2000s
  and 1 from 2010** (full text read).
- `[Lebreton2019]` fitted a box model to that age distribution. **Best fit: d = 3 % of the mass of
  buoyant macroplastic removed per year** (by degradation into microplastic, the model's only
  permanent sink). The authors state that a rapid sink of more than 90 % per year cannot reproduce
  the age distribution. They also note that 3 %/yr agrees with field immersion tests showing
  0.65-1.9 % mass loss in 12 months. They estimate that objects take 5-10 years to travel from
  source to the gyre (full text read).
- `[Maximenko2018]`: of ~1,000 boats set adrift by the 2011 tsunami, about 100 were projected to
  still float in 2018. That is an **e-folding decay of 2-8 years**, mostly from beaching, since the
  model ignores sinks other than shorelines. This is an upper bound on removal for very buoyant
  objects.
- `[Onink2021]` (above): items are found afloat up to 50 years after production.

Taken together, offshore removal of buoyant macro items is slow, on the order of **a few % per year
in total**. Lebreton puts all of it into fragmentation and has no separate sinking term, so
**sinking alone can be no faster than that**. We use the 3 %/yr total as an upper bound for
sinking: τ = −1/ln(0.97) yr = 32.8 yr = **11,984 days**. The gyre ×3 multiplier then gives about
98 yr inside gyres, which is consistent with decades-old objects in the North Pacific patch. In
Drift, a macro item therefore leaves the surface mainly by **beaching** (section 4) or by
**fragmenting** into meso pieces (section 1), and very rarely by sinking whole.

*Inconsistency left in place:* Lebreton's 3 %/yr whole-ocean macro degradation rate is slower than
the LDPE-bag half-life in section 1 (3.4 yr, about 18 %/yr). That half-life is specific to thin
film, while Lebreton's rate is an average over mostly thick, rigid objects, so the two values were
not reconciled.

- **Gyre multiplier: ×3** inside the five gyre boxes (assumption). `[Lobelle2021]` found no sinking
  within 90 days in subtropical gyres, so τ_gyre > 90 d for small classes (3×30 = 90).
- **Items denser than seawater** sink without needing to foul. This covers PET fragments (any
  class below macro), nylon line and tyre particles. Use **τ = 1 day** to leave the surface. For
  tyre particles, the time to settle 100 m is 2-5 days `[Dittmar2025]`.

---

## 4. Beaching

**[Onink2021]** Onink, V., Jongedijk, C.E., Hoffman, M.J., van Sebille, E., Laufkötter, C. (2021).
Global simulations of marine plastic transport show plastic trapping in coastal zones. *Environ.
Res. Lett.* 16, 064053. https://doi.org/10.1088/1748-9326/abecbd (full text read)
- *What it did:* tracked particles globally from 2010 for 5 years with HYCOM currents plus Stokes
  drift, beaching stochastically within 10 km of the coast.
- *Formula:* `pB = 1 - exp(-dt/λB)` while within the 10 km beaching zone. λB is the number of days a
  particle has to spend in the zone for a 63.2 % chance of beaching. Resuspension:
  `pR = 1 - exp(-dt/λR)`.
- *Numbers:* λB was tested at 1, 2, 5, 10, 26, 35 and 100 days, and **λB = 10 d is used for the
  maps**. The authors state that no experimental basis exists for λB. Mediterranean drifter and
  inverse studies suggest 26-76 d. λR is 69-273 d, from tagged-litter experiments on Japanese
  beaches (Hinata et al. 2017), and **69 d is used for the maps**. After 5 years, between 31 % and
  95 % of buoyant plastic is beached depending on the parameters, and **at least 77 % is beached or
  within 10 km of the coast**.
- *Comparison:* the box model of `[Lebreton2019]` assumed 97 %/yr beaching of coastal plastic
  (λB ≈ 104 d) and only 1 %/yr resuspension, which Onink et al. consider too slow.

**[Lebreton2019]** Lebreton, L., Egger, M., Slat, B. (2019). A global mass budget for positively
buoyant macroplastic debris in the ocean. *Scientific Reports* 9, 12922.
https://doi.org/10.1038/s41598-019-49413-5 (full text read). Its stranding probability is
s = 96-98 % within a year: the share of particles spending ≥ 2 consecutive days within 1/16° of
shore, rising with windage from 0 to 2 %. It estimates that **66.8 %** of buoyant macroplastic
released since the 1950s is held on shorelines. Its best-fit macro degradation rate is **3 %/yr**
(see section 3).

**Chosen values:**
- `beachProbabilityPerContactDay = 1 - exp(-1/10) = 0.095` (λB = 10 d) `[Onink2021]`. **Caveat:**
  Onink applies this within 10 km of shore. Drift's land mask uses 1° cells (~111 km), and a member
  counts as "in contact" only when its next step lands on a land cell. Each contact therefore
  stands in for the part of a day spent near shore. We keep 0.095 per contact day and accept that
  it may under-beach compared with Onink.
- `resuspensionProbabilityPerDay = 1 - exp(-1/69) = 0.0144` (λR = 69 d) `[Onink2021]`, from
  Hinata 2017. Use this if the code lets beached members refloat.

---

## 5. Subtropical gyre accumulation zones

**None of the primary sources publishes bounding boxes.**
- `[vanSebille2012]` defines patches on a 1° grid as connected areas with tracer accumulation factor
  > 2, and shows them only in maps. van Sebille, E., England, M.H., Froyland, G. (2012). Origin,
  dynamics and evolution of ocean garbage patches from observed surface drifters. *Environ. Res.
  Lett.* 7, 044040. https://doi.org/10.1088/1748-9326/7/4/044040
- `[Maximenko2012]` describes five drifter-convergence zones at the centres of the subtropical
  gyres. The North Pacific zone lies between Hawai'i and California. The South Pacific zone, near
  Easter Island, is the densest in the model. Maximenko, N., Hafner, J., Niiler, P. (2012). Pathways
  of marine debris derived from trajectories of Lagrangian drifters. *Mar. Pollut. Bull.* 65(1-3),
  51-62. https://doi.org/10.1016/j.marpolbul.2011.04.016

All five boxes below are therefore **assumptions** drawn to enclose the documented features:

| Name | lonMin | lonMax | latMin | latMax | Anchors |
|---|---|---|---|---|---|
| North Pacific | -153 | -133 | 28 | 38 | `[Lebreton2018]`: survey 25-41°N, 129-156°W; patch = 1 kg/km² contour ≈ 1.6 million km²; box ≈ 2.1 million km² |
| South Pacific | -115 | -85 | -35 | -20 | `[Eriksen2013]`: peak 396,342 particles/km² at the centre of the predicted zone on the Chile-Easter Island-Pitcairn transect; `[Maximenko2012]`: near Easter Island |
| North Atlantic | -70 | -40 | 22 | 38 | `[Law2010]`: highest concentrations at ~22-38°N in the western North Atlantic tows |
| South Atlantic | -25 | 5 | -38 | -22 | maps in `[vanSebille2012]` / `[Maximenko2012]` only (weakest anchor) |
| Indian Ocean | 70 | 100 | -35 | -22 | maps only. `[vanSebille2012]`: this patch is leaky and disperses within ~100 yr |

Further notes from `[vanSebille2012]`: the North Pacific patch keeps growing for 1,000+ years, and
leakage from the South Atlantic and Indian Ocean patches flows towards the South Pacific.

- **[Lebreton2018]** Lebreton, L., Slat, B., Ferrari, F., et al. (2018). Evidence that the Great
  Pacific Garbage Patch is rapidly accumulating plastic. *Scientific Reports* 8, 4666.
  https://doi.org/10.1038/s41598-018-22939-w (full text read). The patch holds ~79,000 t (range
  45,000-129,000) over 1.6 million km² and ~1.8 trillion pieces. Debris larger than 5 cm makes up
  over 75 % of the mass, and fishing nets at least 46 %. Microplastics are 8 % of the mass but 94 %
  of the pieces.
- **[Eriksen2013]** Eriksen, M., Maximenko, N., Thiel, M., et al. (2013). Plastic pollution in the
  South Pacific subtropical gyre. *Mar. Pollut. Bull.* 68, 71-76.
  https://doi.org/10.1016/j.marpolbul.2012.12.021
- **[Law2010]** Law, K.L., Morét-Ferguson, S., Maximenko, N.A., Proskurowski, G., Peacock, E.E.,
  Hafner, J., Reddy, C.M. (2010). Plastic Accumulation in the North Atlantic Subtropical Gyre.
  *Science* 329, 1185-1188. https://doi.org/10.1126/science.1192321. The 22-38°N band comes from
  WHOI's summary of the paper.

---

## 6. Food chain and deep sea (story copy)

1. **The deepest recorded plastic is a bag at 10,898 m in the Mariana Trench.** JAMSTEC's
   deep-sea debris archive (5,010 dives since 1983) holds 3,425 human-made items. More than a third
   are macroplastic, and 89 % of that plastic is single-use. Below 6,000 m those shares rise to
   52 % and 92 %. `[Chiba2018]` Chiba, S., Saito, H., Fletcher, R., et al. (2018). Human footprint in
   the abyss: 30 year records of deep-sea plastic debris. *Marine Policy* 96, 204-212.
   https://doi.org/10.1016/j.marpol.2018.03.022 *(DOI and pages not verified; volume verified)*.
   Certainty: high (direct observation).
2. **72 % of amphipods (65 of 90) sampled from six Pacific trenches, at 7,000-10,890 m, had
   ingested microparticles.** The Mariana Trench had the highest mean count. `[Jamieson2019]`
   Jamieson, A.J., Brooks, L.S.R., Reid, W.D.K., et al. (2019). Microplastics and synthetic particles
   ingested by deep-sea amphipods in six of the deepest marine ecosystems on Earth. *R. Soc. Open
   Sci.* 6, 180667. https://doi.org/10.1098/rsos.180667. Certainty: high. The particles include
   semi-synthetic and natural fibres, so say "synthetic particles", not only "plastic".
3. **Seabirds:** 59 % of species studied between 1962 and 2012 had ingested plastic. A model
   estimates that about 90 % of individual seabirds have done so, and projects that 99 % of species
   will be affected by 2050. `[Wilcox2015]` Wilcox, C., Van Sebille, E., Hardesty, B.D. (2015).
   Threat of plastic pollution to seabirds is global, pervasive, and increasing. *PNAS* 112(38),
   11899-11904. https://doi.org/10.1073/pnas.1502108112. Certainty: the 59 % is observed. The 90 %
   and 99 % are **model projections** and should be worded that way.
4. **What floats is a small part of the total.** Floating plastic is estimated at **≥ 5.25 trillion
   pieces weighing ≥ 268,940 t** `[Eriksen2014]`. One extrapolation puts **~14 million t** of
   microplastic on the seafloor `[Barrett2020]`. That figure is scaled up from a single region (the
   Great Australian Bight, 1,655-3,062 m). The two estimates measure different things, so say
   "far more lies on the seafloor than floats", not an exact ratio. `[Eriksen2014]` Eriksen, M.,
   et al. (2014). Plastic Pollution in the World's Oceans: More than 5 Trillion Plastic Pieces
   Weighing over 250,000 Tons Afloat at Sea. *PLoS ONE* 9(12), e111913.
   https://doi.org/10.1371/journal.pone.0111913. `[Barrett2020]` Barrett, J., Chase, Z., Zhang, J.,
   et al. (2020). Microplastic Pollution in Deep-Sea Sediments From the Great Australian Bight.
   *Front. Mar. Sci.* 7, 576170. https://doi.org/10.3389/fmars.2020.576170
5. **Most of the mass in the Great Pacific Garbage Patch is large debris, including at least 46 %
   fishing nets. Microplastics are 94 % of the pieces but 8 % of the mass** `[Lebreton2018]`.
6. **Most buoyant plastic never leaves the coast:** at least 77 % is beached or within 10 km of
   shore after 5 years in the model `[Onink2021]`.

---

## 7. Fraser River and Salish Sea

1. **NE Pacific subsurface seawater held 8-9,200 microplastic particles/m³.** About three quarters
   were fibres. Concentrations were 12-fold higher in the Strait of Georgia than the lowest offshore
   values (6-fold off west Vancouver Island, 27-fold in Queen Charlotte Sound). The authors link the
   nearshore rise to land-based inputs. `[Desforges2014]` Desforges, J.-P.W., Galbraith, M., Dangerfield,
   N., Ross, P.S. (2014). Widespread distribution of microplastics in subsurface seawater in the NE
   Pacific Ocean. *Mar. Pollut. Bull.* 79(1-2), 94-99.
   https://doi.org/10.1016/j.marpolbul.2013.12.035. Certainty: high.
2. **Zooplankton in the NE Pacific eat microplastics: about 1 in 34 copepods and 1 in 17
   euphausiids contained a particle.** Juvenile salmon eat both. `[Desforges2015]` Desforges,
   J.-P.W., Galbraith, M., Ross, P.S. (2015). Ingestion of Microplastics by Zooplankton in the
   Northeast Pacific Ocean. *Arch. Environ. Contam. Toxicol.* 69(3), 320-330.
   https://doi.org/10.1007/s00244-015-0172-5. Certainty: high. A "particles per salmon per day"
   figure circulates but could not be verified, so do not use it.
3. **Sediments in Baynes Sound and Lambert Channel, Canada's main oyster-growing area in the Strait
   of Georgia, held up to 25,000 microbeads/kg dry sediment.** Microplastics were found at every
   one of 16 sites. `[Kazmiruk2018]` Kazmiruk, T.N., Kazmiruk, V.D., Bendell, L.I. (2018). Abundance
   and distribution of microplastics within surface sediments of a key shellfish growing region of
   Canada. *PLoS ONE* 13(5), e0196005. https://doi.org/10.1371/journal.pone.0196005. Certainty:
   high. (This is not a Strait-wide figure.)
4. **Fraser River export (thesis-level, flag as such):** a UBC graduate thesis on combined sewer
   overflows estimates that the Fraser River carries **0.67-3.35 trillion microparticles per year**
   to the Strait of Georgia. Most were fibres (76-86 % in river samples, mostly polyester). UBC Open
   Collections item 1.0396325 (author reported as Parizi, 2021; **title and author not verified**,
   because the page would not load). A later UBC group reported Fraser River concentrations of
   22.8 ± 19.7 particles/m³ in a PICES 2024 poster and 81 ± 19 particles/m³ in a thesis. The two
   disagree, and **neither is peer reviewed**. Use only as "estimates suggest trillions of
   particles a year". Ocean Wise and the NRC are collecting Fraser and Strait data to validate a
   transport model, but no results are published.

---

## 8. Salish Sea particle tracking

In Salish Sea mode, floating particles move with SalishSeaCast's hourly near-surface currents on a
~0.01° × 0.005° grid (~700 × 550 m). A random walk with horizontal eddy diffusivity K is added to
stand in for motion the grid cannot resolve, so each fragment spreads as a cloud of possible
positions rather than following one line.

### 8.1 Horizontal eddy diffusivity K

**[Okubo1971]** Okubo, A. (1971). Oceanic diffusion diagrams. *Deep-Sea Research* 18(8), 789-802.
https://doi.org/10.1016/0011-7471(71)90046-5 *(DOI from memory and not verified; the volume, issue
and pages are confirmed in Blanken 2020's reference list)*
- *What it did:* compiled dye-release experiments covering roughly 100 m to 100 km and hours to a
  month. It fitted the growth of patch variance with time, σ_rc² = 0.0108 t^2.34 (cm², s), and
  apparent diffusivity against patch scale.
- *Verification:* I could not open the original paper. The variance law is reproduced as Eq. A.7 in
  `[Duran2021]`, citing Okubo's Eq. 3. Apparent diffusivity is defined as K_a = σ_rc²/(4t), and
  Okubo takes the patch scale as l = 3σ_rc. Substituting the variance law gives
  **K_a = 0.0103 l^1.15 (cm²/s, with l in cm)**, which reproduces the commonly quoted form; the
  coefficient comes out at 0.01026 and the exponent at 1.145. A lecture slide and `[Duran2021]`
  both independently report the ~l^1.1-1.15 scaling.
- *Values at Drift's scales:* l = 500 m gives 0.26 m²/s, 700 m gives 0.38 m²/s, **1 km gives
  0.58 m²/s** and 1.4 km gives 0.85 m²/s.
- *Certainty:* medium. The relation is an empirical envelope with about an order of magnitude of
  scatter. It comes from open-sea and coastal dye studies, not from the Salish Sea itself.

**[Duran2021]** Duran, R., Nordam, T., Serra, M., Barker, C. (2021). Horizontal transport in
oil-spill modeling. In *Marine Hydrocarbon Spill Assessments* (Elsevier), chapter 3. Preprint:
arXiv:2009.12954 (preprint read). *(The book chapter details are not verified; the preprint is.)* It
recommends a random walk whose diffusivity is chosen by scale or by particle age, following Okubo.

**Salish Sea-specific values:**
- `[Pawlowicz2019]` measured a dispersion coefficient from Salish Sea drifters. Their abstract says
  dispersion is often much more important than mean advection in parts of the Salish Sea. **I could
  not get the numeric value:** the full text and PDF both returned HTTP 403 and no open copy was
  found. Do not quote a number from it.
- `[Pawlowicz2021]` modelled 800 drifter groundings with a classical eddy-diffusivity formulation.
  The best-matching diffusivity was similar to the one found in open water away from the coast
  (abstract; numeric value not retrieved).
- I found no published horizontal diffusivity used in SalishSeaCast/OceanParcels runs.
- `[Blanken2020]` (Kitimat fjords, northern BC; full text read) derived a single-particle apparent
  diffusivity of 7.9 × 10⁶ cm²/s (790 m²/s) at 48 hours. That figure describes total drifter
  spreading over ~100 km, including motion the model *does* resolve, so it is **not** a value for
  sub-grid diffusion. The authors placed it near the upper limit of Okubo's 100 km range.

**Chosen value: K = 0.6 m²/s** (assumption). This is Okubo's K_a at l = 1 km. One kilometre is
roughly the smallest scale just above one 700 m model cell, below which SalishSeaCast cannot
represent eddies. **Range 0.26-0.85 m²/s** (l = 0.5-1.4 km, about one to two grid cells). Random-walk
step per axis: Δx = sqrt(2 K Δt) × N(0,1). With Δt = 3600 s this is about 66 m per hour.

### 8.2 Where floating things from the Fraser go (story copy)

1. **The Salish Sea traps floating objects. Surface drifters usually run aground within days, long
   before they could reach the open ocean.** More than 400 tracked drifters (2,200 drifter-days)
   and nearly 6,000 driftcards were released. Time to grounding was roughly exponentially
   distributed with a mean of only a few days, much shorter than the time to reach the ocean.
   `[Pawlowicz2019]` Pawlowicz, R., Hannah, C., Rosenberger, A. (2019). Lagrangian observations of
   estuarine residence times, dispersion, and trapping in the Salish Sea. *Estuarine, Coastal and
   Shelf Science* 225, 106246. https://doi.org/10.1016/j.ecss.2019.106246 (abstract read).
   Certainty: high.
2. **They typically ground within about 3 days, though some drifted for more than 30 days.**
   This is how `[Blanken2020]` summarises Pawlowicz et al. 2019. Blanken, H., Hannah, C.,
   Klymak, J.M., Juhász, T. (2020). Surface Drift and Dispersion in a Multiply Connected Fjord
   System. *J. Geophys. Res. Oceans* 125(2), e2019JC015425. https://doi.org/10.1029/2019JC015425.
   Certainty: medium, because this is a secondary summary.
3. **Grounding is chaotic one object at a time but predictable on average.** In 800 analysed
   groundings, grounding was only slightly more likely at high tide. The current ad hoc beaching
   rules in models are qualitatively reasonable but probably not accurate enough for mass budgets.
   `[Pawlowicz2021]` Pawlowicz, R. (2021). The Grounding of Floating Objects in a Marginal Sea.
   *J. Phys. Oceanogr.* 51(2), 537-551. https://doi.org/10.1175/JPO-D-20-0183.1 (abstract read).

The UBC Drifter Project says it expects Fraser outflow to pass Victoria and continue down Juan de
Fuca Strait. It presents this as a hypothesis to test, not a result, so **do not state the exit
route as fact.** The same page gives Fraser discharge as ~2,000 m³/s at winter low flow and more than
10,000 m³/s in June-July (UBC Drifter Project, https://drifters.eoas.ubc.ca/about; project page,
not peer reviewed).

**Salish grounding timescale (assumption):** the global beaching value λB = 10 d (section 4) does not
fit this basin. For Salish mode we use **3 days** as the e-folding time to ground, for particles in
coastal cells (`groundingTimescaleDays`, from "a few days" in `[Pawlowicz2019]` and "within 3 days"
in `[Blanken2020]`).

---

## 9. Main uncertainties (summary)

1. **Fragmentation timescales are the weakest link.** No study measures time to fragment by size
   class at the ocean surface. PET has no marine rate except a seafloor "robust for ~15 yr". All
   per-class half-lives are assumptions built on SSDR, the `[Song2017]` lab-to-field conversion and
   `[WeldenCowie2017]` rope mass loss.
2. **Windage proxy saturation.** The drifter feature only spans 0.1-1 % slip, so a 2 % bottle maps
   to the same feature value as a 1 % bag.
3. **λB has no experimental basis,** and the plausible range is 1-100 days. Drift's 1° mask is much
   coarser than Onink's 10 km zone.
4. **Biofouling depends strongly on region:** under 10 days at the equator, more than 90 days in
   gyres. Mm-scale particles can also resurface.
5. **The gyre boxes are hand-drawn** around documented features. Only the North Pacific box is
   anchored to a published survey extent.
6. **The Salish Sea K is not from the Salish Sea.** It comes from Okubo's general relation at an
   assumed 1 km scale. The Salish Sea drifter diffusivities in Pawlowicz 2019/2021 exist but could
   not be retrieved, so swap them in once someone has access.

---

## constants

```json
{
  "constants": {
    "_notes": "Days unless noted. sink p/day = 1 - exp(-1/tau). windageFeature = clamp((w - 0.001)/(0.010 - 0.001), 0, 1).",
    "seawaterDensity": { "value": 1.025, "units": "g/cm3", "src": "Andrady2011" },
    "sizeClassesMm": {
      "macro": { "min": 25, "max": null },
      "meso": { "min": 5, "max": 25 },
      "micro": { "min": 1, "max": 5 },
      "smallMicro": { "min": 0, "max": 1 }
    },
    "items": {
      "bottle": {
        "polymer": "PET",
        "startClass": "macro",
        "onsetDays": { "value": 5475, "range": [255, 5475], "src": "Ioakeimidis2016", "assumption": true, "why": "seafloor 'robust ~15 yr'; 255 d = beached lower bound from Song2017 conversion (polyolefin, not PET)" },
        "halfLifeToNextSizeClassDays": {
          "macro": { "value": 5475, "src": "Ioakeimidis2016", "assumption": true },
          "meso": { "value": 5475, "src": "Chamas2020", "assumption": true, "why": "SSDR half-life scales with thickness, not lateral size" },
          "micro": { "value": 5475, "src": "Chamas2020", "assumption": true }
        },
        "initialWindage": { "value": 0.02, "feature": 1.0, "src": "Maximenko2018", "assumption": true },
        "density": { "value": 1.37, "units": "g/cm3", "src": "Andrady2011", "note": "PET row seen via secondary table only" },
        "floats": { "value": true, "src": "Andrady2011", "assumption": true, "why": "intact capped bottle floats on trapped air; PET fragments (below macro) do not float" },
        "fragmentsFloat": { "value": false, "src": "Andrady2011" }
      },
      "bag": {
        "polymer": "LDPE",
        "startClass": "macro",
        "onsetDays": { "value": 365, "src": "Chamas2020", "assumption": true, "why": "~30% of 100 um film thickness ablated at 15 um/yr per face" },
        "halfLifeToNextSizeClassDays": {
          "macro": { "value": 1241, "src": "Chamas2020", "note": "marine half-life 3.4 yr (1.4 to >2500 yr)" },
          "meso": { "value": 1241, "src": "Chamas2020", "assumption": true },
          "micro": { "value": 1241, "src": "Chamas2020", "assumption": true }
        },
        "initialWindage": { "value": 0.01, "feature": 1.0, "src": "Poulain2009", "assumption": true, "why": "flush film ~ undrogued drifter; films keep this windage at all sizes" },
        "density": { "value": 0.92, "range": [0.91, 0.93], "units": "g/cm3", "src": "Andrady2011" },
        "floats": { "value": true, "src": "Andrady2011" },
        "fragmentsFloat": { "value": true, "src": "Andrady2011" }
      },
      "fishingLine": {
        "polymer": "PA (nylon)",
        "startClass": "macro",
        "onsetDays": { "value": 365, "src": "Brakstad2022", "assumption": true, "why": "needs UV; unchanged after 36 months in dark seawater; sunlit gillnet yarn lost ~55% strength in 300 d (unverified secondary)" },
        "halfLifeToNextSizeClassDays": {
          "macro": { "value": 1490, "src": "WeldenCowie2017", "assumption": true, "why": "50% / (1.02%/month) linear = ~49 months; benthic rope" },
          "meso": { "value": 1490, "src": "WeldenCowie2017", "assumption": true },
          "micro": { "value": 1490, "src": "WeldenCowie2017", "assumption": true }
        },
        "initialWindage": { "value": 0.0, "feature": 0.0, "src": "Andrady2011", "why": "sinks" },
        "density": { "value": 1.14, "range": [1.13, 1.15], "units": "g/cm3", "src": "Andrady2011", "note": "secondary tables cite Sundt et al. 2014" },
        "floats": { "value": false, "src": "Andrady2011" },
        "fragmentsFloat": { "value": false, "src": "Andrady2011" }
      },
      "tyreWear": {
        "polymer": "tyre rubber + road mineral (TRWP)",
        "startClass": "smallMicro",
        "emittedMedianDiameterUm": { "value": 50, "range": [44, 54], "src": "Dittmar2025" },
        "onsetDays": { "value": 0, "src": "Kole2017", "why": "emitted already as micro-particles" },
        "halfLifeToNextSizeClassDays": {},
        "initialWindage": { "value": 0.0, "feature": 0.0, "src": "JungChoi2022", "why": "sinks" },
        "density": { "value": 1.5, "range": [1.2, 1.7], "units": "g/cm3", "src": "JungChoi2022" },
        "settlingVelocityMmPerS": { "value": 0.4, "range": [0.22, 0.65], "src": "Dittmar2025" },
        "floats": { "value": false, "src": "JungChoi2022" },
        "fragmentsFloat": { "value": false, "src": "JungChoi2022" }
      }
    },
    "windageBySizeClass": {
      "macro": { "value": null, "note": "use item initialWindage" },
      "meso": { "value": 0.01, "feature": 1.0, "src": "PazanNiiler2001", "assumption": true },
      "micro": { "value": 0.001, "feature": 0.0, "src": "Poulain2009", "assumption": true, "why": "wind-mixed below surface ~ drogued drifter slip 0.1%" },
      "smallMicro": { "value": 0.001, "feature": 0.0, "src": "Poulain2009", "assumption": true },
      "filmOverride": { "value": 0.01, "feature": 1.0, "src": "Poulain2009", "assumption": true, "note": "bag fragments keep 1% at all sizes" }
    },
    "drifterSlip": {
      "drogued": { "value": 0.001, "src": "PazanNiiler2001", "note": "~0.1% (Niiler et al. 1995 via NOAA AOML)" },
      "undrogued": { "value": 0.01, "range": [0.01, 0.015], "src": "Poulain2009", "note": "Lumpkin2013: ~50% higher than earlier estimates" }
    },
    "sinkTimescaleDays": {
      "smallMicro": { "value": 30, "pPerDay": 0.0328, "src": "Lobelle2021", "assumption": true },
      "micro": { "value": 40, "pPerDay": 0.0247, "src": "Lobelle2021" },
      "meso": { "value": 66, "pPerDay": 0.0150, "src": "FazeyRyan2016" },
      "macro": { "value": 11984, "pPerDay": 0.0000834, "src": "Lebreton2019", "assumption": true, "why": "No direct sinking data for buoyant macro items. Lebreton2019 best-fit total removal of offshore buoyant macroplastic = 3%/yr (fit to production dates of GPGP debris, Lebreton2018; >90%/yr sinks cannot reproduce it). Sinking alone can be no faster, so tau = -1/ln(0.97) yr = 32.8 yr. Macro items leave the surface mainly by beaching or fragmentation. Consistent with Maximenko2018 tsunami boats (e-folding 2-8 yr, mostly beaching) and Onink2021 (items afloat up to 50 yr after production)." },
      "gyreMultiplier": { "value": 3, "src": "Lobelle2021", "assumption": true, "why": "no sinking within 90 d in subtropical gyres" },
      "denserThanSeawater": { "value": 1, "pPerDay": 0.632, "src": "Andrady2011", "assumption": true, "why": "PET fragments, nylon, TRWP leave surface without fouling" }
    },
    "beachProbabilityPerContactDay": { "value": 0.095, "lambdaBDays": 10, "rangeLambdaBDays": [1, 100], "src": "Onink2021", "note": "Onink zone = 10 km; Drift mask = 1 deg" },
    "resuspensionProbabilityPerDay": { "value": 0.0144, "lambdaRDays": 69, "rangeLambdaRDays": [69, 273], "src": "Onink2021" },
    "gyres": [
      { "name": "North Pacific", "lonMin": -153, "lonMax": -133, "latMin": 28, "latMax": 38, "src": "Lebreton2018", "assumption": true },
      { "name": "South Pacific", "lonMin": -115, "lonMax": -85, "latMin": -35, "latMax": -20, "src": "Eriksen2013", "assumption": true },
      { "name": "North Atlantic", "lonMin": -70, "lonMax": -40, "latMin": 22, "latMax": 38, "src": "Law2010", "assumption": true },
      { "name": "South Atlantic", "lonMin": -25, "lonMax": 5, "latMin": -38, "latMax": -22, "src": "vanSebille2012", "assumption": true },
      { "name": "Indian Ocean", "lonMin": 70, "lonMax": 100, "latMin": -35, "latMax": -22, "src": "vanSebille2012", "assumption": true }
    ],
    "salish": {
      "diffusivityM2s": { "value": 0.6, "range": [0.26, 0.85], "src": "Okubo1971", "assumption": true, "why": "Okubo apparent diffusivity K = 0.0103 l^1.15 (cm2/s, l in cm) at l = 1 km, the smallest scale just above one ~700 m SalishSeaCast cell; range = l of 0.5-1.4 km. Salish Sea drifter diffusivities (Pawlowicz2019/2021) exist but could not be retrieved." },
      "randomWalk": { "value": "dx = sqrt(2*K*dt) * N(0,1) per axis", "src": "Duran2021" },
      "groundingTimescaleDays": { "value": 3, "src": "Pawlowicz2019", "assumption": true, "why": "drifters ground with ~exponential time-to-grounding, mean 'a few days' (Pawlowicz2019 abstract); 'generally within 3 days' (Blanken2020 summary). E-folding time for particles in coastal cells in Salish mode." }
    }
  }
}
```
