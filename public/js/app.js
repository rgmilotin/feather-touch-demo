/* Feather Touch -- SPA client. Vanilla JS, hash-based routing, no build step. */
(function () {
  'use strict';

  var state = { user: null, patients: [], wizard: null };

  // ---------------- utils ----------------
  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtDate(iso) { if (!iso) return ''; var d = new Date(iso); return isNaN(d) ? iso : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
  function age(dob) { if (!dob) return ''; var d = new Date(dob); if (isNaN(d)) return ''; var diff = Date.now() - d.getTime(); return Math.floor(diff / (365.25 * 24 * 3600 * 1000)); }

  function api(path, opts) {
    opts = opts || {};
    var fetchOpts = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
    if (opts.body !== undefined) {
      fetchOpts.headers['Content-Type'] = 'application/json';
      fetchOpts.body = JSON.stringify(opts.body);
    }
    return fetch(path, fetchOpts).then(function (r) {
      if (r.status === 401) { window.location.href = '/index.html'; throw new Error('Not authenticated'); }
      return r.json().then(function (json) {
        if (!r.ok) throw new Error(json.error || 'Request failed');
        return json;
      });
    });
  }

  var toastTimer = null;
  function toast(msg) {
    var t = qs('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  var DEFAULT_MEAS = FeatherCalc.DEFAULT_MEAS;

  // Each entry drives both the inline field label and the rich hover/focus help
  // popover (see helpIcon()). `hint` stays short -- it is also reused as an inline
  // muted caption on a couple of fields (e.g. the IMD slider). `desc`, `howTo` and
  // `range` are the longer copy shown inside the popover: what the measurement is,
  // how a surgeon actually takes it, and what most patients fall into.
  //
  // `img` is the reference diagram. POLYTECH's own renders live under
  // /polytech-images/; the measurements introduced with the Current/Desired split
  // have purpose-drawn schematics under /img/ instead.
  //
  // `side: true` marks a measurement recorded separately for the left and right
  // breast (stored as `<key>L` / `<key>R`), so breast asymmetry can be carried
  // through into two independent implant recommendations.
  var HELP_FIELDS = {
    // ---------------- Current measurements ----------------
    cw: {
      label: 'Chest Width', img: '/img/help-cw.svg',
      hint: 'Chest width measurement (cm).',
      desc: 'The horizontal base width of the chest wall at the level of the inframammary fold -- the anatomical footprint the implant has to sit on. Together with Current Cleavage it sets the hard upper bound on implant width: no implant wider than the breast base is ever suggested.',
      howTo: 'Patient supine, arms relaxed at the sides. Measure with calipers or a flexible tape from the anterior axillary line to the anterior axillary line (or sternal midline to axillary line, then double it), at the level of the IMF.',
      range: 'Most adult patients fall between 24-30 cm; the demo default (27 cm) sits in the middle of that range.'
    },
    dimd: {
      label: 'Current Cleavage', img: '/img/help-dimd.svg',
      hint: 'Existing inter-mammary distance (cm).',
      desc: 'The starting inter-mammary distance -- the gap between the breasts at the sternum before surgery -- used here as a discrete preset rather than a free measurement.',
      howTo: 'Measure the horizontal distance between the medial borders of the two breast mounds at the sternum, patient upright, and round to the nearest preset (3 / 4 / 5 cm).',
      range: 'Most patients land on 3-5 cm; narrower values suit patients who want closer cleavage, wider values suit a broader chest anatomy.',
      options: ['3', '4', '5']
    },
    stMed: {
      label: 'Soft Tissue Medial Pole', img: '/img/help-st-medial.svg', side: true,
      hint: 'Soft tissue thickness at the medial pole (cm).',
      desc: 'Skin plus subcutaneous fat (not gland) covering the inner edge of the breast, on the side facing the sternum. Thin medial coverage is what makes an implant edge visible along the cleavage line, so it is measured separately from the lateral reading.',
      howTo: 'Pinch test: gently pinch the fold between the breast mound and the sternum between thumb and forefinger, patient upright, and measure the fold thickness.',
      range: 'Typically 0.4-2.0 cm, and usually thinner than the lateral reading on the same breast. Under 0.5 cm is thin coverage.'
    },
    stLat: {
      label: 'Soft Tissue Lateral Pole', img: '/img/help-st-lateral.svg', side: true,
      hint: 'Soft tissue thickness at the lateral pole (cm).',
      desc: 'The same pinch-test measurement taken at the outer breast border, towards the axilla. Lateral coverage is generally the thicker of the two and governs how well the outer implant border is camouflaged.',
      howTo: 'Pinch test at the outer breast border, roughly on the anterior axillary line, patient upright with the arm relaxed at the side.',
      range: 'Typically 0.5-2.5 cm. The medial and lateral readings are averaged into the effective soft-tissue figure that drives implant width.'
    },
    stup: {
      label: 'Soft Tissue Upper Pole', img: '/img/help-st-upper.svg', side: true,
      hint: 'Soft tissue thickness over the upper pole (cm).',
      desc: 'Pinch-test thickness over the upper pole / decolletage -- generally the thinnest tissue on the breast, so it drives visibility of the implant\'s upper edge.',
      howTo: 'Pinch test over the upper pole (just below the clavicle line, above the gland), patient upright, arms relaxed.',
      range: 'Usually 0.3-1.5 cm -- typically thinner than the lower-pole readings for the same patient.'
    },
    pp: {
      label: 'Parenchyma', img: '/img/help-pp.svg', side: true,
      hint: 'Existing glandular tissue thickness (cm).',
      desc: 'The thickness of the patient\'s own glandular (breast) tissue at the lower pole -- separate from soft tissue/fat. As well as camouflaging the implant edge, the difference between the two sides is what drives the symmetry compensation: the breast holding less of its own tissue is offered proportionally more implant volume.',
      howTo: 'Pinch test isolating the glandular tissue at the lower pole, patient upright; compare against the desired IMD to flag symmastia risk if the pockets would leave too little medial support.',
      range: 'Typically 1-3 cm. Under 0.8 cm is thin parenchyma (higher risk of implant edge visibility/palpability).'
    },
    cnimf: {
      label: 'Lower Pole Skin', img: '/img/help-cnimf.svg', side: true,
      hint: 'Lower pole skin stretch / nipple-to-IMF distance (cm).',
      desc: 'The stretched nipple-to-inframammary-fold distance -- a measure of how much the lower pole skin envelope can already expand, which caps how much projection/height a given patient\'s skin can safely accommodate.',
      howTo: 'With the tissue gently stretched (not resting), measure from the nipple to the inframammary fold along the lower pole, patient upright.',
      range: 'Usually 4-9 cm; higher values indicate more skin laxity (often seen with mild ptosis or after weight change/pregnancy).'
    },

    // ---------------- Desired measurements ----------------
    bh: {
      label: 'Desired Breast Height', img: '/img/help-bh.svg',
      hint: 'Desired final breast height (cm).',
      desc: 'The target vertical height of the breast mound after surgery, from the upper breast border down to the inframammary fold.',
      howTo: 'Estimated together with the patient (often against a sizer or reference photos) rather than measured on the pre-op chest directly, since it describes the desired post-op result.',
      range: 'Commonly requested between 8-11 cm depending on chest size and desired volume.'
    },
    upperpole: {
      label: 'Desired Upper Pole', img: '/img/help-upperpole.svg',
      hint: 'Natural shows anatomical implants only; Full shows round implants only.',
      desc: 'The patient\'s aesthetic goal for the upper breast contour. This is a hard filter on the Suggestions step: "Natural" restricts the catalogue to anatomical shapes (Replicon, Opticon, Opticon Plus, Anatomical Oval), "Full" restricts it to round shapes (Meme).',
      howTo: 'Discussed directly with the patient during consultation, often with photos/sizers as reference, rather than measured with any instrument.',
      range: 'Most patients today choose a "Natural" sloped upper pole; "Full" is chosen when a fuller, more visibly augmented look is the goal.',
      options: [{ v: 0, label: 'Natural' }, { v: 1, label: 'Full' }]
    },
    size: {
      label: 'Desired Breast Increase', img: '/img/help-projection.svg',
      hint: 'Filters the catalogue by implant projection class.',
      desc: 'How much larger the breasts should look post-op. This maps directly onto the catalogue\'s projection classes: Low shows low and moderate projection implants, Medium shows moderate only, and Large shows high and extra high projection implants.',
      howTo: 'Discussed with the patient, often anchored against trial/sizer implants during the fitting so the choice reflects how the result actually looks and feels, not just a number.',
      range: 'Most consultations settle on "Medium" for a proportional result; "Large" is chosen when a more dramatic increase is the explicit goal.',
      options: [{ v: 0, label: 'Low' }, { v: 1, label: 'Medium' }, { v: 2, label: 'Large' }]
    },
    desiredImd: {
      label: 'Desired Intermammary Distance (IMD)',
      hint: 'Desired postoperative gap between the medial edges of the breasts (cm). Compared against pre-op Parenchyma to flag symmastia risk if the pockets would be left with too little medial support.',
      desc: 'The target postoperative gap between the medial edges of the breasts -- the surgical-planning term for "distance between breasts" once healed.',
      howTo: 'Set jointly with the patient (this field is a planning target, not measured on the pre-op chest); it is compared against the pre-op Parenchyma reading to flag symmastia risk.',
      range: 'Most plans target 1.5-4 cm; below ~1.5 cm the pockets may be left with too little medial support, risking symmastia.'
    },
    shell: {
      label: 'Shell Surface', img: '/img/help-shell.svg',
      hint: 'The implant-to-tissue interface. Filters the catalogue.',
      desc: 'How the outside of the implant shell is finished. Microthane is an open-cell polyurethane foam that tissue interlocks into, so the implant resists rotation. Microtextured (MESMO) is POLYTECH\'s standard fine micro-relief. POLYsmoooth is a smooth shell that leaves the implant mobile in its pocket.',
      howTo: 'A surgical decision rather than a measurement -- driven by pocket plane, rotation risk (critical for anatomical shapes) and the surgeon\'s own protocol.',
      range: 'Across the 613 catalogue references: 283 Microthane, 278 Microtextured, 52 POLYsmoooth.',
      options: [
        { v: 'microthane', label: 'Microthane' },
        { v: 'microtextured', label: 'Microtextured' },
        { v: 'polysmoooth', label: 'POLYsmoooth' }
      ]
    },
    range: {
      label: 'Implant Range', img: '/img/help-range.svg',
      hint: 'Which POLYTECH gel family to draw suggestions from.',
      desc: 'The gel filling family. SublimeLine is the standard cohesive silicone range and by far the largest. B-Lite is filled with a microsphere gel that is markedly lighter per ml, for patients where implant weight is a concern. Diagon\\Gel 4Two combines two gels of different firmness in one shell and exists only as an anatomical oval.',
      howTo: 'Chosen with the patient from weight, feel and shape priorities -- not measured.',
      range: 'Catalogue coverage: SublimeLine 407 references, B-Lite 194, Diagon\\Gel 4Two 12 (anatomical only, high / extra high projection only).',
      options: [
        { v: 'sublimeline', label: 'SublimeLine' },
        { v: 'diagongel', label: 'DiagonGel' },
        { v: 'blite', label: 'Lightweight' }
      ]
    },
    manualWidth: {
      label: 'Implant Width (A)', img: '/img/help-cw.svg', side: true,
      hint: 'Auto-derived per side from the measurements, or overridden by hand.',
      desc: 'The base width of the implant for this breast. Left on auto it is derived from chest width, cleavage and that side\'s own soft tissue, so an asymmetric patient gets two different widths. It is always capped at the available breast base width.',
      howTo: 'Leave on auto unless the fitting session shows a different width sits better; the trial sizers on the next step follow whichever value is active.',
      range: 'The POLYTECH catalogue spans 80-161 mm of implant base width across all ranges and shapes.'
    }
  };

  // ---------------- router ----------------
  function currentRoute() {
    var hash = window.location.hash.replace(/^#\/?/, '');
    return hash.split('/').filter(Boolean);
  }

  function navigate(route) { window.location.hash = '#/' + route; }

  function render() {
    var parts = currentRoute();
    var root = parts[0] || 'dashboard';
    qsa('.nav-link').forEach(function (a) { a.classList.toggle('active', a.dataset.route === root); });

    if (root === 'dashboard') return renderDashboard();
    if (root === 'patients' && parts[1] === 'new') return renderNewPatient();
    if (root === 'patients' && parts[1] && parts[2] === 'consult') return renderWizard(parts[1], parts[3]);
    if (root === 'patients' && parts[1]) return renderPatientDetail(parts[1]);
    if (root === 'patients') return renderPatients();
    if (root === 'appointments') return renderAppointments();
    if (root === 'reports') return renderReports();
    return renderDashboard();
  }

  window.addEventListener('hashchange', render);

  // ---------------- shell ----------------
  function boot() {
    api('/api/me').then(function (user) {
      state.user = user;
      qs('#userName').textContent = user.name;
      qs('#userClinic').textContent = user.clinic;
      qsa('.nav-link').forEach(function (a) {
        a.addEventListener('click', function () { navigate(a.dataset.route); });
      });
      qs('#logoutBtn').addEventListener('click', function () {
        api('/api/logout', { method: 'POST' }).then(function () { window.location.href = '/index.html'; });
      });
      if (!window.location.hash) navigate('dashboard');
      render();
    });
  }

  function setView(html) { qs('#view').innerHTML = html; }

  function pageHeader(title, subtitle, actionsHtml) {
    return '<div class="page-header"><div><h1>' + esc(title) + '</h1>' +
      (subtitle ? '<div class="subtitle">' + esc(subtitle) + '</div>' : '') + '</div>' +
      '<div>' + (actionsHtml || '') + '</div></div>';
  }

  // ---------------- Dashboard ----------------
  function renderDashboard() {
    setView('<div class="empty-state">Loading dashboard&hellip;</div>');
    Promise.all([api('/api/reports/summary'), api('/api/appointments'), api('/api/patients')]).then(function (res) {
      var summary = res[0], appts = res[1], patients = res[2];
      var upcoming = appts.filter(function (a) { return a.status !== 'cancelled'; })
        .sort(function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time); }).slice(0, 5);
      var recentPatients = patients.slice().sort(function (a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); }).slice(0, 5);

      var html = pageHeader('Welcome back, ' + esc(state.user.name.split(' ').slice(-1)[0]), state.user.clinic,
        '<button class="btn" id="quickNewPatient">+ New patient</button>');

      html += '<div class="grid cols-4 mb-2">' +
        statCard(summary.totals.patients, 'Patients') +
        statCard(summary.totals.consultations, 'Consultations') +
        statCard(summary.totals.appointments, 'Appointments') +
        statCard(summary.totals.avgVolumeSelected ? summary.totals.avgVolumeSelected + ' ml' : '&mdash;', 'Avg. volume selected') +
        '</div>';

      html += '<div class="grid cols-2">';
      html += '<div class="card"><h3>Upcoming appointments</h3>' + (upcoming.length ? appointmentsTable(upcoming, false) : '<div class="empty-state">No upcoming appointments.</div>') + '</div>';
      html += '<div class="card"><h3>Recent patients</h3>' + (recentPatients.length ? patientsTable(recentPatients) : '<div class="empty-state">No patients yet.</div>') + '</div>';
      html += '</div>';

      setView(html);
      qs('#quickNewPatient').addEventListener('click', function () { navigate('patients/new'); });
      wirePatientRows();
    });
  }

  function statCard(value, label) {
    return '<div class="card stat-card"><div class="value">' + value + '</div><div class="label">' + esc(label) + '</div></div>';
  }

  // ---------------- Patients ----------------
  function patientsTable(patients) {
    var rows = patients.map(function (p) {
      return '<tr class="clickable" data-id="' + p.id + '"><td><strong>' + esc(p.firstName + ' ' + p.lastName) + '</strong></td>' +
        '<td class="muted">' + age(p.dob) + (age(p.dob) !== '' ? ' yrs' : '') + '</td>' +
        '<td class="muted">' + esc(p.phone || '') + '</td>' +
        '<td class="muted">' + fmtDate(p.createdAt) + '</td></tr>';
    }).join('');
    return '<table><thead><tr><th>Name</th><th>Age</th><th>Contact</th><th>Added</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function wirePatientRows() {
    qsa('tr[data-id]').forEach(function (tr) {
      tr.addEventListener('click', function () { navigate('patients/' + tr.dataset.id); });
    });
  }

  function renderPatients() {
    setView('<div class="empty-state">Loading patients&hellip;</div>');
    api('/api/patients').then(function (patients) {
      state.patients = patients;
      var html = pageHeader('Patients', patients.length + ' on file', '<button class="btn" id="newPatientBtn">+ New patient</button>');
      html += '<div class="card">' + (patients.length ? patientsTable(patients) : '<div class="empty-state">No patients yet. Add your first one.</div>') + '</div>';
      setView(html);
      qs('#newPatientBtn').addEventListener('click', function () { navigate('patients/new'); });
      wirePatientRows();
    });
  }

  function renderNewPatient() {
    var html = pageHeader('New patient', 'Create a patient dossier', '<button class="btn secondary" id="cancelBtn">Cancel</button>');
    html += '<div class="card" style="max-width:640px;">' +
      '<div class="field-row">' +
        field('firstName', 'First name', 'text', '') +
        field('lastName', 'Last name', 'text', '') +
      '</div>' +
      '<div class="field-row">' +
        field('dob', 'Date of birth', 'date', '') +
        field('phone', 'Phone', 'text', '') +
      '</div>' +
      field('email', 'Email', 'email', '') +
      '<div class="field"><label for="notes">Notes</label><textarea id="notes" rows="3"></textarea></div>' +
      '<button class="btn" id="savePatientBtn">Create patient</button>' +
      '</div>';
    setView(html);
    qs('#cancelBtn').addEventListener('click', function () { navigate('patients'); });
    qs('#savePatientBtn').addEventListener('click', function () {
      var body = {
        firstName: qs('#firstName').value.trim(),
        lastName: qs('#lastName').value.trim(),
        dob: qs('#dob').value,
        phone: qs('#phone').value.trim(),
        email: qs('#email').value.trim(),
        notes: qs('#notes').value.trim()
      };
      if (!body.firstName || !body.lastName) { toast('First and last name are required'); return; }
      api('/api/patients', { method: 'POST', body: body }).then(function (p) {
        toast('Patient created');
        navigate('patients/' + p.id);
      });
    });
  }

  function field(id, label, type, value) {
    return '<div class="field"><label for="' + id + '">' + esc(label) + '</label>' +
      '<input type="' + type + '" id="' + id + '" value="' + esc(value) + '" /></div>';
  }

  function renderPatientDetail(id) {
    setView('<div class="empty-state">Loading patient&hellip;</div>');
    Promise.all([api('/api/patients/' + id), api('/api/patients/' + id + '/photos')]).then(function (res) {
      var data = res[0];
      var photos = res[1];
      var p = data.patient;
      var html = pageHeader(p.firstName + ' ' + p.lastName,
        (age(p.dob) !== '' ? age(p.dob) + ' yrs · ' : '') + (p.phone || '') + (p.email ? ' · ' + p.email : ''),
        '<button class="btn" id="newConsultBtn">+ New consultation</button>');

      html += '<div class="grid cols-2">';
      html += '<div class="card"><h3>Notes</h3><div class="muted">' + (esc(p.notes) || '<em>No notes.</em>') + '</div></div>';

      var upcomingAppts = data.appointments.filter(function (a) { return a.status !== 'cancelled'; });
      html += '<div class="card"><h3>Appointments</h3>' + (upcomingAppts.length ? appointmentsTable(upcomingAppts, false) : '<div class="empty-state">None scheduled.</div>') + '</div>';
      html += '</div>';

      html += photosCardHtml(p, photos);

      html += '<div class="card mt-2"><h3>Consultation history</h3>';
      if (!data.consultations.length) {
        html += '<div class="empty-state">No consultations yet.</div>';
      } else {
        html += data.consultations.slice().reverse().map(function (c) { return consultationSummaryCard(c, p); }).join('');
      }
      html += '</div>';

      html += '<div class="card mt-2" style="display:flex; justify-content:flex-end;">' +
        '<button class="btn danger" id="deletePatientBtn">Delete patient</button></div>';

      setView(html);
      qs('#newConsultBtn').addEventListener('click', function () { navigate('patients/' + p.id + '/consult'); });
      wireConsultationCards(p);
      wirePhotosCard(p);
      qs('#deletePatientBtn').addEventListener('click', function () { openDeletePatientModal(p); });
    });
  }

  function openDeletePatientModal(patient) {
    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = '<div class="modal">' +
      '<h3>Delete patient?</h3>' +
      '<p class="muted">Are you sure you want to delete this patient? All of its data will be lost.</p>' +
      '<div style="display:flex; gap:0.6em; justify-content:flex-end;">' +
      '<button class="btn secondary" id="dpCancel">Cancel</button>' +
      '<button class="btn danger" id="dpConfirm">Delete</button>' +
      '</div></div>';
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', function (e) { if (e.target === backdrop) backdrop.remove(); });
    qs('#dpCancel', backdrop).addEventListener('click', function () { backdrop.remove(); });
    qs('#dpConfirm', backdrop).addEventListener('click', function () {
      api('/api/patients/' + patient.id, { method: 'DELETE' }).then(function () {
        backdrop.remove();
        toast('Patient deleted');
        navigate('patients');
      }).catch(function (e) { toast(e.message || 'Could not delete patient'); });
    });
  }

  // ---------------- Patient photo gallery (pre-op / post-op) ----------------
  function photoPhaseSectionHtml(phaseLabel, phase, photos) {
    var items = photos.filter(function (ph) { return ph.phase === phase; });
    var html = '<div class="photo-phase-heading">' + esc(phaseLabel) + '</div><div class="photo-grid">';
    items.forEach(function (ph) {
      html += '<div class="photo-thumb"><img src="' + esc(ph.url) + '" alt="' + esc(phaseLabel) + ' photo" loading="lazy" />' +
        (ph.source === 'upload' ? '<button type="button" class="photo-remove" data-photo-id="' + esc(ph.id) + '" title="Remove photo">&times;</button>' : '') +
        '</div>';
    });
    html += '<label class="photo-upload-btn"><span>+ Add photo</span>' +
      '<input type="file" accept="image/*" data-phase="' + phase + '" style="display:none;" /></label>';
    html += '</div>';
    return html;
  }

  function photosCardHtml(patient, photos) {
    var hasPhotos = photos.length > 0;
    var html = '<div class="card mt-2">';
    html += '<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.6em;">' +
      '<h3 style="margin:0;">Photos</h3>' +
      '<a class="btn secondary small' + (hasPhotos ? '' : ' disabled') + '" id="generatePptxBtn" href="/api/patients/' + patient.id + '/pptx" target="_blank">Generate before/after PPTX</a>' +
      '</div>';
    html += '<div class="muted mb-1" style="margin-top:0.3em;">Pre-op and post-op photos for the case record, used to build the before/after export.</div>';
    html += photoPhaseSectionHtml('Before', 'before', photos);
    html += photoPhaseSectionHtml('After', 'after', photos);
    html += '</div>';
    return html;
  }

  function wirePhotosCard(patient) {
    qsa('.photo-upload-btn input[type=file]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var file = inp.files && inp.files[0];
        if (!file) return;
        var phase = inp.dataset.phase;
        var reader = new FileReader();
        reader.onload = function () {
          api('/api/patients/' + patient.id + '/photos', { method: 'POST', body: { phase: phase, dataUrl: reader.result, filename: file.name } })
            .then(function () { toast('Photo added'); renderPatientDetail(patient.id); })
            .catch(function (e) { toast(e.message || 'Could not upload photo'); });
        };
        reader.readAsDataURL(file);
      });
    });
    qsa('[data-photo-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        api('/api/patients/' + patient.id + '/photos/' + btn.dataset.photoId, { method: 'DELETE' })
          .then(function () { toast('Photo removed'); renderPatientDetail(patient.id); });
      });
    });
  }

  function consultationSummaryCard(c, patient) {
    var comp = c.computed;
    var statusPill = { draft: 'warning', completed: '', implant_selected: 'success' }[c.status] || '';
    var body = '<div class="card mb-1" data-cid="' + c.id + '" style="cursor:pointer;">' +
      '<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:0.6em;">' +
      '<div><strong>' + fmtDate(c.date) + '</strong> &middot; <span class="pill ' + statusPill + '">' + esc((c.status || '').replace('_', ' ')) + '</span></div>' +
      (comp && comp.rangeLabel ? '<div class="pill accent">' + esc(comp.rangeLabel) + '</div>' : '') +
      '</div>';
    if (comp && comp.sides) {
      body += '<div class="consult-sides mt-1">';
      FeatherCalc.SIDES.forEach(function (side) {
        var s = comp.sides[side];
        if (!s) return;
        body += '<div class="consult-side">' +
          '<span class="consult-side-name">' + esc(FeatherCalc.SIDE_LABELS[side]) + '</span>' +
          '<span class="muted">' + esc(s.ref) + ' &middot; ' + esc(s.shapeLabel) + ' &middot; W:' + s.w + ' H:' + s.h +
          ' P:' + s.p + ' &middot; <strong>' + s.v + ' ml</strong></span>' +
          (s.sizer ? '<span class="muted">Trial sizer: <strong>' + esc(s.sizer) + '</strong></span>' : '') +
          '</div>';
      });
      body += '</div>';
    }
    if (c.notes) body += '<div class="muted mt-1">' + esc(c.notes) + '</div>';
    body += '</div>';
    return body;
  }

  function wireConsultationCards(patient) {
    qsa('[data-cid]').forEach(function (card) {
      card.addEventListener('click', function () { navigate('patients/' + patient.id + '/consult/' + card.dataset.cid); });
    });
  }

  // ---------------- Consultation wizard ----------------
  var WIZARD_STEPS = ['Patient', 'Measurements', 'Suggestions', 'Selection'];

  function renderWizard(patientId, consultationId) {
    setView('<div class="empty-state">Loading&hellip;</div>');
    var patientReq = api('/api/patients/' + patientId);
    var existing = null;
    var chain = patientReq.then(function (data) {
      if (consultationId) existing = data.consultations.find(function (c) { return c.id === consultationId; });
      return data;
    });
    chain.then(function (data) {
      var patient = data.patient;
      // normaliseMeas() upgrades a dossier saved before the Current/Desired split so
      // older consultations still open and recompute against the new catalogue.
      var meas = FeatherCalc.normaliseMeas(existing ? existing.meas : DEFAULT_MEAS);
      var sizer = (existing && existing.chosenSizer && typeof existing.chosenSizer === 'object')
        ? existing.chosenSizer : { left: null, right: null };
      state.wizard = {
        patient: patient,
        consultationId: consultationId || null,
        step: existing ? 2 : 1,
        meas: meas,
        selection: (existing && existing.selection) ? shallowCopy(existing.selection) : { left: null, right: null },
        chosenSizer: sizer,
        notes: existing ? existing.notes : '',
        status: existing ? existing.status : 'draft'
      };
      drawWizard();
    });
  }

  function shallowCopy(o) { var out = {}; for (var k in o) out[k] = o[k]; return out; }

  function wizardStepsHtml(active) {
    return '<div class="wizard-steps">' + WIZARD_STEPS.map(function (label, i) {
      var stepNo = i + 1;
      var cls = stepNo === active ? 'active' : (stepNo < active ? 'done' : '');
      return '<div class="wizard-step ' + cls + '">' + stepNo + '. ' + label + '</div>';
    }).join('') + '</div>';
  }

  function drawWizard() {
    var w = state.wizard;
    var html = pageHeader('Consultation', w.patient.firstName + ' ' + w.patient.lastName, '<button class="btn secondary" id="backBtn">Back to patient</button>');
    html += wizardStepsHtml(w.step);
    html += '<div id="wizardBody"></div>';
    setView(html);
    qs('#backBtn').addEventListener('click', function () { navigate('patients/' + w.patient.id); });
    if (w.step === 1) drawStepPatient();
    else if (w.step === 2) drawStepMeasurements();
    else if (w.step === 3) drawStepSuggestions();
    else drawStepSelection();
  }

  function drawStepPatient() {
    var w = state.wizard;
    var html = '<div class="card" style="max-width:520px;">' +
      '<h3>' + esc(w.patient.firstName + ' ' + w.patient.lastName) + '</h3>' +
      '<div class="muted mb-1">' + (age(w.patient.dob) !== '' ? age(w.patient.dob) + ' yrs' : '') + '</div>' +
      '<button class="btn" id="toMeas">Continue to measurements</button>' +
      '</div>';
    qs('#wizardBody').innerHTML = html;
    qs('#toMeas').addEventListener('click', function () { w.step = 2; drawWizard(); });
  }

  // Hover/focus-triggered help popover: a small inline icon that, on hover or
  // keyboard focus, expands into a card with a larger reference diagram plus a full
  // description of what the measurement means, how to actually take it, and the
  // typical range for most patients. Pure CSS show/hide (see .help-trigger/.help-popover
  // in style.css) -- no JS state, so it survives re-renders for free.
  // ---------------------------- Help popover ----------------------------
  // A single popover element lives on <body> and is filled on demand, rather than one
  // nested inside every trigger. Nesting it looked simpler but could not work: the
  // measurement panels and implant cards carry an entrance `animation` with
  // fill-mode `both`, which leaves a transform on the element -- and a transformed
  // ancestor becomes the containing block for `position: fixed` descendants, so a
  // nested popover was positioned against its panel instead of the viewport and
  // landed off-screen. Anchoring to <body> also means one DOM subtree instead of
  // thirteen.
  var POPOVER_GAP = 10;
  var POPOVER_MARGIN = 12;
  var helpPopover = null;
  var helpHideTimer = null;

  function getHelpPopover() {
    if (!helpPopover) {
      helpPopover = document.createElement('div');
      helpPopover.className = 'help-popover';
      helpPopover.setAttribute('role', 'tooltip');
      // Keep it open while the pointer is inside it, so the copy stays readable.
      helpPopover.addEventListener('mouseenter', function () { clearTimeout(helpHideTimer); });
      helpPopover.addEventListener('mouseleave', hideHelpPopover);
      document.body.appendChild(helpPopover);
    }
    return helpPopover;
  }

  function showHelpPopover(trigger) {
    var f = HELP_FIELDS[trigger.dataset.help];
    if (!f) return;
    clearTimeout(helpHideTimer);
    var pop = getHelpPopover();
    pop.innerHTML =
      (f.img ? '<img class="help-popover-img" src="' + esc(f.img) + '" alt="How to take the ' + esc(f.label) + ' measurement" />' : '') +
      '<div class="help-popover-body">' +
      '<strong class="help-popover-title">' + esc(f.label) + '</strong>' +
      (f.desc ? '<span class="help-popover-section">' + esc(f.desc) + '</span>' : '') +
      (f.howTo ? '<span class="help-popover-section"><strong>How to measure:</strong> ' + esc(f.howTo) + '</span>' : '') +
      (f.range ? '<span class="help-popover-section help-popover-range"><strong>Typical range:</strong> ' + esc(f.range) + '</span>' : '') +
      '</div>';
    pop.classList.add('visible');
    positionHelpPopover(trigger);
  }

  function hideHelpPopover() {
    helpHideTimer = setTimeout(function () {
      if (helpPopover) helpPopover.classList.remove('visible');
    }, 120);
  }

  // Opens above the icon when there is room -- which is what the fields low in a
  // panel need, since opening downwards would run them off the bottom of the window
  // -- and below otherwise, clamped on both axes so it can never hang off an edge.
  function positionHelpPopover(trigger) {
    var pop = helpPopover;
    if (!pop || !pop.classList.contains('visible')) return;
    var t = trigger.getBoundingClientRect();
    var w = pop.offsetWidth;
    var h = pop.offsetHeight;
    var vw = document.documentElement.clientWidth;
    var vh = document.documentElement.clientHeight;

    var roomAbove = t.top - POPOVER_GAP - POPOVER_MARGIN;
    var roomBelow = vh - t.bottom - POPOVER_GAP - POPOVER_MARGIN;
    var above = h <= roomAbove || (roomAbove > roomBelow && h > roomBelow);

    var top = above ? t.top - h - POPOVER_GAP : t.bottom + POPOVER_GAP;
    if (top + h > vh - POPOVER_MARGIN) top = vh - h - POPOVER_MARGIN;
    if (top < POPOVER_MARGIN) top = POPOVER_MARGIN;

    var left = t.left + t.width / 2 - w / 2;
    if (left + w > vw - POPOVER_MARGIN) left = vw - w - POPOVER_MARGIN;
    if (left < POPOVER_MARGIN) left = POPOVER_MARGIN;

    pop.style.top = Math.round(top) + 'px';
    pop.style.left = Math.round(left) + 'px';
    pop.classList.toggle('placed-above', above);
    pop.classList.toggle('placed-below', !above);
  }

  // Delegated from document so it survives every re-render of the wizard, and bound
  // in the capture phase because mouseenter/mouseleave/focus do not bubble.
  var activeHelpTrigger = null;
  ['mouseenter', 'focusin'].forEach(function (evt) {
    document.addEventListener(evt, function (e) {
      if (!e.target || !e.target.closest) return;
      var trigger = e.target.closest('[data-help]');
      if (!trigger) return;
      activeHelpTrigger = trigger;
      showHelpPopover(trigger);
    }, true);
  });
  ['mouseleave', 'focusout'].forEach(function (evt) {
    document.addEventListener(evt, function (e) {
      if (!e.target || !e.target.closest) return;
      if (e.target.closest('[data-help]')) hideHelpPopover();
    }, true);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && helpPopover) helpPopover.classList.remove('visible');
  });
  // A viewport-anchored popover would otherwise drift away from its icon.
  ['scroll', 'resize'].forEach(function (evt) {
    window.addEventListener(evt, function () {
      if (activeHelpTrigger && document.contains(activeHelpTrigger)) positionHelpPopover(activeHelpTrigger);
      else if (helpPopover) helpPopover.classList.remove('visible');
    }, true);
  });

  function helpIcon(key) {
    var f = HELP_FIELDS[key];
    if (!f || !f.img) return '';
    return '<span class="help-trigger" tabindex="0" data-help="' + esc(key) + '"' +
      ' role="button" aria-label="About the ' + esc(f.label) + ' measurement">' +
      '<img class="help-icon" src="' + esc(f.img) + '" alt="" />' +
      '</span>';
  }

  function drawStepMeasurements() {
    var w = state.wizard;
    var m = w.meas;
    // Two columns: what the patient has now on the left, what they are aiming for on
    // the right. Everything that describes one breast is captured per side inside the
    // Current column, so an asymmetric patient carries two sets of figures forward.
    var html = '<div class="meas-columns">';

    // ---------------- Current ----------------
    html += '<section class="card meas-panel">';
    html += '<h3 class="meas-panel-title">Current Measurements of the Patient</h3>';
    html += '<p class="muted meas-panel-sub">As measured on the patient today. Per-breast readings are recorded separately so any asymmetry is carried into the suggestions.</p>';

    html += '<div class="field-row">';
    html += numField('cw', m.cw);
    html += radioField('dimd', m.dimd, HELP_FIELDS.dimd.options.map(function (o) { return { v: o, label: o + ' cm' }; }));
    html += '</div>';

    html += sideHeaderHtml();
    html += sideNumField('stMed', m);
    html += sideNumField('stLat', m);
    html += sideNumField('stup', m);
    html += sideNumField('pp', m);
    html += sideNumField('cnimf', m);
    html += '</section>';

    // ---------------- Desired ----------------
    html += '<section class="card meas-panel">';
    html += '<h3 class="meas-panel-title">Desired Future Breast of the Patient</h3>';
    html += '<p class="muted meas-panel-sub">The aesthetic goal and implant preferences. These choices filter the POLYTECH catalogue on the Suggestions step.</p>';

    html += numField('bh', m.bh);
    html += filterRadioField('upperpole', m, HELP_FIELDS.upperpole.options);
    html += filterRadioField('size', m, HELP_FIELDS.size.options);
    html += imdSliderHtml(m);
    html += filterRadioField('range', m, HELP_FIELDS.range.options);
    html += filterRadioField('shell', m, HELP_FIELDS.shell.options);
    html += '</section>';

    html += '</div>'; // .meas-columns

    // Implant width spans the full width below both panels: it is derived from the
    // Current column but lives in the Desired half of the decision, so it belongs to
    // neither -- and given the whole row, the two sliders read as a proper pair.
    html += '<section class="card mt-2 width-card">';
    html += widthControlHtml(m);
    html += catalogueMatchHtml(m);
    html += '</section>';

    html += '<div class="card mt-2"><div class="field"><label for="notesField">Notes</label><textarea id="notesField" rows="2">' + esc(w.notes) + '</textarea></div>';

    html += '<div style="display:flex; gap:0.6em;"><button class="btn secondary" id="toPatientStep">Back</button><button class="btn" id="toSuggestions">See suggestions</button></div>';
    html += '</div>';

    qs('#wizardBody').innerHTML = html;

    // Changing any of these re-filters the catalogue, so the live match counter and
    // the auto-derived widths underneath have to be redrawn.
    var FILTER_FIELDS = ['upperpole', 'size', 'range', 'shell'];

    qsa('#wizardBody input[type=number]').forEach(function (inp) {
      inp.addEventListener('input', function () { m[inp.dataset.field] = inp.value; });
      // Width is derived from these, so refresh the panel once the field is left.
      inp.addEventListener('change', function () { drawStepMeasurements(); });
    });
    qsa('#wizardBody input[type=radio]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var name = inp.name;
        // Radio values are a mix of numeric codes (upperpole, size, dimd) and string
        // keys (range, shell) -- only coerce the ones that really are numbers.
        var raw = inp.value;
        m[name] = (raw !== '' && !isNaN(Number(raw))) ? Number(raw) : raw;
        qsa('input[name="' + name + '"]').forEach(function (r) { r.closest('label').classList.toggle('active', r.checked); });
        if (FILTER_FIELDS.indexOf(name) !== -1 || name === 'dimd') {
          w.notes = qs('#notesField').value;
          drawStepMeasurements();
        }
      });
    });
    wireImdSlider(m, function () {});
    wireWidthControl(m, function () { drawStepMeasurements(); });

    qs('#toPatientStep').addEventListener('click', function () { w.step = 1; drawWizard(); });
    qs('#toSuggestions').addEventListener('click', function () {
      w.notes = qs('#notesField').value;
      w.step = 3;
      drawWizard();
    });
  }

  function numField(key, value) {
    var f = HELP_FIELDS[key];
    return '<div class="field"><label>' + esc(f.label) + helpIcon(key) + '</label>' +
      '<input type="number" step="0.1" data-field="' + key + '" value="' + esc(value) + '" /></div>';
  }

  function radioField(key, value, options) {
    var f = HELP_FIELDS[key];
    return '<div class="field"><label>' + esc(f.label) + helpIcon(key) + '</label>' +
      '<div class="radio-group">' + options.map(function (o) {
        var active = String(o.v) === String(value);
        return '<label class="' + (active ? 'active' : '') + '"><input type="radio" name="' + key + '" value="' + esc(o.v) + '" ' + (active ? 'checked' : '') + '/> ' + esc(o.label) + '</label>';
      }).join('') + '</div></div>';
  }

  // Same as radioField, but each option also reports how many catalogue implants it
  // would leave given the *other* current choices -- and an option that would leave
  // none is marked unavailable. Several real combinations are genuinely empty (e.g.
  // Diagon\Gel 4Two exists only as an anatomical, high / extra high, Microthane
  // implant), so without this the surgeon can only discover a dead end by hitting it.
  function filterRadioField(key, m, options) {
    var f = HELP_FIELDS[key];
    var value = m[key];
    return '<div class="field"><label>' + esc(f.label) + helpIcon(key) + '</label>' +
      '<div class="radio-group">' + options.map(function (o) {
        var active = String(o.v) === String(value);
        var probe = {};
        for (var k in m) if (m.hasOwnProperty(k)) probe[k] = m[k];
        probe[key] = (String(o.v) !== '' && !isNaN(Number(o.v))) ? Number(o.v) : o.v;
        var count = FeatherCalc.filterCatalogue(probe).length;
        return '<label class="' + (active ? 'active ' : '') + (count ? '' : 'unavailable') + '"' +
          (count ? '' : ' title="No catalogue implants with the other choices as they are"') + '>' +
          '<input type="radio" name="' + key + '" value="' + esc(o.v) + '" ' + (active ? 'checked' : '') + '/> ' +
          esc(o.label) + '<span class="opt-count">' + count + '</span></label>';
      }).join('') + '</div></div>';
  }

  // ---------------------------- Per-side measurement rows ----------------------------
  // One label on the left, then a Left and a Right input, so the two breasts read as
  // a single comparable row rather than two unrelated fields.
  function sideHeaderHtml() {
    return '<div class="side-grid side-grid-head">' +
      '<span class="side-grid-label"></span>' +
      '<span class="side-col-head">Left</span>' +
      '<span class="side-col-head">Right</span>' +
      '</div>';
  }

  function sideNumField(key, m) {
    var f = HELP_FIELDS[key];
    return '<div class="side-grid">' +
      '<span class="side-grid-label">' + esc(f.label) + helpIcon(key) + '</span>' +
      FeatherCalc.SIDES.map(function (side) {
        var field = FeatherCalc.sideKey(key, side);
        return '<input type="number" step="0.1" data-field="' + field + '" value="' + esc(m[field]) + '" aria-label="' + esc(f.label + ' ' + side) + '" />';
      }).join('') +
      '</div>';
  }

  // Live count of how many catalogue implants the current Desired choices leave to
  // pick from -- so an over-restrictive combination is obvious before moving on.
  function catalogueMatchHtml(m) {
    var pool = FeatherCalc.filterCatalogue(m);
    var f = FeatherCalc.activeFilters(m);
    var shapeWord = f.shapeClass === 'round' ? 'round' : 'anatomical';
    var projWords = f.projections.map(function (p) {
      return FeatherCalc.Implants.PROJECTION_LABELS[p].replace(' projection', '');
    }).join(' / ');
    if (!pool.length) {
      return '<div class="catalogue-match empty">' +
        '<strong>No catalogue implants match these choices.</strong>' +
        '<span>' + esc(FeatherCalc.Implants.RANGE_LABELS[f.range]) + ' has no ' + esc(shapeWord) +
        ' implants with ' + esc(projWords.toLowerCase()) + ' projection in ' +
        esc(FeatherCalc.Implants.SURFACE_LABELS[f.surface]) + '.</span>' +
        rescueHintHtml(m) +
        '</div>';
    }
    return '<div class="catalogue-match">' +
      '<strong>' + pool.length + '</strong>' +
      '<span>catalogue implants match &mdash; ' + esc(FeatherCalc.Implants.RANGE_LABELS[f.range]) + ', ' +
      esc(shapeWord) + ', ' + esc(projWords.toLowerCase()) + ' projection, ' +
      esc(FeatherCalc.Implants.SURFACE_LABELS[f.surface]) + '.</span>' +
      '</div>';
  }

  // When a combination is empty, every individual option also reads zero, which tells
  // the surgeon nothing about how to get out. Keep the chosen range fixed (it is the
  // most deliberate choice) and name the combinations that range does support.
  function rescueHintHtml(m) {
    var wanted = m.range;
    var combos = {};
    FeatherCalc.Implants.CATALOGUE.forEach(function (i) {
      if (i.range !== wanted) return;
      var upperpole = i.shapeClass === 'round' ? 1 : 0;
      var sizes = [];
      [0, 1, 2].forEach(function (sz) {
        if (FeatherCalc.SIZE_PROJECTIONS[sz].indexOf(i.projection) !== -1) sizes.push(FeatherCalc.SIZE_LABELS[sz]);
      });
      sizes.forEach(function (sizeLabel) {
        var key = upperpole + '|' + sizeLabel + '|' + i.surface;
        combos[key] = {
          upperPole: upperpole === 1 ? 'Full' : 'Natural',
          size: sizeLabel,
          surface: FeatherCalc.Implants.SURFACE_LABELS[i.surface]
        };
      });
    });
    var list = Object.keys(combos).map(function (k) { return combos[k]; });
    if (!list.length) return '';
    return '<span class="rescue-hint">' + esc(FeatherCalc.Implants.RANGE_LABELS[wanted]) +
      ' is available as: ' +
      list.slice(0, 6).map(function (c) {
        return '<em>' + esc(c.upperPole + ' + ' + c.size + ' + ' + c.surface) + '</em>';
      }).join(', ') +
      (list.length > 6 ? ' and ' + (list.length - 6) + ' more' : '') + '.</span>';
  }

  // ---------------------------- Desired Intermammary Distance ----------------------------
  function imdSliderHtml(m) {
    var f = HELP_FIELDS.desiredImd;
    var v = Number(m.desiredImd);
    if (isNaN(v)) v = 3;
    return '<div class="field"><label>' + esc(f.label) + helpIcon('desiredImd') + '</label>' +
      '<div style="display:flex; align-items:center; gap:0.8em;">' +
      '<input type="range" id="imdSlider" min="0.5" max="6" step="0.5" value="' + v + '" />' +
      '<strong style="min-width:3.5em; text-align:right;">' + v.toFixed(1) + ' cm</strong>' +
      '</div><div class="muted" style="font-size:0.82em; margin-top:0.3em;">' + esc(f.hint) + '</div></div>';
  }

  function wireImdSlider(m, onChange) {
    var slider = qs('#imdSlider');
    if (!slider) return;
    slider.addEventListener('input', function () {
      m.desiredImd = slider.value;
      onChange();
    });
  }

  // ---------------------------- Manual implant width override ----------------------------
  // Mirrors the desktop app's "Implant Width" slider (96-136mm, SetImplantWidth): left
  // untouched, the width is auto-derived from chest measurements as before; moving the
  // slider overrides it and every recommended implant/sizer downstream recomputes live.
  // One slider per breast: left untouched each side derives its own width from that
  // side's measurements (so an asymmetric patient gets two different widths), and
  // either can be overridden by hand independently.
  function widthControlHtml(m) {
    var cap = Math.round(FeatherCalc.breastBaseWidth(m));
    var html = '<div class="width-control">' +
      '<label class="width-control-title">' + esc(HELP_FIELDS.manualWidth.label) + helpIcon('manualWidth') + '</label>';

    FeatherCalc.SIDES.forEach(function (side) {
      var auto = FeatherCalc.autoWidth(m, side);
      var current = FeatherCalc.resolveWidth(m, side);
      var isManual = FeatherCalc.isManualWidth(m, side);
      html += '<div class="width-row" data-side="' + side + '">' +
        '<span class="width-row-side">' + esc(FeatherCalc.SIDE_LABELS[side]) + '</span>' +
        '<input type="range" class="width-slider" data-side="' + side + '" min="' + FeatherCalc.Implants.WIDTH_MIN +
        '" max="' + FeatherCalc.Implants.WIDTH_MAX + '" step="1" value="' + current + '" aria-label="Implant width ' + side + '" />' +
        '<strong class="width-row-value">' + current + ' mm</strong>' +
        (isManual
          ? '<button type="button" class="btn secondary small width-reset" data-side="' + side + '">Auto (' + auto + ')</button>'
          : '<span class="pill accent width-row-pill">Auto</span>') +
        '</div>';
    });

    html += '<div class="muted width-control-note">Capped at the available breast base width (' + cap +
      ' mm), derived from chest width minus cleavage. Suggestions and trial sizers follow whichever value is active per side.</div>';
    return html + '</div>';
  }

  // `onCommit` fires once the slider is released (the 'change' event) rather than on
  // every 'input' tick, which would otherwise force a full step redraw mid-drag and
  // make the slider thumb lose mouse capture. The mm readout still updates live.
  function wireWidthControl(m, onCommit) {
    qsa('.width-slider').forEach(function (slider) {
      var side = slider.dataset.side;
      var label = slider.parentNode.querySelector('.width-row-value');
      slider.addEventListener('input', function () {
        if (label) label.textContent = slider.value + ' mm';
      });
      slider.addEventListener('change', function () {
        m[FeatherCalc.sideKey('manualWidth', side)] = Number(slider.value);
        onCommit();
      });
    });
    qsa('.width-reset').forEach(function (btn) {
      btn.addEventListener('click', function () {
        m[FeatherCalc.sideKey('manualWidth', btn.dataset.side)] = null;
        onCommit();
      });
    });
  }

  // ---------------------------- Advisory risk warnings ----------------------------
  // A danger-level warning that names a `risk` carries a before/after plate showing
  // the outcome it is warning about, so the complication can be shown to the patient
  // rather than only described. Text-only warnings render exactly as before.
  var RISK_PLATES = {
    symmastia: { img: '/img/risk-symmastia.svg', alt: 'Normal medial pocket versus symmastia, where the two pockets meet across the midline' },
    'oversized-width': { img: '/img/risk-oversized-width.svg', alt: 'Implant matched to the breast base versus an implant overhanging the chest wall' },
    rippling: { img: '/img/risk-rippling.svg', alt: 'Adequate soft tissue coverage versus visible rippling through thin coverage' }
  };

  function warningsHtml(warnings) {
    if (!warnings || !warnings.length) return '';
    return '<div class="warnings-panel">' + warnings.map(function (w) {
      var plate = w.severity === 'danger' ? RISK_PLATES[w.risk] : null;
      return '<div class="warning-banner ' + esc(w.severity) + (plate ? ' has-plate' : '') + '">' +
        '<div class="warning-main">' +
        '<div class="warning-title">' +
        (w.severity === 'danger' ? '<span class="warning-mark" aria-hidden="true">!</span>' : '') +
        esc(w.title) + '</div>' +
        '<div class="warning-msg">' + esc(w.message) + '</div>' +
        '</div>' +
        (plate ? '<img class="warning-plate" src="' + esc(plate.img) + '" alt="' + esc(plate.alt) + '" loading="lazy" />' : '') +
        '</div>';
    }).join('') + '</div>';
  }

  // Every warning for the current selection: both sides plus the two-sided ones.
  function allWarnings(w, leftImplant, rightImplant) {
    var out = FeatherCalc.evaluateSymmetryWarnings(w.meas, leftImplant, rightImplant);
    FeatherCalc.SIDES.forEach(function (side) {
      var implant = side === 'left' ? leftImplant : rightImplant;
      if (implant) out = out.concat(FeatherCalc.evaluateWarnings(w.meas, side, implant));
    });
    // Danger first: the plate-carrying complications should lead.
    return out.sort(function (a, b) {
      return (a.severity === 'danger' ? 0 : 1) - (b.severity === 'danger' ? 0 : 1);
    });
  }

  // A single catalogue implant, as a pickable card.
  function implantCardHtml(entry, side, isSelected, isTop) {
    var i = entry.implant;
    return '<div class="implant-card' + (isSelected ? ' selected' : '') + (isTop ? ' recommended' : '') + '"' +
      ' data-side="' + side + '" data-ref="' + esc(i.ref) + '" tabindex="0" role="button" aria-pressed="' + (isSelected ? 'true' : 'false') + '">' +
      (isTop ? '<span class="badge pill accent">Best match</span>' : '') +
      '<img src="' + esc(FeatherCalc.implantImage(i)) + '" alt="' + esc(i.shapeLabel + ' ' + i.projectionLabel) + '" />' +
      '<div class="implant-card-body">' +
      '<h4>' + esc(i.shapeLabel) + '</h4>' +
      '<div class="implant-ref">' + esc(i.ref) + '</div>' +
      '<div class="volume">' + i.v + ' ml</div>' +
      '<div class="figures">W:' + i.w + ' &middot; H:' + i.h + ' &middot; P:' + i.p + ' mm</div>' +
      '<div class="implant-tags">' +
      '<span class="pill">' + esc(i.projectionLabel.replace(' projection', '')) + '</span>' +
      '<span class="pill">' + esc(i.rangeLabel) + '</span>' +
      '</div>' +
      '<div class="implant-delta muted">' +
      (entry.widthDiff === 0 ? 'exact width match' : entry.widthDiff + ' mm from target width') +
      '</div>' +
      '</div></div>';
  }

  function sideSuggestionsHtml(w, side) {
    var s = FeatherCalc.suggestImplants(w.meas, side);
    var selectedRef = w.selection[side];

    var html = '<section class="card suggest-panel">';
    html += '<div class="suggest-head">' +
      '<h3 class="meas-panel-title">' + esc(FeatherCalc.SIDE_LABELS[side]) + ' breast</h3>' +
      '<span class="pill accent">' + s.targetWidth + ' mm target</span>' +
      '</div>';

    if (s.empty) {
      html += '<div class="empty-state">' + (s.emptyReason === 'width'
        ? 'Every implant matching the desired choices is wider than this side\'s ' + s.maxWidth +
          ' mm breast base (narrowest available is ' + s.narrowestAvailable + ' mm). Re-check chest width and cleavage, or choose a different range.'
        : 'No catalogue implant matches the desired choices. Adjust them on the previous step.') +
        '</div></section>';
      return html;
    }

    html += '<p class="muted suggest-sub">' +
      (s.manual ? 'Manual width override' : 'Width auto-derived from this side (' + s.autoWidth + ' mm)') +
      ', capped at the ' + s.maxWidth + ' mm breast base. Target volume <strong>' + s.targetVolume + ' ml</strong>' +
      (s.compensation !== 0
        ? ' (' + (s.compensation > 0 ? '+' : '') + s.compensation + ' ml symmetry compensation)'
        : '') +
      '. ' + s.totalMatches + ' implants match.</p>';

    html += '<div class="implant-grid">';
    s.results.forEach(function (entry, idx) {
      html += implantCardHtml(entry, side, entry.implant.ref === selectedRef, idx === 0);
    });
    html += '</div></section>';
    return html;
  }

  function drawStepSuggestions() {
    var w = state.wizard;
    ensureSelection(w);

    var html = '<div class="card">' + widthControlHtml(w.meas) + '</div>';

    var f = FeatherCalc.activeFilters(w.meas);
    html += '<div class="mt-1 mb-1 muted">Showing <strong>' +
      esc(f.shapeClass === 'round' ? 'round' : 'anatomical') + '</strong> implants from <strong>' +
      esc(FeatherCalc.Implants.RANGE_LABELS[f.range]) + '</strong> in <strong>' +
      esc(FeatherCalc.Implants.SURFACE_LABELS[f.surface]) + '</strong>. Each side is ranked against its own ' +
      'measurements, so an asymmetric patient gets two different recommendations.</div>';

    var leftImplant = FeatherCalc.findImplant(w.selection.left);
    var rightImplant = FeatherCalc.findImplant(w.selection.right);
    html += warningsHtml(allWarnings(w, leftImplant, rightImplant));

    html += '<div class="meas-columns">';
    FeatherCalc.SIDES.forEach(function (side) { html += sideSuggestionsHtml(w, side); });
    html += '</div>';

    html += '<div class="mt-2" style="display:flex; gap:0.6em;">' +
      '<button class="btn secondary" id="toMeasStep">Back</button>' +
      '<button class="btn" id="toSelection">Continue to selection</button></div>';

    qs('#wizardBody').innerHTML = html;

    function pick(card) {
      w.selection[card.dataset.side] = card.dataset.ref;
      drawStepSuggestions();
    }
    qsa('.implant-card').forEach(function (card) {
      card.addEventListener('click', function () { pick(card); });
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(card); }
      });
    });
    wireWidthControl(w.meas, function () { w.selection = { left: null, right: null }; drawStepSuggestions(); });
    qs('#toMeasStep').addEventListener('click', function () { w.step = 2; drawWizard(); });
    qs('#toSelection').addEventListener('click', function () { w.step = 4; drawWizard(); });
  }

  // Default each side to its own best match, and drop a stored reference that the
  // current filters no longer allow (e.g. after switching range on the previous step).
  function ensureSelection(w) {
    if (!w.selection) w.selection = { left: null, right: null };
    FeatherCalc.SIDES.forEach(function (side) {
      var s = FeatherCalc.suggestImplants(w.meas, side);
      var stillValid = w.selection[side] && s.results.some(function (r) { return r.implant.ref === w.selection[side]; });
      if (!stillValid) w.selection[side] = s.results.length ? s.results[0].implant.ref : null;
    });
  }

  function sideSelectionHtml(w, side, result) {
    if (!result) {
      return '<section class="card"><h3 class="meas-panel-title">' + esc(FeatherCalc.SIDE_LABELS[side]) +
        ' breast</h3><div class="empty-state">No implant selected for this side.</div></section>';
    }
    var i = result.implant;
    var html = '<section class="card">';
    html += '<div class="selection-head">';
    html += '<img src="' + esc(result.image) + '" alt="' + esc(i.shapeLabel) + '" class="selection-img" />';
    html += '<div><h3 class="meas-panel-title">' + esc(FeatherCalc.SIDE_LABELS[side]) + ' breast</h3>' +
      '<div class="muted">' + esc(i.rangeLabel) + ' &middot; ' + esc(i.shapeLabel) + '</div>' +
      '<div class="implant-ref">' + esc(i.ref) + '</div></div>';
    html += '</div>';

    html += '<table class="mt-1"><tbody>' +
      row('Order reference', '<strong>' + esc(i.ref) + '</strong>') +
      row('Shape', esc(i.shapeLabel) + ' (' + esc(i.shapeClass) + ')') +
      row('Projection class', esc(i.projectionLabel)) +
      row('Shell surface', esc(i.surfaceLabel)) +
      row('Width (A)', i.w + ' mm') +
      row('Height (C)', i.h + ' mm') +
      row('Projection (B)', i.p + ' mm') +
      row('Lower ventral curve', i.curve + ' mm') +
      row('Volume', '<strong>' + i.v + ' ml</strong>') +
      row('Vertical IMF Pos', result.vpos) +
      row('Required Skin', result.requiredSkin.lower + ' &ndash; ~' + result.requiredSkin.upper + ' cm (upper bound estimated)') +
      '</tbody></table>';

    html += '<h4 class="mt-2">Model implants needed to try on</h4>';
    html += '<div class="muted mb-1">Physical trial/sizer implants for the in-clinic fitting preview, ranked closest to ' + i.v + ' ml.</div>';
    result.sizerOptions.forEach(function (opt, idx) {
      var chosen = w.chosenSizer[side] === idx;
      html += '<div class="sizer-row ' + (idx === 0 ? 'best' : '') + (chosen ? ' chosen' : '') + '" data-sizer="' + idx + '" data-side="' + side + '">' +
        '<div class="rank">#' + (idx + 1) + '</div>' +
        '<div class="pieces">' + opt.pieces.map(function (p) { return '<span class="sizer-piece">' + esc(p.code) + ' &middot; ' + p.vol + 'ml</span>'; }).join('') + '</div>' +
        '<div><strong>' + opt.total + ' ml</strong> <span class="muted">(&Delta;' + opt.diff + ')</span></div>' +
        (chosen ? '<span class="pill success">Selected</span>' : '') +
        '</div>';
    });
    html += '</section>';
    return html;
  }

  function drawStepSelection() {
    var w = state.wizard;
    ensureSelection(w);
    var full = FeatherCalc.computeConsultation(w.meas, w.selection);
    w._lastResult = full;

    var left = full.sides.left.result;
    var right = full.sides.right.result;

    var html = '<div class="card">' + widthControlHtml(w.meas) + '</div>';

    if (full.symmetry) {
      html += '<div class="symmetry-bar' + (full.symmetry.matched ? ' matched' : '') + '">' +
        '<span class="symmetry-label">Planned result</span>' +
        '<span>Left <strong>' + left.implant.v + ' ml</strong> / ' + left.implant.w + ' mm</span>' +
        '<span>Right <strong>' + right.implant.v + ' ml</strong> / ' + right.implant.w + ' mm</span>' +
        '<span class="muted">' + (full.symmetry.matched
          ? 'Identical implants both sides'
          : 'Difference: ' + full.symmetry.volumeDiff + ' ml, ' + full.symmetry.widthDiff + ' mm') + '</span>' +
        '</div>';
    }

    html += warningsHtml(allWarnings(w, left && left.implant, right && right.implant));

    html += '<div class="meas-columns">';
    FeatherCalc.SIDES.forEach(function (side) {
      html += sideSelectionHtml(w, side, full.sides[side].result);
    });
    html += '</div>';

    html += '<div class="card mt-2"><label for="finalNotes">Consultation notes</label><textarea id="finalNotes" rows="3">' + esc(w.notes) + '</textarea>' +
      '<div class="field mt-1"><label>Status</label><select id="statusSelect">' +
      ['draft', 'completed', 'implant_selected'].map(function (s) { return '<option value="' + s + '" ' + (w.status === s ? 'selected' : '') + '>' + s.replace('_', ' ') + '</option>'; }).join('') +
      '</select></div></div>';

    html += '<div class="mt-2" style="display:flex; gap:0.6em;"><button class="btn secondary" id="toSuggestionsStep">Back</button><button class="btn" id="saveConsult">Save consultation</button></div>';

    qs('#wizardBody').innerHTML = html;
    qsa('[data-sizer]').forEach(function (el) {
      el.addEventListener('click', function () {
        w.notes = qs('#finalNotes').value;
        w.chosenSizer[el.dataset.side] = Number(el.dataset.sizer);
        drawStepSelection();
      });
    });
    wireWidthControl(w.meas, function () { w.selection = { left: null, right: null }; drawStepSelection(); });
    qs('#toSuggestionsStep').addEventListener('click', function () { w.step = 3; drawWizard(); });
    qs('#saveConsult').addEventListener('click', function () {
      w.notes = qs('#finalNotes').value;
      w.status = qs('#statusSelect').value;
      var body = {
        patientId: w.patient.id,
        meas: w.meas,
        selection: w.selection,
        chosenSizer: w.chosenSizer,
        notes: w.notes,
        status: w.status
      };
      var req = w.consultationId
        ? api('/api/consultations/' + w.consultationId, { method: 'PUT', body: body })
        : api('/api/consultations', { method: 'POST', body: body });
      req.then(function () {
        toast('Consultation saved');
        navigate('patients/' + w.patient.id);
      });
    });
  }

  function row(label, value) { return '<tr><td class="muted">' + esc(label) + '</td><td>' + value + '</td></tr>'; }

  // ---------------- Appointments ----------------
  function appointmentsTable(appts, withActions) {
    var rows = appts.map(function (a) {
      var statusPill = { confirmed: 'success', pending: 'warning', cancelled: 'danger' }[a.status] || '';
      return '<tr>' +
        '<td>' + esc(a.date) + ' ' + esc(a.time) + '</td>' +
        '<td>' + esc(a.patientName || 'TBD') + '</td>' +
        '<td class="muted">' + esc(a.type) + '</td>' +
        '<td><span class="pill ' + statusPill + '">' + esc(a.status) + '</span></td>' +
        (withActions ? '<td class="text-right">' +
          '<button class="btn small secondary" data-confirm="' + a.id + '">Confirm</button> ' +
          '<button class="btn small danger" data-cancel="' + a.id + '">Cancel</button></td>' : '') +
        '</tr>';
    }).join('');
    return '<table><thead><tr><th>When</th><th>Patient</th><th>Type</th><th>Status</th>' + (withActions ? '<th></th>' : '') + '</tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function renderAppointments() {
    setView('<div class="empty-state">Loading appointments&hellip;</div>');
    Promise.all([api('/api/appointments'), api('/api/patients')]).then(function (res) {
      var appts = res[0].slice().sort(function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time); });
      var patients = res[1];
      var html = pageHeader('Appointments', appts.length + ' scheduled', '<button class="btn" id="newApptBtn">+ New appointment</button>');
      html += '<div class="card">' + (appts.length ? appointmentsTable(appts, true) : '<div class="empty-state">No appointments yet.</div>') + '</div>';
      setView(html);

      qs('#newApptBtn').addEventListener('click', function () { openAppointmentModal(patients); });
      qsa('[data-confirm]').forEach(function (b) {
        b.addEventListener('click', function () { api('/api/appointments/' + b.dataset.confirm, { method: 'PUT', body: { status: 'confirmed' } }).then(renderAppointments); });
      });
      qsa('[data-cancel]').forEach(function (b) {
        b.addEventListener('click', function () { api('/api/appointments/' + b.dataset.cancel, { method: 'PUT', body: { status: 'cancelled' } }).then(renderAppointments); });
      });
    });
  }

  function openAppointmentModal(patients) {
    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = '<div class="modal">' +
      '<h3>New appointment</h3>' +
      '<div class="field"><label>Patient</label><select id="apPatient"><option value="">Unassigned / TBD</option>' +
      patients.map(function (p) { return '<option value="' + p.id + '">' + esc(p.firstName + ' ' + p.lastName) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field-row"><div class="field"><label>Date</label><input type="date" id="apDate" /></div><div class="field"><label>Time</label><input type="time" id="apTime" /></div></div>' +
      '<div class="field"><label>Type</label><input type="text" id="apType" value="Sizing consultation" /></div>' +
      '<div class="field"><label>Notes</label><textarea id="apNotes" rows="2"></textarea></div>' +
      '<div style="display:flex; gap:0.6em; justify-content:flex-end;"><button class="btn secondary" id="apCancel">Cancel</button><button class="btn" id="apSave">Create</button></div>' +
      '</div>';
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', function (e) { if (e.target === backdrop) backdrop.remove(); });
    qs('#apCancel', backdrop).addEventListener('click', function () { backdrop.remove(); });
    qs('#apSave', backdrop).addEventListener('click', function () {
      var body = {
        patientId: qs('#apPatient', backdrop).value || null,
        date: qs('#apDate', backdrop).value,
        time: qs('#apTime', backdrop).value,
        type: qs('#apType', backdrop).value,
        notes: qs('#apNotes', backdrop).value
      };
      if (!body.date || !body.time) { toast('Date and time are required'); return; }
      api('/api/appointments', { method: 'POST', body: body }).then(function () {
        backdrop.remove();
        toast('Appointment created');
        renderAppointments();
      });
    });
  }

  // ---------------- Reports ----------------
  function renderReports() {
    setView('<div class="empty-state">Loading reports&hellip;</div>');
    api('/api/reports/summary').then(function (s) {
      var html = pageHeader('Reports', 'Activity overview');
      html += '<div class="grid cols-4 mb-2">' +
        statCard(s.totals.patients, 'Patients') +
        statCard(s.totals.consultations, 'Consultations') +
        statCard(s.totals.appointments, 'Appointments') +
        statCard(s.totals.avgVolumeSelected ? s.totals.avgVolumeSelected + ' ml' : '&mdash;', 'Avg. volume selected') +
        '</div>';

      html += '<div class="grid cols-2">';
      html += '<div class="card"><h3>Top implant families</h3>' + topImplantsHtml(s.topImplants) + '</div>';
      html += '<div class="card"><h3>Per-doctor activity</h3>' + perDoctorHtml(s.perDoctor) + '</div>';
      html += '</div>';
      setView(html);
    });
  }

  function topImplantsHtml(list) {
    if (!list.length) return '<div class="empty-state">No consultations yet.</div>';
    var max = Math.max.apply(null, list.map(function (l) { return l.count; }));
    return list.map(function (l) {
      var pct = Math.round((l.count / max) * 100);
      return '<div class="mb-1"><div style="display:flex; justify-content:space-between;"><span>' + esc(l.label) + '</span><strong>' + l.count + '</strong></div>' +
        '<div class="tissue-bar"><div style="width:' + pct + '%;"></div></div></div>';
    }).join('');
  }

  function perDoctorHtml(list) {
    var rows = list.map(function (d) {
      return '<tr><td>' + esc(d.name) + '<div class="muted">' + esc(d.clinic) + '</div></td><td>' + d.patients + '</td><td>' + d.consultations + '</td><td>' + d.appointments + '</td></tr>';
    }).join('');
    return '<table><thead><tr><th>Doctor</th><th>Patients</th><th>Consultations</th><th>Appts</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  boot();
})();
