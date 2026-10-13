// Faithful copy of the `constants` JSON block at the bottom of docs/science.md.
// Only addition: childrenPerSplit (modelling assumption, not in the JSON).
export const CONSTANTS = {
  "_notes": "Days unless noted. sink p/day = 1 - exp(-1/tau). windageFeature = clamp((w - 0.001)/(0.010 - 0.001), 0, 1).",
  "seawaterDensity": {
    "value": 1.025,
    "units": "g/cm3",
    "src": "Andrady2011"
  },
  "sizeClassesMm": {
    "macro": {
      "min": 25,
      "max": null
    },
    "meso": {
      "min": 5,
      "max": 25
    },
    "micro": {
      "min": 1,
      "max": 5
    },
    "smallMicro": {
      "min": 0,
      "max": 1
    }
  },
  "items": {
    "bottle": {
      "polymer": "PET",
      "startClass": "macro",
      "onsetDays": {
        "value": 5475,
        "range": [
          255,
          5475
        ],
        "src": "Ioakeimidis2016",
        "assumption": true,
        "why": "seafloor 'robust ~15 yr'; 255 d = beached lower bound from Song2017 conversion (polyolefin, not PET)"
      },
      "halfLifeToNextSizeClassDays": {
        "macro": {
          "value": 5475,
          "src": "Ioakeimidis2016",
          "assumption": true
        },
        "meso": {
          "value": 5475,
          "src": "Chamas2020",
          "assumption": true,
          "why": "SSDR half-life scales with thickness, not lateral size"
        },
        "micro": {
          "value": 5475,
          "src": "Chamas2020",
          "assumption": true
        }
      },
      "initialWindage": {
        "value": 0.02,
        "feature": 1,
        "src": "Maximenko2018",
        "assumption": true
      },
      "density": {
        "value": 1.37,
        "units": "g/cm3",
        "src": "Andrady2011",
        "note": "PET row seen via secondary table only"
      },
      "floats": {
        "value": true,
        "src": "Andrady2011",
        "assumption": true,
        "why": "intact capped bottle floats on trapped air; PET fragments (below macro) do not float"
      },
      "fragmentsFloat": {
        "value": false,
        "src": "Andrady2011"
      }
    },
    "bag": {
      "polymer": "LDPE",
      "startClass": "macro",
      "onsetDays": {
        "value": 365,
        "src": "Chamas2020",
        "assumption": true,
        "why": "~30% of 100 um film thickness ablated at 15 um/yr per face"
      },
      "halfLifeToNextSizeClassDays": {
        "macro": {
          "value": 1241,
          "src": "Chamas2020",
          "note": "marine half-life 3.4 yr (1.4 to >2500 yr)"
        },
        "meso": {
          "value": 1241,
          "src": "Chamas2020",
          "assumption": true
        },
        "micro": {
          "value": 1241,
          "src": "Chamas2020",
          "assumption": true
        }
      },
      "initialWindage": {
        "value": 0.01,
        "feature": 1,
        "src": "Poulain2009",
        "assumption": true,
        "why": "flush film ~ undrogued drifter; films keep this windage at all sizes"
      },
      "density": {
        "value": 0.92,
        "range": [
          0.91,
          0.93
        ],
        "units": "g/cm3",
        "src": "Andrady2011"
      },
      "floats": {
        "value": true,
        "src": "Andrady2011"
      },
      "fragmentsFloat": {
        "value": true,
        "src": "Andrady2011"
      }
    },
    "fishingLine": {
      "polymer": "PA (nylon)",
      "startClass": "macro",
      "onsetDays": {
        "value": 365,
        "src": "Brakstad2022",
        "assumption": true,
        "why": "needs UV; unchanged after 36 months in dark seawater; sunlit gillnet yarn lost ~55% strength in 300 d (unverified secondary)"
      },
      "halfLifeToNextSizeClassDays": {
        "macro": {
          "value": 1490,
          "src": "WeldenCowie2017",
          "assumption": true,
          "why": "50% / (1.02%/month) linear = ~49 months; benthic rope"
        },
        "meso": {
          "value": 1490,
          "src": "WeldenCowie2017",
          "assumption": true
        },
        "micro": {
          "value": 1490,
          "src": "WeldenCowie2017",
          "assumption": true
        }
      },
      "initialWindage": {
        "value": 0,
        "feature": 0,
        "src": "Andrady2011",
        "why": "sinks"
      },
      "density": {
        "value": 1.14,
        "range": [
          1.13,
          1.15
        ],
        "units": "g/cm3",
        "src": "Andrady2011",
        "note": "secondary tables cite Sundt et al. 2014"
      },
      "floats": {
        "value": false,
        "src": "Andrady2011"
      },
      "fragmentsFloat": {
        "value": false,
        "src": "Andrady2011"
      }
    },
    "tyreWear": {
      "polymer": "tyre rubber + road mineral (TRWP)",
      "startClass": "smallMicro",
      "emittedMedianDiameterUm": {
        "value": 50,
        "range": [
          44,
          54
        ],
        "src": "Dittmar2025"
      },
      "onsetDays": {
        "value": 0,
        "src": "Kole2017",
        "why": "emitted already as micro-particles"
      },
      "halfLifeToNextSizeClassDays": {},
      "initialWindage": {
        "value": 0,
        "feature": 0,
        "src": "JungChoi2022",
        "why": "sinks"
      },
      "density": {
        "value": 1.5,
        "range": [
          1.2,
          1.7
        ],
        "units": "g/cm3",
        "src": "JungChoi2022"
      },
      "settlingVelocityMmPerS": {
        "value": 0.4,
        "range": [
          0.22,
          0.65
        ],
        "src": "Dittmar2025"
      },
      "floats": {
        "value": false,
        "src": "JungChoi2022"
      },
      "fragmentsFloat": {
        "value": false,
        "src": "JungChoi2022"
      }
    }
  },
  "windageBySizeClass": {
    "macro": {
      "value": null,
      "note": "use item initialWindage"
    },
    "meso": {
      "value": 0.01,
      "feature": 1,
      "src": "PazanNiiler2001",
      "assumption": true
    },
    "micro": {
      "value": 0.001,
      "feature": 0,
      "src": "Poulain2009",
      "assumption": true,
      "why": "wind-mixed below surface ~ drogued drifter slip 0.1%"
    },
    "smallMicro": {
      "value": 0.001,
      "feature": 0,
      "src": "Poulain2009",
      "assumption": true
    },
    "filmOverride": {
      "value": 0.01,
      "feature": 1,
      "src": "Poulain2009",
      "assumption": true,
      "note": "bag fragments keep 1% at all sizes"
    }
  },
  "drifterSlip": {
    "drogued": {
      "value": 0.001,
      "src": "PazanNiiler2001",
      "note": "~0.1% (Niiler et al. 1995 via NOAA AOML)"
    },
    "undrogued": {
      "value": 0.01,
      "range": [
        0.01,
        0.015
      ],
      "src": "Poulain2009",
      "note": "Lumpkin2013: ~50% higher than earlier estimates"
    }
  },
  "sinkTimescaleDays": {
    "smallMicro": {
      "value": 30,
      "pPerDay": 0.0328,
      "src": "Lobelle2021",
      "assumption": true
    },
    "micro": {
      "value": 40,
      "pPerDay": 0.0247,
      "src": "Lobelle2021"
    },
    "meso": {
      "value": 66,
      "pPerDay": 0.015,
      "src": "FazeyRyan2016"
    },
    "macro": {
      "value": 11984,
      "pPerDay": 0.0000834,
      "src": "Lebreton2019",
      "assumption": true,
      "why": "No direct sinking data for buoyant macro items. Lebreton2019 best-fit total removal of offshore buoyant macroplastic = 3%/yr (fit to production dates of GPGP debris, Lebreton2018; >90%/yr sinks cannot reproduce it). Sinking alone can be no faster, so tau = -1/ln(0.97) yr = 32.8 yr. Macro items leave the surface mainly by beaching or fragmentation. Consistent with Maximenko2018 tsunami boats (e-folding 2-8 yr, mostly beaching) and Onink2021 (items afloat up to 50 yr after production)."
    },
    "gyreMultiplier": {
      "value": 3,
      "src": "Lobelle2021",
      "assumption": true,
      "why": "no sinking within 90 d in subtropical gyres"
    },
    "denserThanSeawater": {
      "value": 1,
      "pPerDay": 0.632,
      "src": "Andrady2011",
      "assumption": true,
      "why": "PET fragments, nylon, TRWP leave surface without fouling"
    }
  },
  "beachProbabilityPerContactDay": {
    "value": 0.095,
    "lambdaBDays": 10,
    "rangeLambdaBDays": [
      1,
      100
    ],
    "src": "Onink2021",
    "note": "Onink zone = 10 km; Drift mask = 1 deg"
  },
  "resuspensionProbabilityPerDay": {
    "value": 0.0144,
    "lambdaRDays": 69,
    "rangeLambdaRDays": [
      69,
      273
    ],
    "src": "Onink2021"
  },
  "gyres": [
    {
      "name": "North Pacific",
      "lonMin": -153,
      "lonMax": -133,
      "latMin": 28,
      "latMax": 38,
      "src": "Lebreton2018",
      "assumption": true
    },
    {
      "name": "South Pacific",
      "lonMin": -115,
      "lonMax": -85,
      "latMin": -35,
      "latMax": -20,
      "src": "Eriksen2013",
      "assumption": true
    },
    {
      "name": "North Atlantic",
      "lonMin": -70,
      "lonMax": -40,
      "latMin": 22,
      "latMax": 38,
      "src": "Law2010",
      "assumption": true
    },
    {
      "name": "South Atlantic",
      "lonMin": -25,
      "lonMax": 5,
      "latMin": -38,
      "latMax": -22,
      "src": "vanSebille2012",
      "assumption": true
    },
    {
      "name": "Indian Ocean",
      "lonMin": 70,
      "lonMax": 100,
      "latMin": -35,
      "latMax": -22,
      "src": "vanSebille2012",
      "assumption": true
    }
  ],
  "childrenPerSplit": {
    "value": 4,
    "assumption": true,
    "note": "children per split"
  }
};
