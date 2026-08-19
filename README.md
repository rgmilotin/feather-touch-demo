# Feather Touch -- functional demo

A surgeon-facing web platform for the Feather Touch implant technique (MBS Medcom,
Dr. Raul Chioibas), built around the reverse-engineered and live-validated sizing
logic from the original Polytech.Implants.exe desktop app.

## Running it

No `npm install` needed -- the server only uses Node's built-in modules.

```
cd MedcomFeatherTouchWebsite
node server.js
```

Then open **http://localhost:4173**.

## Sending this as a demo (zipping for a client)

The app reads three image/photo sets from a local `assets/` folder next to
`server.js`, so a zip of this entire project folder runs standalone on any machine --
no env vars, no external drives, just `node server.js`:

```
assets/
  polytech-images/       <- copy of Polytech\images (implant diagrams, help icons)
  biodynamic-photos/
    2007-10-30/           <- "before" demo photo set
    2008-03-31/            <- "after" demo photo set
  brand/
    1.svg, 2.svg            <- Feather Touch logo lockups
```

If `assets/` isn't present in your working copy yet (it's dev-machine-only content,
not checked in), populate it once from the source folders before zipping:

| Copy from | Copy to |
|---|---|
| `D:\Fastbit\AplicatieFeatherTouchImplanturi\Polytech\images\*` | `assets\polytech-images\` |
| `D:\...\BioDynamic\photo_db\Breast Augmentation\p0000004\2007-10-30\*` | `assets\biodynamic-photos\2007-10-30\` |
| `D:\...\BioDynamic\photo_db\Breast Augmentation\p0000004\2008-03-31\*` | `assets\biodynamic-photos\2008-03-31\` |
| `D:\...\Logo\FEATHER TOUCH\1.svg` and `2.svg` | `assets\brand\` |

Then, to hand a clean demo to a client:

1. Delete `data\db.json` (optional -- resets all demo data back to the seed set,
   wiping any patients/consultations/photos you added while testing).
2. Zip the whole `MedcomFeatherTouchWebsite` folder (it's zero-dependency, so there's
   no `node_modules` to exclude).
3. Send the zip. The client just needs Node.js installed, then `node server.js` +
   open `http://localhost:4173`.

For local development, `POLYTECH_IMAGES_DIR`, `BIODYNAMIC_PHOTOS_DIR`, and
`BRAND_ASSETS_DIR` env vars still override the `assets/` default, if you'd rather
keep iterating straight against the live source folders instead of the copies:

```
set POLYTECH_IMAGES_DIR=D:\new\path\to\Polytech\images
set BIODYNAMIC_PHOTOS_DIR=D:\new\path\to\BioDynamic\photo_db\Breast Augmentation\p0000004
set BRAND_ASSETS_DIR=D:\new\path\to\Logo\FEATHER TOUCH
node server.js
```

## Test credentials

| Username      | Password           | Notes                                   |
|---------------|--------------------|------------------------------------------|
| `demo`        | `demo1234`         | Has sample patients/consultations/appts  |
| `dr.chioibas` | `feathertouch2026` | Dr. Raul Chioibas, MBS Medcom            |
| `admin`       | `admin2026`        | Sees all clinics/doctors in Reports       |

## What's here

- **Sizing engine** (`lib/calc.js`): a 1:1 port of the validated desktop app logic
  (family derivation, width/height/projection/volume/D-values, and the sizer/trial-implant
  matching). Shared verbatim between the server and the browser -- there is exactly one
  copy of this logic.
- **Consultation wizard**: Patient &rarr; Measurements &rarr; Suggestions (all 6 implant
  families compared side by side, exactly like the desktop app's simultaneous family
  cards) &rarr; Selection, which shows the full A/C/B/D/Volume breakdown, the estimated
  Required Skin range, Vertical IMF Pos, and -- the key new feature -- **which physical
  trial/sizer implants are needed** to let the patient try the implant on during the
  consultation (ranked single or paired sizer combinations).
- **Patients**: dossiers with consultation history.
- **Appointments**: scheduling per doctor (new -- not part of the original desktop app).
- **Reports**: consultation/patient counts, average volume selected, top implant
  families, per-doctor activity.
- Data is stored in `data/db.json` (auto-created from `data/seed.json` on first run).
  Delete `data/db.json` to reset the demo back to the seed data.
- **Advisory risk warnings** (`lib/calc.js` `evaluateWarnings`): surfaced on the
  Suggestions and Selection steps whenever the current measurements/implant choice
  cross an advisory threshold -- thin soft tissue (rippling/wrinkling), thin
  parenchyma (edge visibility/palpability), an implant width pushed well above the
  anatomically-derived width, width large relative to chest width, or a desired
  Intermammary Distance narrow enough to risk symmastia. These are heuristic
  surgeon-facing guardrails, not a diagnostic system -- thresholds live in
  `WARNING_THRESHOLDS` and can be tuned without touching the evaluation logic.
- **Desired Intermammary Distance**: a slider on the Measurements step capturing the
  target postoperative distance between breasts, compared against measured
  parenchyma to flag symmastia risk.
- **Manual implant width override**: mirrors the desktop app's Implant Width slider
  (96-136mm). Present on the Measurements, Suggestions, and Selection steps -- leave
  it on auto to derive width from measurements, or drag to override; every
  recommended implant/sizer downstream recomputes live from whichever value is
  active.
- **Patient photo gallery + before/after PPTX export**: doctors can upload pre-op/
  post-op photos per patient (stored under `data/photos/<patientId>/`) from the
  patient detail page, and generate a 3-slide `.pptx` (poster / before photos /
  after photos) with a single click. The demo patient "Diana Marinescu" ships with
  a full before/after set from the BioDynamic archive to showcase this without
  needing real patient photos. The PPTX file is built by a small zero-dependency
  ZIP/OOXML writer in `lib/pptx.js` (no npm packages), keeping the project on plain
  Node.js hosting.

## Known limitation

`getNImf()` (drives the upper bound of the "Required Skin" figure) is flagged in the
code as provisional -- one live comparison against the desktop app was close but not
exact (9.14 computed vs 9.2 shown). Everything else (family selection, width, height,
projection, D-values, volume, and the sizer/trial-implant matching) was validated
against the live app across all 6 families and the full width range.

## Styling

Colors and fonts are isolated as CSS custom properties at the top of
`public/css/style.css` (`--color-*`, `--font-*`) and are now set to the official
Feather Touch brand package (terracotta/espresso palette, Playfair Display headings,
Inter body text) -- served from `/brand/*` (see `BRAND_ASSETS_DIR` above). Because the
palette lives in one `:root` block, further art-direction changes are still a one-block
edit. Interactive polish (hover states, entrance transitions on cards/buttons/nav) is
layered on top of the same component rules and respects `prefers-reduced-motion`.
