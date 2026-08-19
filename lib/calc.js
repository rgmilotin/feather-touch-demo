/*
 * Feather Touch sizing/volume calculation engine.
 *
 * Ported 1:1 from the reverse-engineered and live-validated Polytech.Implants.exe
 * logic (see Polytech/extract_out/model_fixed.py for the original Python source and
 * validation notes). This file is a UMD module: it works both as a CommonJS module
 * (required by server.js) and as a plain browser <script> (exposes window.FeatherCalc),
 * so there is exactly one copy of this logic for the whole app.
 *
 * Validated against the live desktop app across all 6 implant families and the full
 * 96-136mm width range: get_proj, get_sizer, vpos, and the A/C/B/D/Volume/Sizer fields
 * all match exactly.
 *
 * NOT FULLY VALIDATED: getNImf() (drives the upper bound of "Required Skin"). One live
 * sample (w=112, AOH, default measurements) gave 9.14 vs 9.2 shown in the app -- close
 * but not exact, so this single figure is exposed as an estimate in the UI.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FeatherCalc = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Volume (ml) per family, indexed by (w - 96) / 4, w = 96..136 step 4.
  // Read directly off the live app (uncompyle6's decompiled values were corrupted).
  var IMPLANTS_VOLUME = {
    RRM: [120, 145, 170, 190, 230, 260, 290, 330, 355, 400, 440],
    RRH: [160, 180, 200, 225, 255, 285, 325, 360, 410, 460, 510],
    ARH: [155, 180, 195, 225, 255, 285, 315, 345, 375, 450, 495],
    ARX: [190, 215, 240, 270, 305, 335, 365, 390, 420, 510, 560],
    AOH: [145, 165, 180, 205, 235, 260, 290, 320, 350, 415, 460],
    AOX: [175, 195, 215, 245, 285, 305, 335, 365, 395, 470, 515]
  };

  // D:ILPC values per family, same indexing. AOH reuses ARH's row and AOX reuses
  // ARX's row -- D depends only on the first+last family letters, not the R/O middle.
  var D_VALUES = {
    RRM: [58, 61, 64, 67, 71, 74, 77, 79, 82, 85, 88],
    RRH: [62, 65, 68, 71, 74, 77, 80, 83, 87, 90, 93],
    ARH: [72, 75, 79, 82, 85, 89, 93, 96, 99, 103, 106],
    ARX: [79, 82, 86, 89, 93, 96, 100, 103, 107, 110, 114],
    AOH: [72, 75, 79, 82, 85, 89, 93, 96, 99, 103, 106],
    AOX: [79, 82, 86, 89, 93, 96, 100, 103, 107, 110, 114]
  };

  var FAMILY_NAMES = {
    RRM: '4Two RR MP',
    RRH: '4Two RR HP',
    ARH: '4Two AR HP',
    ARX: '4Two AR XP',
    AOH: '4Two AO HP',
    AOX: '4Two AO XP'
  };

  var FAMILY_LABELS = {
    RRM: 'Round / Moderate Projection',
    RRH: 'Round / High Projection',
    ARH: 'Anatomic Round / High Projection',
    ARX: 'Anatomic Round / Extra Projection',
    AOH: 'Anatomic Oval / High Projection',
    AOX: 'Anatomic Oval / Extra Projection'
  };

  var SIZER_VOLS = [90, 120, 150, 185, 250, 290, 330];

  function decodeSizer(n) {
    return n < 4 ? ('S' + (n + 1) + 'T') : ('S' + (n + 1) + 'M');
  }

  // Ranked list of trial/sizer implants (single or paired) closest to `volume`.
  // Returns the 5 best matches, best first -- this is the "which model implants are
  // needed to try the implant on at the consultation" feature.
  function getSizer(volume) {
    var vols = SIZER_VOLS;
    var candidates = [];
    var i, j;
    for (i = 0; i < vols.length; i++) {
      var v = vols[i];
      candidates.push({
        diff: Math.abs(v - volume),
        label: decodeSizer(i) + ' - ' + v + 'ml',
        pieces: [{ code: decodeSizer(i), vol: v }],
        total: v
      });
    }
    for (i = 0; i < vols.length; i++) {
      for (j = i + 1; j < vols.length; j++) {
        var v1 = vols[i], v2 = vols[j];
        candidates.push({
          diff: Math.abs(v1 + v2 - volume),
          label: (v1 + v2) + 'ml [' + decodeSizer(j) + ' + ' + decodeSizer(i) + ']',
          pieces: [{ code: decodeSizer(j), vol: v2 }, { code: decodeSizer(i), vol: v1 }],
          total: v1 + v2
        });
      }
    }
    candidates.sort(function (a, b) { return a.diff - b.diff; });
    return candidates.slice(0, 5);
  }

  function getProj(w) {
    var adjs = [20, 14, 12, 4];
    return adjs.map(function (adj) { return w / 2 - adj; });
  }

  // abs(cmath.sqrt(x)) for a real x equals sqrt(abs(x)) -- this lets us drop the
  // complex-number arithmetic used by the original Python and stay in real numbers.
  function safeSqrt(x) {
    return Math.sqrt(Math.abs(x));
  }

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

  function toNum(v, fallback) {
    var n = parseFloat(v);
    return isNaN(n) ? (fallback || 0) : n;
  }

  function toInt(v, fallback) {
    var n = parseInt(v, 10);
    return isNaN(n) ? (fallback || 0) : n;
  }

  // Desired implant width from chest measurements (cw, dimd, st). pp is accepted for
  // parity with the original app's trigger list but does not affect the formula.
  function updateWidth(meas) {
    var desired_w = Math.trunc(((toInt(meas.cw) - toInt(meas.dimd)) / 2.0 - toNum(meas.st)) * 10) - 5;
    var best = null;
    for (var x = 0; x <= 10; x++) {
      var w = 96 + x * 4;
      var diff = Math.abs(w - 0.01 - desired_w);
      if (best === null || diff < best.diff) best = { w: w, diff: diff };
    }
    return best.w;
  }

  // Snap an arbitrary width to the nearest valid 96-136mm/4mm step -- this is the same
  // grid the original desktop app's manual "Implant Width" slider moves on (96, 100,
  // 104 ... 136), matching the IMPLANTS_VOLUME/D_VALUES table indexing.
  function clampWidth(w) {
    w = toInt(w, 96);
    var stepped = Math.round((w - 96) / 4) * 4 + 96;
    if (stepped < 96) stepped = 96;
    if (stepped > 136) stepped = 136;
    return stepped;
  }

  // Resolve the width to use for a computation: an explicit manual override
  // (meas.manualWidth, from the "Implant Width" slider) takes precedence over the
  // auto-derived value from chest measurements, exactly like the desktop app's
  // SetImplantWidth() overriding UpdateWidth(). Left unset/blank, behaviour is
  // unchanged from before this override existed.
  function resolveWidth(meas) {
    if (meas.manualWidth !== undefined && meas.manualWidth !== null && meas.manualWidth !== '') {
      return clampWidth(meas.manualWidth);
    }
    return updateWidth(meas);
  }

  // Round vs Oval decision for anatomic families, from desired breast height vs width.
  function getAnatoHeight(meas, w) {
    var desired_h = Math.trunc((toNum(meas.bh) - toNum(meas.stup)) * 10);
    var round = Math.abs(desired_h - w);
    var anato = Math.abs(desired_h - (w - 10));
    return round < anato ? 'R' : 'O';
  }

  // Full family derivation, equivalent to the desktop app's UpdateHeight()+UpdateProj()
  // state machine converged to a single pass (see model_fixed.py comments / session
  // notes for the derivation showing this convergence is order-independent).
  function deriveFamily(meas, w) {
    var isRound = !!(meas.upperpole && Number(meas.upperpole) !== 0);
    var sizeIdx = toInt(meas.size, 0) === 1 ? 1 : 0;
    if (isRound) {
      return 'RR' + (sizeIdx === 0 ? 'M' : 'H');
    }
    var ro = getAnatoHeight(meas, w);
    return 'A' + ro + (sizeIdx === 0 ? 'H' : 'X');
  }

  function pad3(n) {
    var s = String(Math.round(n));
    while (s.length < 3) s = '0' + s;
    return s;
  }

  function buildImplant(family, w, shell) {
    var family_name = FAMILY_NAMES[family] + '/' + (shell === 1 ? 'M' : 'T');
    var h = family.indexOf('O') !== -1 ? w - 10 : w;
    var projIdx = ['RM', 'RH', 'AH', 'AX'].indexOf(family[0] + family[family.length - 1]);
    var p = getProj(w)[projIdx];
    var idx = (w - 96) / 4;
    var v = IMPLANTS_VOLUME[family][idx];
    var d = D_VALUES[family][idx];
    return {
      family_name: family_name,
      w: w, h: h, p: p, d: d, v: v,
      label: family_name + ' | A:' + w + ', C:' + h + ', B:' + p + ', D:' + d + ', ' + pad3(v) + 'ml'
    };
  }

  // Main entry point: given the measurement form values, compute everything the
  // consultation wizard / results screen needs.
  function computeSizing(meas) {
    meas = meas || {};
    var w = resolveWidth(meas);
    var family = deriveFamily(meas, w);
    var shell = toInt(meas.shell, 0) === 1 ? 1 : 0;

    var implant = buildImplant(family, w, shell);
    var implant2 = null;
    if (w > 96) {
      implant2 = buildImplant(family, w - 4, shell);
    }

    var dev = toNum(meas.dev, 0) * 10;
    var st10 = toNum(meas.st) * 10;
    // NOTE: the original app calls this with `self.family is not 'R'`, a Python
    // identity check against a 1-char string that is always true for a 3-char family
    // code -- i.e. the "shape" flag is always true in the shipped app. Reproduced here
    // for fidelity, not because it's the "correct" behaviour.
    var new_nimf = getNImf(implant.w, implant.h, implant.p, true, st10, dev);
    var vpos = ((implant.w / 2 + dev) / 10.0).toFixed(1);

    var sizerOptions = getSizer(implant.v);

    return {
      family: family,
      familyLabel: FAMILY_LABELS[family],
      width: w,
      implant: implant,
      implant2: implant2,
      vpos: vpos,
      requiredSkin: {
        lower: toNum(meas.cnimf),
        upper: Number(new_nimf.toFixed(1)),
        upperEstimated: true
      },
      sizerOptions: sizerOptions,
      topSizer: sizerOptions[0]
    };
  }

  // The desktop app always shows all 6 implant family "cards" side by side (they all
  // share the same derived width) and lets the surgeon compare/override the
  // recommended one. This computes that full gallery in one call.
  function computeAllFamilies(meas) {
    meas = meas || {};
    var w = resolveWidth(meas);
    var recommended = deriveFamily(meas, w);
    var shell = toInt(meas.shell, 0) === 1 ? 1 : 0;
    var families = {};
    Object.keys(FAMILY_NAMES).forEach(function (fam) {
      families[fam] = buildImplant(fam, w, shell);
    });
    return { width: w, recommendedFamily: recommended, families: families };
  }

  // Sizing/results for one explicitly chosen family (used once the surgeon/patient
  // picks a card from the gallery instead of just taking the recommended one).
  function computeForFamily(meas, family) {
    meas = meas || {};
    var w = resolveWidth(meas);
    var shell = toInt(meas.shell, 0) === 1 ? 1 : 0;
    var implant = buildImplant(family, w, shell);
    var implant2 = w > 96 ? buildImplant(family, w - 4, shell) : null;

    var dev = toNum(meas.dev, 0) * 10;
    var st10 = toNum(meas.st) * 10;
    var new_nimf = getNImf(implant.w, implant.h, implant.p, true, st10, dev);
    var vpos = ((implant.w / 2 + dev) / 10.0).toFixed(1);
    var sizerOptions = getSizer(implant.v);

    return {
      family: family,
      familyLabel: FAMILY_LABELS[family],
      width: w,
      implant: implant,
      implant2: implant2,
      vpos: vpos,
      requiredSkin: {
        lower: toNum(meas.cnimf),
        upper: Number(new_nimf.toFixed(1)),
        upperEstimated: true
      },
      sizerOptions: sizerOptions,
      topSizer: sizerOptions[0]
    };
  }

  // Main entry point: given the measurement form values, compute everything the
  // consultation wizard / results screen needs for the *recommended* family.
  function computeSizing(meas) {
    meas = meas || {};
    var w = resolveWidth(meas);
    var family = deriveFamily(meas, w);
    return computeForFamily(meas, family);
  }

  // ---------------------------------------------------------------------------------
  // Advisory risk warnings.
  //
  // These are heuristic, surgeon-facing guardrails built on well-established aesthetic
  // breast surgery principles (soft-tissue coverage / "pinch test", base-width
  // matching, medial pocket control), NOT a diagnostic system and NOT a substitute for
  // clinical judgment. Thresholds are grouped as tunable constants below so Dr.
  // Chioibas/MBS Medcom can adjust them without touching the evaluation logic.
  // ---------------------------------------------------------------------------------
  var WARNING_THRESHOLDS = {
    thinSoftTissueCm: 0.5,      // lower-pole soft tissue below this -> rippling/wrinkling risk
    thinParenchymaCm: 0.8,      // parenchyma below this -> edge visibility/palpability risk
    widthOverAutoModerateMm: 4, // manual width above the anatomically-derived width
    widthOverAutoHighMm: 8,
    chestWidthFraction: 0.62,   // implant width as a fraction of chest width, upper comfort bound
    imdSymmastiaHighRiskCm: 1.5,
    imdSymmastiaModerateRiskCm: 2.0
  };

  function warning(id, severity, title, message) {
    return { id: id, severity: severity, title: title, message: message };
  }

  // evaluateWarnings(meas, result) -> array of { id, severity: 'warning'|'danger', title, message }
  // `result` is the output of computeForFamily/computeSizing for the implant currently
  // under consideration (uses result.implant.w/v and result.width).
  function evaluateWarnings(meas, result) {
    meas = meas || {};
    var out = [];
    if (!result || !result.implant) return out;

    var T = WARNING_THRESHOLDS;
    var w = result.implant.w;
    var st = toNum(meas.st);
    var pp = toNum(meas.pp);
    var cw = toNum(meas.cw);
    var autoW = updateWidth(meas);

    // Soft-tissue coverage over the implant (lower pole) -- thin coverage is the
    // classic driver of visible/palpable rippling and wrinkling, especially with
    // textured shells or larger volumes.
    if (st > 0 && st < T.thinSoftTissueCm) {
      out.push(warning('thin_soft_tissue', 'danger', 'Rippling / Wrinkling risk',
        'Soft tissue thickness (' + st.toFixed(1) + ' cm) is below the ' + T.thinSoftTissueCm.toFixed(1) +
        ' cm advisory threshold for the lower pole. Thin coverage over a ' + w + 'mm implant increases the ' +
        'risk of visible or palpable rippling and wrinkling, particularly with textured shells.'));
    }

    // Parenchyma (glandular coverage) thinness -- drives implant edge visibility /
    // palpability independent of the lower-pole soft tissue figure above.
    if (pp > 0 && pp < T.thinParenchymaCm) {
      out.push(warning('thin_parenchyma', 'warning', 'Implant Edge Visibility / Palpability risk',
        'Parenchyma (' + pp.toFixed(1) + ' cm) is below the ' + T.thinParenchymaCm.toFixed(1) +
        ' cm advisory threshold. Limited glandular coverage over the implant edge raises the risk of a ' +
        'visible or palpable implant border, especially along the upper pole and cleavage line.'));
    }

    // Manually widened implant vs. the anatomically-derived width -- the further the
    // surgeon pushes the slider above the auto-derived value, the less the available
    // soft tissue was sized for.
    var deltaW = w - autoW;
    if (deltaW >= T.widthOverAutoHighMm) {
      out.push(warning('width_over_auto_high', 'danger', 'Oversized implant width',
        'Selected width (' + w + 'mm) is ' + deltaW + 'mm above the anatomically-derived width (' + autoW +
        'mm) for these measurements. This is a substantial manual increase and raises the risk of excess ' +
        'parenchyma stretch, visible/palpable edges, and rippling from inadequate soft tissue coverage.'));
    } else if (deltaW >= T.widthOverAutoModerateMm) {
      out.push(warning('width_over_auto_moderate', 'warning', 'Implant width above recommendation',
        'Selected width (' + w + 'mm) is ' + deltaW + 'mm above the anatomically-derived width (' + autoW +
        'mm). Confirm available soft tissue coverage supports this before proceeding.'));
    }

    // Implant width vs. raw chest width -- a coarse base-width sanity check.
    if (cw > 0 && w > cw * 10 * T.chestWidthFraction) {
      out.push(warning('width_vs_chest', 'warning', 'Implant width large relative to chest width',
        'Implant width (' + w + 'mm) exceeds ' + Math.round(T.chestWidthFraction * 100) + '% of chest width (' +
        cw + ' cm). Oversized base width relative to the chest wall is associated with excess parenchyma ' +
        'stretch and long-term rippling/wrinkling risk.'));
    }

    // Symmastia: desired postoperative Intermammary Distance (IMD) too narrow given
    // the available medial soft tissue (parenchyma) to hold the pockets apart.
    if (meas.desiredImd !== undefined && meas.desiredImd !== null && meas.desiredImd !== '') {
      var imd = toNum(meas.desiredImd);
      if (imd < T.imdSymmastiaHighRiskCm && pp < T.thinParenchymaCm) {
        out.push(warning('symmastia_high', 'danger', 'Symmastia risk',
          'Desired Intermammary Distance (' + imd.toFixed(1) + ' cm) is very narrow and parenchyma (' +
          pp.toFixed(1) + ' cm) is thin. Insufficient medial soft tissue support at this IMD may allow the ' +
          'breast pockets to communicate across the midline (symmastia / "breadloafing").'));
      } else if (imd < T.imdSymmastiaModerateRiskCm) {
        out.push(warning('symmastia_moderate', 'warning', 'Symmastia risk',
          'Desired Intermammary Distance (' + imd.toFixed(1) + ' cm) is below the ' +
          T.imdSymmastiaModerateRiskCm.toFixed(1) + ' cm advisory threshold. Evaluate medial pocket control ' +
          'carefully to avoid symmastia.'));
      }
    }

    return out;
  }

  return {
    IMPLANTS_VOLUME: IMPLANTS_VOLUME,
    D_VALUES: D_VALUES,
    FAMILY_NAMES: FAMILY_NAMES,
    FAMILY_LABELS: FAMILY_LABELS,
    SIZER_VOLS: SIZER_VOLS,
    decodeSizer: decodeSizer,
    getSizer: getSizer,
    getProj: getProj,
    getNImf: getNImf,
    updateWidth: updateWidth,
    clampWidth: clampWidth,
    resolveWidth: resolveWidth,
    getAnatoHeight: getAnatoHeight,
    deriveFamily: deriveFamily,
    buildImplant: buildImplant,
    computeSizing: computeSizing,
    computeAllFamilies: computeAllFamilies,
    computeForFamily: computeForFamily,
    evaluateWarnings: evaluateWarnings,
    WARNING_THRESHOLDS: WARNING_THRESHOLDS
  };
});
