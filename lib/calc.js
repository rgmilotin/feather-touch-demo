/*
 * Feather Touch sizing / implant-selection engine.
 *
 * UMD module: works both as a CommonJS module (required by server.js) and as a plain
 * browser <script> (exposes window.FeatherCalc), so there is exactly one copy of this
 * logic for the whole app.
 *
 * TWO GENERATIONS OF LOGIC LIVE HERE
 * ----------------------------------
 * 1. The *geometry* helpers (getProj, getNImf, getSizer, autoWidth) are the original
 *    1:1 port of the reverse-engineered and live-validated Polytech.Implants.exe
 *    logic, kept intact because they were validated against the live desktop app.
 *
 * 2. The *implant selection* is new: instead of the desktop app's six hard-coded
 *    "4Two" families, suggestions are now resolved against the real POLYTECH 2026
 *    catalogue (lib/implants.js, 613 breast implant references). The old
 *    IMPLANTS_VOLUME / D_VALUES / FAMILY_NAMES lookup tables are gone -- every
 *    recommended implant is now an actual orderable catalogue reference.
 *
 * PER-SIDE MEASUREMENTS
 * ---------------------
 * Measurements that describe one breast (soft tissue medial / lateral / upper pole,
 * parenchyma, lower pole skin) are recorded separately for left and right, so a
 * patient with breast asymmetry gets two independent implant recommendations chosen
 * to even the final result out. Measurements that describe the chest wall or the
 * midline (chest width, current cleavage) stay single.
 *
 * NOT FULLY VALIDATED: getNImf() (drives the upper bound of "Required Skin"). One live
 * sample (w=112, AOH, default measurements) gave 9.14 vs 9.2 shown in the desktop app
 * -- close but not exact, so this single figure is exposed as an estimate in the UI.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./implants.js'));
  } else {
    root.FeatherCalc = factory(root.FeatherImplants);
  }
})(typeof self !== 'undefined' ? self : this, function (Implants) {
  'use strict';

  var SIDES = ['left', 'right'];
  var SIDE_LABELS = { left: 'Left', right: 'Right' };

  // Fields that exist once per breast. Each is stored as `<key>L` / `<key>R`.
  var PER_SIDE_FIELDS = ['stMed', 'stLat', 'stup', 'pp', 'cnimf', 'manualWidth'];

  var DEFAULT_MEAS = {
    // ---- Current measurements of the patient ----
    cw: '27',            // chest width (chest wall, single)
    dimd: '3',           // current cleavage / inter-mammary distance (midline, single)
    stMedL: '0.5', stMedR: '0.5',   // soft tissue, medial pole
    stLatL: '0.5', stLatR: '0.5',   // soft tissue, lateral pole
    stupL: '0.5', stupR: '0.5',     // soft tissue, upper pole
    ppL: '1.0', ppR: '1.0',         // parenchyma
    cnimfL: '4.5', cnimfR: '4.5',   // lower pole skin (nipple-to-IMF, stretched)

    // ---- Desired measurements of the patient ----
    bh: '9.5',                  // desired breast height
    upperpole: 0,               // 0 = Natural (anatomical), 1 = Full (round)
    size: 1,                    // 0 = Low, 1 = Medium, 2 = Large
    desiredImd: '3',            // desired postoperative intermammary distance
    shell: 'microtextured',     // microthane | microtextured | polysmoooth
    range: 'sublimeline',       // sublimeline | blite | diagongel
    manualWidthL: null, manualWidthR: null,
    dev: 0
  };

  // Desired Breast Increase -> which catalogue projection classes are offered.
  var SIZE_PROJECTIONS = {
    0: ['low', 'moderate'],       // Low
    1: ['moderate'],              // Medium
    2: ['high', 'extrahigh']      // Large
  };
  var SIZE_LABELS = { 0: 'Low', 1: 'Medium', 2: 'Large' };

  // Desired Upper Pole -> implant shape class.
  var UPPERPOLE_SHAPE = { 0: 'anatomical', 1: 'round' };

  function toNum(v, fallback) {
    var n = parseFloat(v);
    return isNaN(n) ? (fallback === undefined ? 0 : fallback) : n;
  }

  function toInt(v, fallback) {
    var n = parseInt(v, 10);
    return isNaN(n) ? (fallback === undefined ? 0 : fallback) : n;
  }

  function sideKey(field, side) { return field + (side === 'left' ? 'L' : 'R'); }
  function otherSide(side) { return side === 'left' ? 'right' : 'left'; }

  // ---------------------------------------------------------------------------------
  // Legacy record migration.
  //
  // Consultations saved before the measurements screen was split into Current/Desired
  // used a single `st` (soft tissue), a single `stup`/`pp`/`cnimf`, a 2-value
  // Desired Breast Increase and a numeric shell flag. Upgrade those in place so old
  // dossiers keep opening and still compute.
  // ---------------------------------------------------------------------------------
  function normaliseMeas(meas) {
    var m = {};
    var k;
    for (k in DEFAULT_MEAS) if (DEFAULT_MEAS.hasOwnProperty(k)) m[k] = DEFAULT_MEAS[k];
    if (!meas) return m;
    for (k in meas) if (meas.hasOwnProperty(k)) m[k] = meas[k];

    // A record written before the Current/Desired split has neither the per-side
    // soft-tissue fields nor an implant range. Only such records get migrated -- a
    // current record must pass through untouched (in particular its `size`, whose
    // numbering changed meaning between the two generations).
    var isLegacy = meas.stMedL === undefined && meas.range === undefined;
    if (!isLegacy) {
      if (!Implants.RANGE_LABELS[m.range]) m.range = DEFAULT_MEAS.range;
      if (!Implants.SURFACE_LABELS[m.shell]) m.shell = DEFAULT_MEAS.shell;
      return m;
    }

    // Old single-value soft tissue -> medial + lateral, both sides.
    if (meas.st !== undefined) {
      m.stMedL = m.stMedR = m.stLatL = m.stLatR = meas.st;
    }
    // Old single-value per-breast fields -> both sides.
    ['stup', 'pp', 'cnimf'].forEach(function (field) {
      if (meas[field] !== undefined) {
        m[sideKey(field, 'left')] = m[sideKey(field, 'right')] = meas[field];
      }
    });
    if (meas.manualWidth !== undefined) {
      m.manualWidthL = m.manualWidthR = meas.manualWidth;
    }
    // Old Desired Breast Increase was 0 = Medium, 1 = Large (there was no Low tier).
    m.size = toInt(meas.size, 0) === 1 ? 2 : 1;
    // Old shell flag: 0 = Textured, 1 = Micro.
    m.shell = toInt(meas.shell, 0) === 1 ? 'microthane' : 'microtextured';
    m.range = DEFAULT_MEAS.range;
    return m;
  }

  // ---------------------------------------------------------------------------------
  // Per-side measurement access
  // ---------------------------------------------------------------------------------

  // Effective soft-tissue figure for one breast. The original desktop formula took a
  // single "soft tissue" reading; medial and lateral are now measured separately, so
  // their mean stands in for it -- which reproduces the old behaviour exactly whenever
  // the two readings are equal, and reacts sensibly when they are not.
  function softTissue(meas, side) {
    return (toNum(meas[sideKey('stMed', side)]) + toNum(meas[sideKey('stLat', side)])) / 2;
  }

  function sideMeas(meas, side) {
    return {
      side: side,
      label: SIDE_LABELS[side],
      stMed: toNum(meas[sideKey('stMed', side)]),
      stLat: toNum(meas[sideKey('stLat', side)]),
      st: softTissue(meas, side),
      stup: toNum(meas[sideKey('stup', side)]),
      pp: toNum(meas[sideKey('pp', side)]),
      cnimf: toNum(meas[sideKey('cnimf', side)]),
      manualWidth: meas[sideKey('manualWidth', side)]
    };
  }

  // ---------------------------------------------------------------------------------
  // Widths
  // ---------------------------------------------------------------------------------

  // Hard anatomical cap: the breast footprint available on one side of the chest,
  // in mm. No implant wider than this may ever be recommended -- an implant wider
  // than the breast base overhangs onto the chest wall.
  function breastBaseWidth(meas) {
    var mm = ((toNum(meas.cw) - toNum(meas.dimd)) / 2) * 10;
    return mm > 0 ? mm : 0;
  }

  // Desired implant width from the chest measurements, per side. Same formula as the
  // original app's UpdateWidth(), with that side's own soft-tissue reading.
  function autoWidth(meas, side) {
    var w = Math.trunc(((toInt(meas.cw) - toInt(meas.dimd)) / 2.0 - softTissue(meas, side)) * 10) - 5;
    return w > 0 ? w : 0;
  }

  function clampWidth(w) {
    var n = toInt(w, Implants.WIDTH_MIN);
    if (n < Implants.WIDTH_MIN) n = Implants.WIDTH_MIN;
    if (n > Implants.WIDTH_MAX) n = Implants.WIDTH_MAX;
    return n;
  }

  // An explicit manual override (the "Implant Width" slider) takes precedence over the
  // auto-derived value, exactly like the desktop app's SetImplantWidth() overriding
  // UpdateWidth(). The anatomical cap still applies on top of either.
  function resolveWidth(meas, side) {
    var mw = meas[sideKey('manualWidth', side)];
    var w = clampWidth((mw !== undefined && mw !== null && mw !== '') ? mw : autoWidth(meas, side));
    var cap = breastBaseWidth(meas);
    if (cap > 0 && w > cap) w = Math.max(Implants.WIDTH_MIN, Math.floor(cap));
    return w;
  }

  function isManualWidth(meas, side) {
    var mw = meas[sideKey('manualWidth', side)];
    return mw !== undefined && mw !== null && mw !== '';
  }

  // ---------------------------------------------------------------------------------
  // Symmetry compensation
  //
  // When the two breasts differ, matching implants would preserve the difference. The
  // patient's own glandular volume on each side is estimated as parenchyma thickness
  // over the breast footprint (a cylinder approximation), and the side holding less of
  // its own tissue is offered proportionally more implant volume so the two sides
  // finish closer together.
  //
  // This is a planning heuristic to steer the ranking, not a measured volume.
  // ---------------------------------------------------------------------------------
  var MAX_SYMMETRY_COMPENSATION_ML = 150;

  function ownTissueVolume(meas, side) {
    var s = sideMeas(meas, side);
    var radiusCm = resolveWidth(meas, side) / 20; // width mm -> radius cm
    if (!(radiusCm > 0)) return 0;
    return Math.PI * radiusCm * radiusCm * s.pp;
  }

  function symmetryCompensation(meas, side) {
    var mine = ownTissueVolume(meas, side);
    var theirs = ownTissueVolume(meas, otherSide(side));
    var comp = theirs - mine;
    if (comp > MAX_SYMMETRY_COMPENSATION_ML) comp = MAX_SYMMETRY_COMPENSATION_ML;
    if (comp < -MAX_SYMMETRY_COMPENSATION_ML) comp = -MAX_SYMMETRY_COMPENSATION_ML;
    return comp;
  }

  // ---------------------------------------------------------------------------------
  // Catalogue filtering + ranking
  // ---------------------------------------------------------------------------------

  // Which catalogue subset the patient's *desired* preferences allow.
  function activeFilters(meas) {
    return {
      range: meas.range,
      surface: meas.shell,
      shapeClass: UPPERPOLE_SHAPE[toInt(meas.upperpole, 0)] || UPPERPOLE_SHAPE[0],
      projections: SIZE_PROJECTIONS[toInt(meas.size, 1)] || SIZE_PROJECTIONS[1]
    };
  }

  function filterCatalogue(meas) {
    var f = activeFilters(meas);
    return Implants.CATALOGUE.filter(function (i) {
      return i.range === f.range &&
        i.surface === f.surface &&
        i.shapeClass === f.shapeClass &&
        f.projections.indexOf(i.projection) !== -1;
    });
  }

  // Width dominates the ranking (it has to fit the anatomy); volume breaks ties, so
  // that 5 mm of width error weighs about the same as 40 ml of volume error.
  var WIDTH_TOLERANCE_MM = 5;
  var VOLUME_TOLERANCE_ML = 40;

  function suggestImplants(meas, side, limit) {
    meas = normaliseMeas(meas);
    var targetW = resolveWidth(meas, side);
    var cap = breastBaseWidth(meas);
    var filtered = filterCatalogue(meas);
    var pool = filtered.filter(function (i) { return !cap || i.w <= cap; });
    if (!pool.length) {
      // Distinguish "these desired choices match nothing at all" from "they match,
      // but every match is wider than this patient's breast base" -- the two need
      // completely different corrective action from the surgeon.
      return {
        side: side, targetWidth: targetW, targetVolume: null, maxWidth: Math.round(cap),
        results: [], totalMatches: 0, empty: true,
        emptyReason: filtered.length ? 'width' : 'filters',
        narrowestAvailable: filtered.length ? Math.min.apply(null, filtered.map(function (i) { return i.w; })) : null
      };
    }

    // Pass 1: closest width -> gives the baseline volume for this side.
    var byWidth = pool.slice().sort(function (a, b) {
      return Math.abs(a.w - targetW) - Math.abs(b.w - targetW) || a.v - b.v;
    });
    var baseVolume = byWidth[0].v;
    var compensation = symmetryCompensation(meas, side);

    // Keep the target inside what this filtered pool can actually supply. Left
    // unclamped, a large compensation can push the target past the smallest or
    // largest implant available, which biases the whole ranking towards that end
    // and reports a target volume no catalogue implant could ever hit.
    var vols = pool.map(function (i) { return i.v; });
    var vMin = Math.min.apply(null, vols);
    var vMax = Math.max.apply(null, vols);
    var targetV = Math.min(vMax, Math.max(vMin, baseVolume + compensation));

    // Pass 2: combined width + volume score.
    var ranked = pool.map(function (i) {
      var dw = Math.abs(i.w - targetW);
      var dv = Math.abs(i.v - targetV);
      return {
        implant: i,
        widthDiff: dw,
        volumeDiff: Math.round(dv),
        score: dw / WIDTH_TOLERANCE_MM + dv / VOLUME_TOLERANCE_ML
      };
    }).sort(function (a, b) { return a.score - b.score || a.widthDiff - b.widthDiff; });

    return {
      side: side,
      targetWidth: targetW,
      targetVolume: Math.round(targetV),
      baseVolume: baseVolume,
      // What the clamp actually allowed through, so the UI never advertises a
      // compensation the ranking did not really apply.
      compensation: Math.round(targetV - baseVolume),
      maxWidth: Math.round(cap),
      manual: isManualWidth(meas, side),
      autoWidth: autoWidth(meas, side),
      results: ranked.slice(0, limit || 6),
      totalMatches: ranked.length,
      empty: false
    };
  }

  function findImplant(ref) {
    for (var i = 0; i < Implants.CATALOGUE.length; i++) {
      if (Implants.CATALOGUE[i].ref === ref) return Implants.CATALOGUE[i];
    }
    return null;
  }

  // ---------------------------------------------------------------------------------
  // Geometry (unchanged, validated against the desktop app)
  // ---------------------------------------------------------------------------------
  // The clinic's physical trial/sizer set: nine sizers, S1..S9.
  var SIZER_VOLS = [50, 80, 120, 150, 200, 250, 315, 380, 430];

  function decodeSizer(n) { return 'S' + (n + 1); }

  // Ranked list of trial/sizer combinations closest to `volume` -- the "which model
  // implants are needed to try the implant on" feature.
  //
  // The clinic holds ONE of each sizer, so a combination may never reuse a size;
  // combinations are drawn from the distinct sizes only. Stacking up to three brings
  // the whole 105-920 ml catalogue within reach -- two sizers top out at 810 ml
  // (S8+S9), which would leave the largest implants badly matched.
  var MAX_SIZERS_STACKED = 3;

  function getSizer(volume) {
    var vols = SIZER_VOLS;
    var candidates = [];

    // Every combination of 1..MAX_SIZERS_STACKED distinct sizers.
    (function build(startIdx, chosen) {
      if (chosen.length) {
        var total = 0;
        chosen.forEach(function (i) { total += vols[i]; });
        // Highest size first reads more naturally on the fitting sheet.
        var pieces = chosen.slice().reverse().map(function (i) {
          return { code: decodeSizer(i), vol: vols[i] };
        });
        candidates.push({
          diff: Math.abs(total - volume),
          total: total,
          count: chosen.length,
          pieces: pieces,
          label: pieces.length === 1
            ? pieces[0].code + ' – ' + total + ' ml'
            : total + ' ml [' + pieces.map(function (p) { return p.code; }).join(' + ') + ']'
        });
      }
      if (chosen.length === MAX_SIZERS_STACKED) return;
      for (var i = startIdx; i < vols.length; i++) {
        build(i + 1, chosen.concat([i]));
      }
    })(0, []);

    // Closest volume wins; ties go to the combination using fewer physical sizers,
    // since stacking two trial implants is more work in theatre than placing one.
    candidates.sort(function (a, b) {
      return a.diff - b.diff || a.count - b.count || a.total - b.total;
    });
    return candidates.slice(0, 5);
  }

  // abs(cmath.sqrt(x)) for a real x equals sqrt(abs(x)) -- this lets us drop the
  // complex-number arithmetic used by the original Python and stay in real numbers.
  function safeSqrt(x) { return Math.sqrt(Math.abs(x)); }

  function getNImf(iw, ih, ip, shape, pp, dev) {
    var proj_nipple_level;
    if (shape) {
      proj_nipple_level = (ip * (ih - iw / 2 - dev)) / (ih - iw / 4) + pp * 0.75;
    } else {
      proj_nipple_level = ip + pp * 0.5;
    }
    var ip_pp = ip + 0.5 * pp;
    var top = iw / 4 + dev;
    var top_bit = safeSqrt(Math.pow(top, 2) + Math.pow(Math.abs(ip_pp - proj_nipple_level), 2));
    var b = iw / 4;
    var a = ip + pp * 0.5;
    var bottom_bit = (Math.PI * (3 * (a + b) - safeSqrt((3 * a + b) * (a + 3 * b)))) / 4;
    return Math.abs(top_bit + bottom_bit) / 10.0;
  }

  // ---------------------------------------------------------------------------------
  // Reference diagram for a catalogue implant.
  //
  // The shipped POLYTECH renders cover shape x projection x shell, which is exactly
  // what distinguishes one catalogue entry from another visually, so each implant maps
  // onto the closest matching render rather than needing 613 separate images.
  // ---------------------------------------------------------------------------------
  function implantImage(implant) {
    if (!implant) return '/polytech-images/thorax.png';
    var shellPrefix = implant.surface === 'microthane' ? 'M' : 'T';
    var high = implant.projection === 'high' || implant.projection === 'extrahigh';
    var body;
    if (implant.shapeClass === 'round') {
      body = high ? 'RRH' : 'RRM';
    } else if (implant.shape === 'replicon') {
      body = implant.projection === 'extrahigh' ? 'ARX' : 'ARH';
    } else {
      body = implant.projection === 'extrahigh' ? 'AOX' : 'AOH';
    }
    return '/polytech-images/' + shellPrefix + body + '.png';
  }

  // ---------------------------------------------------------------------------------
  // Full result for one chosen implant on one side
  // ---------------------------------------------------------------------------------
  function computeForImplant(meas, side, implantOrRef) {
    meas = normaliseMeas(meas);
    var implant = typeof implantOrRef === 'string' ? findImplant(implantOrRef) : implantOrRef;
    if (!implant) return null;
    var s = sideMeas(meas, side);
    var dev = toNum(meas.dev, 0) * 10;
    var st10 = s.st * 10;
    // NOTE: the original app calls this with `self.family is not 'R'`, a Python
    // identity check against a 1-char string that is always true for a 3-char family
    // code -- i.e. the "shape" flag is always true in the shipped app. Reproduced here
    // for fidelity, not because it's the "correct" behaviour.
    var nimf = getNImf(implant.w, implant.h, implant.p, true, st10, dev);
    var sizerOptions = getSizer(implant.v);

    return {
      side: side,
      sideLabel: SIDE_LABELS[side],
      implant: implant,
      image: implantImage(implant),
      width: implant.w,
      vpos: ((implant.w / 2 + dev) / 10.0).toFixed(1),
      requiredSkin: {
        lower: s.cnimf,
        upper: Number(nimf.toFixed(1)),
        upperEstimated: true
      },
      sizerOptions: sizerOptions,
      topSizer: sizerOptions[0]
    };
  }

  // Both sides at once: the ranked suggestion set per side, plus the resolved result
  // for whichever implant is currently selected on each side.
  function computeConsultation(meas, selection) {
    meas = normaliseMeas(meas);
    selection = selection || {};
    var out = { meas: meas, filters: activeFilters(meas), sides: {} };
    SIDES.forEach(function (side) {
      var suggestions = suggestImplants(meas, side);
      var chosenRef = selection[side];
      var chosen = chosenRef ? findImplant(chosenRef) : (suggestions.results[0] && suggestions.results[0].implant);
      out.sides[side] = {
        suggestions: suggestions,
        selectedRef: chosen ? chosen.ref : null,
        result: chosen ? computeForImplant(meas, side, chosen) : null
      };
    });
    var l = out.sides.left.result, r = out.sides.right.result;
    out.symmetry = (l && r) ? {
      volumeDiff: Math.abs(l.implant.v - r.implant.v),
      widthDiff: Math.abs(l.implant.w - r.implant.w),
      matched: l.implant.v === r.implant.v && l.implant.w === r.implant.w
    } : null;
    return out;
  }

  // ---------------------------------------------------------------------------------
  // Advisory risk warnings.
  //
  // Heuristic, surgeon-facing guardrails built on well-established aesthetic breast
  // surgery principles (soft-tissue coverage / "pinch test", base-width matching,
  // medial pocket control), NOT a diagnostic system and NOT a substitute for clinical
  // judgment. Thresholds are grouped as tunable constants so they can be adjusted
  // without touching the evaluation logic.
  // ---------------------------------------------------------------------------------
  var WARNING_THRESHOLDS = {
    thinSoftTissueCm: 0.5,
    thinParenchymaCm: 0.8,
    widthOverAutoModerateMm: 4,
    widthOverAutoHighMm: 8,
    chestWidthFraction: 0.62,
    imdSymmastiaHighRiskCm: 1.5,
    imdSymmastiaModerateRiskCm: 2.0,
    asymmetryVolumeMl: 60,
    asymmetryTissueCm: 0.4
  };

  // `risk` names the before/after illustration the UI shows alongside the banner, so
  // the surgeon (and the patient across the desk) can see the outcome being warned
  // about rather than only reading about it. Warnings without a named risk render as
  // text only.
  function warning(id, severity, title, message, risk) {
    return { id: id, severity: severity, title: title, message: message, risk: risk || null };
  }

  // evaluateWarnings(meas, side, implant) -> [{ id, severity: 'warning'|'danger', title, message }]
  function evaluateWarnings(meas, side, implant) {
    meas = normaliseMeas(meas);
    var out = [];
    if (!implant) return out;

    var T = WARNING_THRESHOLDS;
    var s = sideMeas(meas, side);
    var label = SIDE_LABELS[side];
    var w = implant.w;
    var cw = toNum(meas.cw);
    var auto = autoWidth(meas, side);
    var cap = breastBaseWidth(meas);

    if (s.st > 0 && s.st < T.thinSoftTissueCm) {
      out.push(warning('thin_soft_tissue_' + side, 'danger', label + ' -- Rippling / Wrinkling risk',
        'Mean soft tissue over the ' + label.toLowerCase() + ' breast (' + s.st.toFixed(2) + ' cm, from ' +
        s.stMed.toFixed(1) + ' cm medial and ' + s.stLat.toFixed(1) + ' cm lateral) is below the ' +
        T.thinSoftTissueCm.toFixed(1) + ' cm advisory threshold. Thin coverage over a ' + w +
        ' mm implant increases the risk of visible or palpable rippling and wrinkling.', 'rippling'));
    }

    if (s.pp > 0 && s.pp < T.thinParenchymaCm) {
      out.push(warning('thin_parenchyma_' + side, 'warning', label + ' -- Implant Edge Visibility / Palpability risk',
        'Parenchyma on the ' + label.toLowerCase() + ' side (' + s.pp.toFixed(1) + ' cm) is below the ' +
        T.thinParenchymaCm.toFixed(1) + ' cm advisory threshold. Limited glandular coverage raises the risk ' +
        'of a visible or palpable implant border, especially along the upper pole and cleavage line.'));
    }

    var deltaW = w - auto;
    if (deltaW >= T.widthOverAutoHighMm) {
      out.push(warning('width_over_auto_high_' + side, 'danger', label + ' -- Oversized implant width',
        'Selected width (' + w + ' mm) is ' + deltaW + ' mm above the anatomically-derived width (' + auto +
        ' mm) for this side. This is a substantial increase and raises the risk of excess parenchyma stretch, ' +
        'visible/palpable edges, and rippling from inadequate soft tissue coverage.', 'oversized-width'));
    } else if (deltaW >= T.widthOverAutoModerateMm) {
      out.push(warning('width_over_auto_moderate_' + side, 'warning', label + ' -- Implant width above recommendation',
        'Selected width (' + w + ' mm) is ' + deltaW + ' mm above the anatomically-derived width (' + auto +
        ' mm). Confirm available soft tissue coverage supports this before proceeding.', 'oversized-width'));
    }

    if (cap > 0 && w > cap) {
      out.push(warning('width_over_base_' + side, 'danger', label + ' -- Implant wider than the breast base',
        'Selected width (' + w + ' mm) exceeds the available breast base width on this side (' +
        Math.round(cap) + ' mm, derived from chest width minus cleavage). An implant wider than its footprint ' +
        'overhangs the chest wall.', 'oversized-width'));
    }

    if (cw > 0 && w > cw * 10 * T.chestWidthFraction) {
      out.push(warning('width_vs_chest_' + side, 'warning', label + ' -- Implant width large relative to chest width',
        'Implant width (' + w + ' mm) exceeds ' + Math.round(T.chestWidthFraction * 100) + '% of chest width (' +
        cw + ' cm). Oversized base width relative to the chest wall is associated with excess parenchyma ' +
        'stretch and long-term rippling/wrinkling risk.'));
    }

    if (meas.desiredImd !== undefined && meas.desiredImd !== null && meas.desiredImd !== '') {
      var imd = toNum(meas.desiredImd);
      if (imd < T.imdSymmastiaHighRiskCm && s.pp < T.thinParenchymaCm) {
        out.push(warning('symmastia_high_' + side, 'danger', label + ' -- Symmastia risk',
          'Desired Intermammary Distance (' + imd.toFixed(1) + ' cm) is very narrow and parenchyma on this side (' +
          s.pp.toFixed(1) + ' cm) is thin. Insufficient medial soft tissue support at this IMD may allow the ' +
          'breast pockets to communicate across the midline (symmastia / "breadloafing").', 'symmastia'));
      } else if (imd < T.imdSymmastiaModerateRiskCm) {
        out.push(warning('symmastia_moderate_' + side, 'warning', label + ' -- Symmastia risk',
          'Desired Intermammary Distance (' + imd.toFixed(1) + ' cm) is below the ' +
          T.imdSymmastiaModerateRiskCm.toFixed(1) + ' cm advisory threshold. Evaluate medial pocket control ' +
          'carefully to avoid symmastia.', 'symmastia'));
      }
    }

    return out;
  }

  // Warnings about the two sides considered together, rather than either on its own.
  function evaluateSymmetryWarnings(meas, leftImplant, rightImplant) {
    meas = normaliseMeas(meas);
    var T = WARNING_THRESHOLDS;
    var out = [];
    var l = sideMeas(meas, 'left'), r = sideMeas(meas, 'right');

    var tissueDiff = Math.max(Math.abs(l.pp - r.pp), Math.abs(l.st - r.st));
    if (tissueDiff >= T.asymmetryTissueCm) {
      out.push(warning('tissue_asymmetry', 'warning', 'Breast asymmetry detected',
        'The two sides differ by up to ' + tissueDiff.toFixed(1) + ' cm in soft tissue / parenchyma ' +
        '(left ' + l.pp.toFixed(1) + ' cm vs right ' + r.pp.toFixed(1) + ' cm parenchyma). Suggestions below are ' +
        'ranked independently per side, with extra volume offered to the side holding less of its own tissue, ' +
        'so the final result evens out.'));
    }

    if (leftImplant && rightImplant) {
      var volDiff = Math.abs(leftImplant.v - rightImplant.v);
      if (volDiff >= T.asymmetryVolumeMl) {
        out.push(warning('implant_volume_gap', 'warning', 'Large volume difference between sides',
          'The two selected implants differ by ' + volDiff + ' ml (left ' + leftImplant.v + ' ml, right ' +
          rightImplant.v + ' ml). Confirm this gap is intended to correct measured asymmetry rather than an ' +
          'artefact of the selection.'));
      }
    }
    return out;
  }

  return {
    // constants / metadata
    SIDES: SIDES,
    SIDE_LABELS: SIDE_LABELS,
    PER_SIDE_FIELDS: PER_SIDE_FIELDS,
    DEFAULT_MEAS: DEFAULT_MEAS,
    SIZE_PROJECTIONS: SIZE_PROJECTIONS,
    SIZE_LABELS: SIZE_LABELS,
    UPPERPOLE_SHAPE: UPPERPOLE_SHAPE,
    SIZER_VOLS: SIZER_VOLS,
    WARNING_THRESHOLDS: WARNING_THRESHOLDS,
    Implants: Implants,

    // measurements
    normaliseMeas: normaliseMeas,
    sideMeas: sideMeas,
    sideKey: sideKey,
    otherSide: otherSide,
    softTissue: softTissue,

    // widths
    breastBaseWidth: breastBaseWidth,
    autoWidth: autoWidth,
    clampWidth: clampWidth,
    resolveWidth: resolveWidth,
    isManualWidth: isManualWidth,

    // selection
    activeFilters: activeFilters,
    filterCatalogue: filterCatalogue,
    suggestImplants: suggestImplants,
    findImplant: findImplant,
    ownTissueVolume: ownTissueVolume,
    symmetryCompensation: symmetryCompensation,
    implantImage: implantImage,

    // results
    computeForImplant: computeForImplant,
    computeConsultation: computeConsultation,

    // geometry
    decodeSizer: decodeSizer,
    getSizer: getSizer,
    getNImf: getNImf,

    // warnings
    evaluateWarnings: evaluateWarnings,
    evaluateSymmetryWarnings: evaluateSymmetryWarnings
  };
});
