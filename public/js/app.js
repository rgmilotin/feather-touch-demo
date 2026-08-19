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

  function familyImage(family, shell) {
    return '/polytech-images/' + (Number(shell) === 1 ? 'M' : 'T') + family + '.png';
  }

  var DEFAULT_MEAS = { cw: '27', st: '0.5', dimd: '3', stup: '0.5', upperpole: 0, bh: '9.5', pp: '1.0', cnimf: '4.5', size: 0, dev: 0, shell: 0, desiredImd: '3', manualWidth: null };

  // Each entry drives both the inline field label and the rich hover/focus help
  // popover (see helpIcon()). `hint` stays short -- it is also reused as an inline
  // muted caption on a couple of fields (e.g. the IMD slider). `desc`, `howTo` and
  // `range` are the longer copy shown inside the popover: what the measurement is,
  // how a surgeon actually takes it, and what most patients fall into.
  var HELP_FIELDS = {
    cw: {
      label: 'Chest Width', help: 'help_cw.png',
      hint: 'Chest width measurement (cm).',
      desc: 'The horizontal base width of the chest wall at the level of the inframammary fold -- the anatomical footprint the implant has to sit on.',
      howTo: 'Patient supine, arms relaxed at the sides. Measure with calipers or a flexible tape from the anterior axillary line to the anterior axillary line (or sternal midline to axillary line, then double it), at the level of the IMF.',
      range: 'Most adult patients fall between 24-30 cm; the demo default (27 cm) sits in the middle of that range.'
    },
    st: {
      label: 'Soft Tissue', help: 'help_st.png',
      hint: 'Soft tissue thickness over the lower pole (cm).',
      desc: 'How much of the surgeon\'s own soft tissue (skin + subcutaneous fat, not gland) covers the lower pole -- the single biggest driver of rippling/wrinkling risk with any implant.',
      howTo: 'Pinch test: gently pinch the skin and subcutaneous fat over the lower pole between thumb and forefinger and measure the fold thickness (this captures roughly half the true tissue thickness).',
      range: 'Typically 0.5-2.5 cm. Under 1 cm is considered thin (higher rippling risk, favours a more cohesive/textured implant); over 2 cm is thick tissue.'
    },
    dimd: {
      label: 'Cleavage', help: 'help_dimd.png',
      hint: 'Inter-mammary distance (cm).',
      desc: 'The starting inter-mammary distance -- the gap between the breasts at the sternum before surgery -- used here as a discrete preset rather than a free measurement.',
      howTo: 'Measure the horizontal distance between the medial borders of the two breast mounds at the sternum, patient upright, and round to the nearest preset (3 / 4 / 5 cm).',
      range: 'Most patients land on 3-5 cm; narrower values suit patients who want closer cleavage, wider values suit a broader chest anatomy.',
      options: ['3', '4', '5']
    },
    stup: {
      label: 'Soft Tissue Upper Pole', help: 'help_stup.png',
      hint: 'Soft tissue thickness over the upper pole (cm).',
      desc: 'The same pinch-test measurement as Soft Tissue, but taken over the upper pole / décolletage -- generally thinner tissue, so it drives visibility of the implant\'s upper edge.',
      howTo: 'Pinch test over the upper pole (just below the clavicle line, above the gland), patient upright, arms relaxed.',
      range: 'Usually 0.3-1.5 cm -- typically thinner than the lower-pole reading for the same patient.'
    },
    upperpole: {
      label: 'Desired Upper Pole', help: 'help_upperpole.png',
      hint: 'Natural favours anatomic implants; Full favours round implants.',
      desc: 'The patient\'s aesthetic goal for the upper breast contour, not a physical measurement -- it steers which implant families (anatomic vs. round) are recommended.',
      howTo: 'Discussed directly with the patient during consultation, often with photos/sizers as reference, rather than measured with any instrument.',
      range: 'Most patients today choose a "Natural" sloped upper pole; "Full" is chosen when a fuller, more visibly augmented look is the goal.',
      options: [{ v: 0, label: 'Natural' }, { v: 1, label: 'Full' }]
    },
    bh: {
      label: 'Desired Breast Height', help: 'help_bh.png',
      hint: 'Desired final breast height (cm).',
      desc: 'The target vertical height of the breast mound after surgery, from the upper breast border down to the inframammary fold.',
      howTo: 'Estimated together with the patient (often against a sizer or reference photos) rather than measured on the pre-op chest directly, since it describes the desired post-op result.',
      range: 'Commonly requested between 8-11 cm depending on chest size and desired volume.'
    },
    pp: {
      label: 'Parenchyma', help: 'help_pp.png',
      hint: 'Existing glandular tissue thickness (cm).',
      desc: 'The thickness of the patient\'s own existing glandular (breast) tissue at the lower pole -- separate from soft tissue/fat, and a key input for how much implant edge the gland can camouflage.',
      howTo: 'Pinch test isolating the glandular tissue at the lower pole, patient upright; compare against the desired IMD to flag symmastia risk if the pockets would leave too little medial support.',
      range: 'Typically 1-3 cm. Under 1 cm is thin parenchyma (higher risk of implant edge visibility/palpability).'
    },
    cnimf: {
      label: 'Lower Pole Skin', help: 'help_cnimf.png',
      hint: 'Lower pole skin stretch / nipple-to-IMF distance (cm).',
      desc: 'The stretched nipple-to-inframammary-fold distance -- a measure of how much the lower pole skin envelope can already expand, which caps how much projection/height a given patient\'s skin can safely accommodate.',
      howTo: 'With the tissue gently stretched (not resting), measure from the nipple to the inframammary fold along the lower pole, patient upright.',
      range: 'Usually 4-9 cm; higher values indicate more skin laxity (often seen with mild ptosis or after weight change/pregnancy).'
    },
    size: {
      label: 'Desired Breast Increase', help: 'help_size.png',
      hint: 'Overall desired size increase.',
      desc: 'The patient\'s overall preference for how much larger the breasts should look post-op -- a preference input, not a physical measurement.',
      howTo: 'Discussed with the patient, often anchored against trial/sizer implants during the fitting so the choice reflects how the result actually looks and feels, not just a number.',
      range: 'Most consultations settle on "Medium" for a proportional result; "Large" is chosen when a more dramatic increase is the explicit goal.',
      options: [{ v: 0, label: 'Medium' }, { v: 1, label: 'Large' }]
    },
    desiredImd: {
      label: 'Desired Intermammary Distance (IMD)',
      hint: 'Desired postoperative gap between the medial edges of the breasts (cm) -- the surgical-planning term for "distance between breasts". Compared against pre-op Parenchyma to flag symmastia risk if the pockets would be left with too little medial support.',
      desc: 'The target postoperative gap between the medial edges of the breasts -- the surgical-planning term for "distance between breasts" once healed.',
      howTo: 'Set jointly with the patient (this field is a planning target, not measured on the pre-op chest); it is compared against the pre-op Parenchyma reading to flag symmastia risk.',
      range: 'Most plans target 1.5-4 cm; below ~1.5 cm the pockets may be left with too little medial support, risking symmastia.'
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

      setView(html);
      qs('#newConsultBtn').addEventListener('click', function () { navigate('patients/' + p.id + '/consult'); });
      wireConsultationCards(p);
      wirePhotosCard(p);
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
      '<div style="display:flex; justify-content:space-between; align-items:flex-start;">' +
      '<div><strong>' + fmtDate(c.date) + '</strong> &middot; <span class="pill ' + statusPill + '">' + esc((c.status || '').replace('_', ' ')) + '</span></div>' +
      (comp ? '<div class="pill accent">' + esc(comp.family) + '</div>' : '') +
      '</div>';
    if (comp) {
      body += '<div class="muted mt-1">' + esc(comp.familyLabel) + ' &middot; A:' + comp.implant.w + ' C:' + comp.implant.h + ' B:' + comp.implant.p.toFixed(1) + ' D:' + comp.implant.d + ' &middot; <strong>' + comp.implant.v + ' ml</strong></div>';
      body += '<div class="muted">Trial sizer needed: <strong>' + esc(comp.topSizer.label) + '</strong></div>';
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
      state.wizard = {
        patient: patient,
        consultationId: consultationId || null,
        step: existing ? 2 : 1,
        meas: existing ? shallowCopy(existing.meas) : shallowCopy(DEFAULT_MEAS),
        family: existing ? (existing.family || null) : null,
        chosenSizer: existing && existing.chosenSizer !== undefined ? existing.chosenSizer : null,
        chosenImplant: existing ? existing.chosenImplant : null,
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
  function helpIcon(key) {
    var f = HELP_FIELDS[key];
    if (!f || !f.help) return '';
    var img = '/polytech-images/' + f.help;
    return '<span class="help-trigger" tabindex="0">' +
      '<img class="help-icon" src="' + img + '" alt="" />' +
      '<span class="help-popover">' +
      '<img class="help-popover-img" src="' + img + '" alt="How to take the ' + esc(f.label) + ' measurement" />' +
      '<span class="help-popover-body">' +
      '<strong class="help-popover-title">' + esc(f.label) + '</strong>' +
      (f.desc ? '<span class="help-popover-section">' + esc(f.desc) + '</span>' : '') +
      (f.howTo ? '<span class="help-popover-section"><strong>How to measure:</strong> ' + esc(f.howTo) + '</span>' : '') +
      (f.range ? '<span class="help-popover-section help-popover-range"><strong>Typical range:</strong> ' + esc(f.range) + '</span>' : '') +
      '</span></span></span>';
  }

  function drawStepMeasurements() {
    var w = state.wizard;
    var m = w.meas;
    var html = '<div class="card" style="max-width:760px;">';

    html += '<div class="field-row">';
    html += numField('cw', m.cw);
    html += numField('st', m.st);
    html += '</div>';
    html += '<div class="field-row">';
    html += numField('stup', m.stup);
    html += numField('bh', m.bh);
    html += '</div>';
    html += '<div class="field-row">';
    html += numField('pp', m.pp);
    html += numField('cnimf', m.cnimf);
    html += '</div>';

    html += radioField('dimd', m.dimd, HELP_FIELDS.dimd.options.map(function (o) { return { v: o, label: o + ' cm' }; }));
    html += radioField('upperpole', String(m.upperpole), HELP_FIELDS.upperpole.options.map(function (o) { return { v: String(o.v), label: o.label }; }));
    html += radioField('size', String(m.size), HELP_FIELDS.size.options.map(function (o) { return { v: String(o.v), label: o.label }; }));
    html += imdSliderHtml(m);

    html += '<div class="field"><label>Shell surface</label><div class="radio-group" id="shellGroup">' +
      '<label class="' + (Number(m.shell) === 0 ? 'active' : '') + '"><input type="radio" name="shell" value="0" ' + (Number(m.shell) === 0 ? 'checked' : '') + '/> Textured (T)</label>' +
      '<label class="' + (Number(m.shell) === 1 ? 'active' : '') + '"><input type="radio" name="shell" value="1" ' + (Number(m.shell) === 1 ? 'checked' : '') + '/> Micro (M)</label>' +
      '</div></div>';

    html += '<hr style="border:none; border-top:1px solid var(--color-border); margin:1.4em 0;" />';
    html += widthControlHtml(m);
    html += '<div class="muted" style="font-size:0.82em; margin-top:-0.6em; margin-bottom:1.1em;">Leave on auto to derive the width from the measurements above, or drag to manually override it -- exactly like the desktop app\'s Implant Width slider. The recommended implants and trial sizers on the next steps follow whichever value is active.</div>';

    html += '<div class="field"><label for="notesField">Notes</label><textarea id="notesField" rows="2">' + esc(w.notes) + '</textarea></div>';

    html += '<div style="display:flex; gap:0.6em;"><button class="btn secondary" id="toPatientStep">Back</button><button class="btn" id="toSuggestions">See suggestions</button></div>';
    html += '</div>';

    qs('#wizardBody').innerHTML = html;

    qsa('#wizardBody input[type=text], #wizardBody input[type=number]').forEach(function (inp) {
      inp.addEventListener('input', function () { m[inp.dataset.field] = inp.value; });
    });
    qsa('#wizardBody input[type=radio]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var name = inp.name;
        m[name] = Number(inp.value);
        qsa('input[name="' + name + '"]').forEach(function (r) { r.closest('label').classList.toggle('active', r.checked); });
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
  function widthControlHtml(m) {
    var auto = FeatherCalc.updateWidth(m);
    var current = FeatherCalc.resolveWidth(m);
    var isManual = m.manualWidth !== null && m.manualWidth !== undefined && m.manualWidth !== '';
    return '<div class="field width-control">' +
      '<label>Implant Width (A) ' + (isManual ?
        '<span class="pill warning">Manual override</span>' :
        '<span class="pill accent">Auto, from measurements</span>') + '</label>' +
      '<div style="display:flex; align-items:center; gap:0.8em; flex-wrap:wrap;">' +
      '<input type="range" id="widthSlider" min="96" max="136" step="4" value="' + current + '" style="flex:1 1 200px;" />' +
      '<strong style="min-width:4.5em; text-align:right;">' + current + ' mm</strong>' +
      (isManual ? '<button type="button" class="btn secondary small" id="widthReset">Reset to auto (' + auto + 'mm)</button>' : '') +
      '</div></div>';
  }

  // `onCommit` fires once the slider is released (the 'change' event) rather than on
  // every 'input' tick, which would otherwise force a full step redraw mid-drag and
  // make the slider thumb lose mouse capture. The mm readout still updates live.
  function wireWidthControl(m, onCommit) {
    var slider = qs('#widthSlider');
    if (slider) {
      var label = slider.parentNode.querySelector('strong');
      slider.addEventListener('input', function () {
        if (label) label.textContent = slider.value + ' mm';
      });
      slider.addEventListener('change', function () {
        m.manualWidth = Number(slider.value);
        onCommit();
      });
    }
    var resetBtn = qs('#widthReset');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        m.manualWidth = null;
        onCommit();
      });
    }
  }

  // ---------------------------- Advisory risk warnings ----------------------------
  function warningsHtml(warnings) {
    if (!warnings || !warnings.length) return '';
    return '<div class="warnings-panel">' + warnings.map(function (w) {
      return '<div class="warning-banner ' + esc(w.severity) + '">' +
        '<div class="warning-title">' + esc(w.title) + '</div>' +
        '<div class="warning-msg">' + esc(w.message) + '</div>' +
        '</div>';
    }).join('') + '</div>';
  }

  function drawStepSuggestions() {
    var w = state.wizard;
    var gallery = FeatherCalc.computeAllFamilies(w.meas);
    if (!w.family) w.family = gallery.recommendedFamily;

    var html = '<div class="card" style="max-width:760px;">' + widthControlHtml(w.meas) + '</div>';
    html += '<div class="mb-1 mt-1 muted">Derived implant width: <strong>' + gallery.width + ' mm</strong>. All six families shown below share this width -- pick the recommended card or compare another family.</div>';
    html += '<div class="grid cols-3">';
    Object.keys(gallery.families).forEach(function (fam) {
      var implant = gallery.families[fam];
      var recommended = fam === gallery.recommendedFamily;
      var selected = fam === w.family;
      html += '<div class="family-card ' + (recommended ? 'recommended' : '') + ' ' + (selected ? 'selected' : '') + '" data-fam="' + fam + '">' +
        (recommended ? '<span class="badge pill accent">Recommended</span>' : '') +
        '<img src="' + familyImage(fam, w.meas.shell) + '" alt="' + fam + '" />' +
        '<h4>' + esc(FeatherCalc.FAMILY_LABELS[fam]) + '</h4>' +
        '<div class="volume">' + implant.v + ' ml</div>' +
        '<div class="figures">A:' + implant.w + ' &middot; C:' + implant.h + ' &middot; B:' + implant.p.toFixed(1) + ' &middot; D:' + implant.d + '</div>' +
        '</div>';
    });
    html += '</div>';
    html += warningsHtml(FeatherCalc.evaluateWarnings(w.meas, { implant: gallery.families[w.family], width: gallery.width }));
    html += '<div class="mt-2" style="display:flex; gap:0.6em;"><button class="btn secondary" id="toMeasStep">Back</button><button class="btn" id="toSelection">Continue with ' + esc(w.family) + '</button></div>';

    qs('#wizardBody').innerHTML = html;
    qsa('.family-card').forEach(function (card) {
      card.addEventListener('click', function () {
        w.family = card.dataset.fam;
        drawStepSuggestions();
      });
    });
    wireWidthControl(w.meas, function () { drawStepSuggestions(); });
    qs('#toMeasStep').addEventListener('click', function () { w.step = 2; drawWizard(); });
    qs('#toSelection').addEventListener('click', function () { w.step = 4; drawWizard(); });
  }

  function drawStepSelection() {
    var w = state.wizard;
    var result = FeatherCalc.computeForFamily(w.meas, w.family);
    w._lastResult = result;

    var html = '<div class="card" style="max-width:760px;">' + widthControlHtml(w.meas) + '</div>';
    html += warningsHtml(FeatherCalc.evaluateWarnings(w.meas, result));
    html += '<div class="grid cols-2">';

    html += '<div class="card">';
    html += '<div style="display:flex; gap:1em; align-items:center;">';
    html += '<img src="' + familyImage(w.family, w.meas.shell) + '" style="width:110px;height:110px;object-fit:contain;background:var(--color-surface-alt);border-radius:12px;" />';
    html += '<div><h3 style="margin-bottom:0.1em;">' + esc(result.familyLabel) + '</h3><div class="muted">' + esc(result.implant.family_name) + '</div></div>';
    html += '</div>';
    html += '<table class="mt-1"><tbody>' +
      row('Width (A)', result.implant.w + ' mm') +
      row('Height (C)', result.implant.h + ' mm') +
      row('Projection (B)', result.implant.p.toFixed(1) + ' mm') +
      row('D:ILPC', result.implant.d) +
      row('Volume', '<strong>' + result.implant.v + ' ml</strong>') +
      row('Vertical IMF Pos', result.vpos) +
      row('Required Skin', result.requiredSkin.lower + ' &ndash; ~' + result.requiredSkin.upper + ' cm (upper bound estimated)') +
      '</tbody></table>';
    if (result.implant2) {
      html += '<div class="muted mt-1">One size down (' + result.implant2.w + 'mm): ' + result.implant2.v + ' ml, D:' + result.implant2.d + '</div>';
    }
    html += '</div>';

    html += '<div class="card">';
    html += '<h3>Model implants needed to try on</h3>';
    html += '<div class="muted mb-1">Physical trial/sizer implants for the in-clinic fitting preview, ranked closest to the target volume of ' + result.implant.v + ' ml.</div>';
    result.sizerOptions.forEach(function (opt, i) {
      var chosen = w.chosenSizer === i;
      html += '<div class="sizer-row ' + (i === 0 ? 'best' : '') + '" data-sizer="' + i + '" style="cursor:pointer; ' + (chosen ? 'outline:2px solid var(--color-primary);' : '') + '">' +
        '<div class="rank">#' + (i + 1) + '</div>' +
        '<div class="pieces">' + opt.pieces.map(function (p) { return '<span class="sizer-piece">' + esc(p.code) + ' &middot; ' + p.vol + 'ml</span>'; }).join('') + '</div>' +
        '<div><strong>' + opt.total + ' ml</strong> <span class="muted">(&Delta;' + opt.diff + ')</span></div>' +
        (chosen ? '<span class="pill success">Selected</span>' : '') +
        '</div>';
    });
    html += '</div>';

    html += '</div>'; // grid

    html += '<div class="card mt-2"><label for="finalNotes">Consultation notes</label><textarea id="finalNotes" rows="3">' + esc(w.notes) + '</textarea>' +
      '<div class="field mt-1"><label>Status</label><select id="statusSelect">' +
      ['draft', 'completed', 'implant_selected'].map(function (s) { return '<option value="' + s + '" ' + (w.status === s ? 'selected' : '') + '>' + s.replace('_', ' ') + '</option>'; }).join('') +
      '</select></div></div>';

    html += '<div class="mt-2" style="display:flex; gap:0.6em;"><button class="btn secondary" id="toSuggestionsStep">Back</button><button class="btn" id="saveConsult">Save consultation</button></div>';

    qs('#wizardBody').innerHTML = html;
    qsa('[data-sizer]').forEach(function (row) {
      row.addEventListener('click', function () { w.chosenSizer = Number(row.dataset.sizer); drawStepSelection(); });
    });
    wireWidthControl(w.meas, function () { drawStepSelection(); });
    qs('#toSuggestionsStep').addEventListener('click', function () { w.step = 3; drawWizard(); });
    qs('#saveConsult').addEventListener('click', function () {
      w.notes = qs('#finalNotes').value;
      w.status = qs('#statusSelect').value;
      var body = { patientId: w.patient.id, meas: w.meas, family: w.family, chosenSizer: w.chosenSizer, chosenImplant: w.chosenImplant, notes: w.notes, status: w.status };
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
