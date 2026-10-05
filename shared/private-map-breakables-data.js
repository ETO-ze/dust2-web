// Derived from Valve source entities, model metadata and exact original triangles.
export const PRIVATE_BREAKABLES = {
  "schemaVersion": 1,
  "mapId": "de_mirage",
  "sourceSha256": "e66cdf1ae6a976f6f6ba510a2addd04b25a4c1cfd811f51f1ef13f0954e6e350",
  "physicsSha256": "f76f6fd83d4283e308ca89340dff8d5e7fc60d8c34ea21d13ab20eda23a51399",
  "maskSha256": "d855df038320009d9dfd1b1c6ff46a3de30ebecd189185fd76e15a75e07bd366",
  "groupsSha256": "112fca758748123bd81b04a7e5984241acc2a4325db1f3711f8bf75dd4397eca",
  "renderSha256": "3a9961c304591790a591d56bd09482c32dc52a1d7d1dedb1e04fac84b7dc72fe",
  "entitiesSha256": "4f70f5eb9fd552b2ee6e42d954e258e090a822313b18137b93916fb067c4e429",
  "initialHiddenNodeIndices": [
    3495
  ],
  "objects": [
    {
      "id": "mirage-ladder-vent",
      "nodeIndices": [
        3472,
        3473,
        3474,
        3475
      ],
      "nodeNames": [
        "wall_hole_b_cover_sheetmetal.nails",
        "wall_hole_b_cover_sheetmetal.panel0",
        "wall_hole_b_cover_sheetmetal.panel1",
        "wall_hole_b_cover_sheetmetal.panel2"
      ],
      "restoredNodeIndices": [],
      "origin": {
        "x": -29.7688,
        "y": -0.6095999999999999,
        "z": 10.9728
      },
      "bounds": {
        "min": {
          "x": -30.732576370239258,
          "y": -1.687361478805542,
          "z": 11.05337142944336
        },
        "max": {
          "x": -28.740325927734375,
          "y": 0.30312246084213257,
          "z": 11.26750659942627
        }
      },
      "material": "metal",
      "health": 1.0,
      "firstTriangle": 133849,
      "triangles": 48,
      "sourceEntity": {
        "hammeruniqueid": "2:60417:3758",
        "model": "resource_name:\"models/props/de_mirage/wall_hole_b_cover_sheetmetal.vmdl\"",
        "origin": [
          -1172.0,
          -432.0,
          -24.0
        ],
        "angles": [
          0.0,
          180.000076,
          0.0
        ],
        "@OnBreak": "Break [PR#]prop.breakable.02.brush"
      },
      "modelMetadataSha256": "ed1465f9853fcdd64c5c4baa9aa7bae9756f12def1349569d411c0bbcd82fda1"
    },
    {
      "id": "mirage-window-vent",
      "nodeIndices": [
        3485,
        3486,
        3487,
        3488,
        3489,
        3490,
        3491,
        3492
      ],
      "nodeNames": [
        "wall_hole_cover_sheetmetal.nails",
        "wall_hole_cover_sheetmetal.panel0",
        "wall_hole_cover_sheetmetal.panel1",
        "wall_hole_cover_sheetmetal.panel2",
        "wall_hole_cover_sheetmetal.panel3",
        "wall_hole_cover_sheetmetal.panel4",
        "wall_hole_cover_sheetmetal.panel5",
        "wall_hole_cover_sheetmetal.panel6"
      ],
      "restoredNodeIndices": [],
      "origin": {
        "x": -33.9344,
        "y": -3.3528,
        "z": 24.7396
      },
      "bounds": {
        "min": {
          "x": -33.72809982299805,
          "y": -4.242367267608643,
          "z": 23.725948333740234
        },
        "max": {
          "x": -33.64814376831055,
          "y": -2.3404483795166016,
          "z": 25.680286407470703
        }
      },
      "material": "metal",
      "health": 1.0,
      "firstTriangle": 133993,
      "triangles": 108,
      "sourceEntity": {
        "hammeruniqueid": "2:60417:4063",
        "model": "resource_name:\"models/props/de_mirage/wall_hole_cover_sheetmetal.vmdl\"",
        "origin": [
          -1336.0,
          -974.0,
          -132.0
        ],
        "angles": [
          0.0,
          270.0,
          0.0
        ],
        "@OnBreak": "Break [PR#]prop.breakable.01.brush"
      },
      "modelMetadataSha256": "7f08a28c38a1951ec83995e949b9f480c4a52dc52d46a53529330fd3ff2ba639"
    },
    {
      "id": "mirage-market-shutter",
      "nodeIndices": [
        3469
      ],
      "nodeNames": [
        "shutter_window_l_breakable.shutter_window_l_breakable_bg_body_lod0"
      ],
      "restoredNodeIndices": [
        3494
      ],
      "origin": {
        "x": -48.742599999999996,
        "y": -1.8288,
        "z": 6.854125814199999
      },
      "bounds": {
        "min": {
          "x": -48.751163482666016,
          "y": -3.2662343978881836,
          "z": 6.840456485748291
        },
        "max": {
          "x": -47.94697570800781,
          "y": -0.3937310576438904,
          "z": 7.027928829193115
        }
      },
      "material": "wood",
      "health": 1.0,
      "firstTriangle": 133837,
      "triangles": 12,
      "sourceEntity": {
        "hammeruniqueid": "2:60417:3716",
        "model": "resource_name:\"models/props/de_mirage/shutter_window_l_breakable.vmdl\"",
        "origin": [
          -1919.0,
          -269.847473,
          -72.0
        ],
        "angles": [
          0.0,
          348.500092,
          0.0
        ],
        "@OnBreak": "Enable [PR#]shutter.l.remainder"
      },
      "modelMetadataSha256": "bc201d31ad44446b18fb236971c528a3eb280ba22a399ea21bc796e87502fed3"
    }
  ]
};
