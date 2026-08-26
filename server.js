/*
 * Feather Touch demo server.
 * Zero external dependencies -- only Node's built-in modules -- so this runs with
 * just `node server.js`, no `npm install` step required.
 *
 * Serves the static frontend (public/) and a small JSON REST API backed by a
 * JSON-file "database" (data/db.json, auto-seeded from data/seed.json on first run).
 */
'use strict';
var http = require('http');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var url = require('url');

var db = require('./lib/db.js');
var calc = require('./lib/calc.js');
var pptxLib = require('./lib/pptx.js');

var PORT = process.env.PORT || 4173;
var PUBLIC_DIR = path.join(__dirname, 'public');
var ASSETS_DIR = path.join(__dirname, 'assets');
// These three asset sets default to a local assets/ folder inside the project, so a
// zipped copy of this whole folder runs standalone on any machine with no setup.
// On the original dev machine they can instead point at the external source folders
// via env vars (handy for iterating on-the-fly against the live Polytech/BioDynamic/
// Logo archives without recopying files into assets/ each time).
//
// Original Polytech desktop app image assets (implant family diagrams, help icons,
// torso reference photos). Default: assets/polytech-images/.
var EXTERNAL_IMAGES_DIR = process.env.POLYTECH_IMAGES_DIR || path.join(ASSETS_DIR, 'polytech-images');
// Demo before/after photo set (fake patient "p0000004") used to showcase the patient
// photo gallery and before/after PPTX export without requiring real patient photos.
// Default: assets/biodynamic-photos/<phase>/.
var BIODYNAMIC_PHOTOS_DIR = process.env.BIODYNAMIC_PHOTOS_DIR || path.join(ASSETS_DIR, 'biodynamic-photos');
var DEMO_PHASE_DIRS = { before: '2007-10-30', after: '2008-03-31' };
// Official Feather Touch brand package (logo lockups, light/dark variants).
// Default: assets/brand/.
var BRAND_ASSETS_DIR = process.env.BRAND_ASSETS_DIR || path.join(ASSETS_DIR, 'brand');
// Doctor-uploaded patient photos are stored locally, one subfolder per patient.
var PHOTOS_DIR = path.join(__dirname, 'data', 'photos');

// ---- sessions (in-memory; fine for a local demo) ----
var sessions = {}; // token -> userId

function newToken() {
  return crypto.randomBytes(24).toString('hex');
}

function parseCookies(req) {
  var out = {};
  var header = req.headers.cookie;
  if (!header) return out;
  header.split(';').forEach(function (part) {
    var idx = part.indexOf('=');
    if (idx === -1) return;
    var k = part.slice(0, idx).trim();
    var v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  });
  return out;
}

function getCurrentUser(req) {
  var cookies = parseCookies(req);
  var token = cookies.ft_session;
  if (!token || !sessions[token]) return null;
  var data = db.load();
  var user = data.users.find(function (u) { return u.id === sessions[token]; });
  return user || null;
}

// ---- response helpers ----
function sendJson(res, status, obj) {
  var body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function readBody(req, cb) {
  var chunks = [];
  req.on('data', function (c) { chunks.push(c); });
  req.on('end', function () {
    var raw = Buffer.concat(chunks).toString('utf8');
    if (!raw) return cb(null, {});
    try {
      cb(null, JSON.parse(raw));
    } catch (e) {
      cb(e);
    }
  });
}

var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml'
};

function serveStatic(req, res, pathname) {
  // Serve the shared sizing engine and implant catalogue straight from lib/ so there
  // is exactly one copy of each used by both the server and the browser.
  var SHARED_LIB = { '/js/calc.js': 'calc.js', '/js/implants.js': 'implants.js' };
  if (SHARED_LIB[pathname]) {
    fs.readFile(path.join(__dirname, 'lib', SHARED_LIB[pathname]), function (err, data) {
      if (err) return sendError(res, 404, 'Not found');
      res.writeHead(200, { 'Content-Type': MIME['.js'] });
      res.end(data);
    });
    return;
  }

  if (pathname.indexOf('/polytech-images/') === 0) {
    var name = path.basename(pathname); // strip to filename only -- no traversal
    var extPath = path.join(EXTERNAL_IMAGES_DIR, name);
    fs.readFile(extPath, function (err, data) {
      if (err) {
        sendError(res, 404, 'Image not found: ' + name);
        return;
      }
      var extension = path.extname(extPath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[extension] || 'application/octet-stream' });
      res.end(data);
    });
    return;
  }

  // Official brand assets (logo lockups): /brand/<file>, e.g. /brand/1.svg (light
  // background) or /brand/2.svg (dark background).
  if (pathname.indexOf('/brand/') === 0) {
    var brandName = path.basename(pathname); // strip to filename only -- no traversal
    var brandPath = path.join(BRAND_ASSETS_DIR, brandName);
    fs.readFile(brandPath, function (err, data) {
      if (err) {
        sendError(res, 404, 'Brand asset not found: ' + brandName);
        return;
      }
      var brandExt = path.extname(brandPath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[brandExt] || 'application/octet-stream' });
      res.end(data);
    });
    return;
  }

  // Demo before/after set: /demo-photos/before/<file> or /demo-photos/after/<file>.
  if (pathname.indexOf('/demo-photos/') === 0) {
    var demoParts = pathname.split('/').filter(Boolean); // ['demo-photos', phase, file]
    var phaseDir = DEMO_PHASE_DIRS[demoParts[1]];
    var demoName = path.basename(demoParts[2] || '');
    if (!phaseDir || !demoName) return sendError(res, 404, 'Not found');
    var demoPath = path.join(BIODYNAMIC_PHOTOS_DIR, phaseDir, demoName);
    fs.readFile(demoPath, function (err, data) {
      if (err) return sendError(res, 404, 'Demo photo not found: ' + demoName);
      var extension = path.extname(demoPath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[extension] || 'application/octet-stream' });
      res.end(data);
    });
    return;
  }

  // Doctor-uploaded patient photos: /patient-photos/<patientId>/<storedName>.
  if (pathname.indexOf('/patient-photos/') === 0) {
    var upParts = pathname.split('/').filter(Boolean); // ['patient-photos', patientId, storedName]
    var upPatientId = path.basename(upParts[1] || '');
    var upName = path.basename(upParts[2] || '');
    if (!upPatientId || !upName) return sendError(res, 404, 'Not found');
    var upPath = path.join(PHOTOS_DIR, upPatientId, upName);
    fs.readFile(upPath, function (err, data) {
      if (err) return sendError(res, 404, 'Photo not found: ' + upName);
      var extension = path.extname(upPath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[extension] || 'application/octet-stream' });
      res.end(data);
    });
    return;
  }

  var rel = pathname === '/' ? '/index.html' : pathname;
  var filePath = path.join(PUBLIC_DIR, rel);
  // prevent path traversal outside public/
  if (filePath.indexOf(PUBLIC_DIR) !== 0) {
    sendError(res, 403, 'Forbidden');
    return;
  }
  fs.readFile(filePath, function (err, data) {
    if (err) {
      sendError(res, 404, 'Not found');
      return;
    }
    var ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---- data helpers ----
function visiblePatients(data, user) {
  if (user.role === 'admin') return data.patients;
  return data.patients.filter(function (p) { return p.doctorId === user.id; });
}

// Recompute a stored consultation against the current catalogue and flatten it into
// the compact per-side shape the patient dossier / reports render from.
function enrichConsultation(c) {
  var computed = null;
  try {
    var full = calc.computeConsultation(c.meas || {}, c.selection || {});
    var sides = {};
    calc.SIDES.forEach(function (side) {
      var r = full.sides[side].result;
      if (!r) return;
      sides[side] = {
        ref: r.implant.ref,
        shapeLabel: r.implant.shapeLabel,
        rangeLabel: r.implant.rangeLabel,
        surfaceLabel: r.implant.surfaceLabel,
        projection: r.implant.projection,
        w: r.implant.w, h: r.implant.h, p: r.implant.p, v: r.implant.v,
        sizer: r.topSizer ? r.topSizer.label : null
      };
    });
    var any = sides.left || sides.right;
    computed = {
      sides: sides,
      rangeLabel: any ? any.rangeLabel : null,
      symmetry: full.symmetry,
      // Average of the two sides -- what the volume-based reports aggregate on.
      avgVolume: (sides.left && sides.right)
        ? Math.round((sides.left.v + sides.right.v) / 2)
        : (any ? any.v : null)
    };
  } catch (e) {
    computed = null;
  }
  var out = {};
  for (var k in c) out[k] = c[k];
  out.computed = computed;
  return out;
}

function findDoctorName(data, id) {
  var u = data.users.find(function (u) { return u.id === id; });
  return u ? u.name : 'Unknown';
}

function findPatientName(data, id) {
  var p = data.patients.find(function (p) { return p.id === id; });
  return p ? (p.firstName + ' ' + p.lastName) : null;
}

function photoUrl(photo) {
  if (photo.source === 'external') {
    return '/demo-photos/' + photo.phase + '/' + encodeURIComponent(photo.filename);
  }
  return '/patient-photos/' + photo.patientId + '/' + encodeURIComponent(photo.storedName);
}

function patientPhotos(data, patientId) {
  return data.photos
    .filter(function (ph) { return ph.patientId === patientId; })
    .map(function (ph) {
      var out = {};
      for (var k in ph) out[k] = ph[k];
      out.url = photoUrl(ph);
      return out;
    })
    .sort(function (a, b) { return (a.uploadedAt || '').localeCompare(b.uploadedAt || ''); });
}

// Decode a `data:<mime>;base64,<data>` URL into { buffer, ext }. Zero-dependency
// upload path -- the browser reads the file with FileReader and posts the data URL as
// JSON, so no multipart/form-data parsing is needed on the server.
var MIME_TO_EXT = { 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
function decodeDataUrl(dataUrl) {
  var m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || '');
  if (!m) return null;
  return { buffer: Buffer.from(m[2], 'base64'), ext: MIME_TO_EXT[m[1]] || '.jpg' };
}

// ---- API router ----
function api(req, res, pathname, query) {
  var method = req.method;

  if (pathname === '/api/login' && method === 'POST') {
    return readBody(req, function (err, body) {
      if (err) return sendError(res, 400, 'Invalid JSON');
      var data = db.load();
      var user = data.users.find(function (u) {
        return u.username === body.username && u.password === body.password;
      });
      if (!user) return sendError(res, 401, 'Invalid username or password');
      var token = newToken();
      sessions[token] = user.id;
      res.setHeader('Set-Cookie', 'ft_session=' + token + '; Path=/; HttpOnly; SameSite=Lax');
      sendJson(res, 200, { id: user.id, username: user.username, name: user.name, role: user.role, clinic: user.clinic });
    });
  }

  if (pathname === '/api/logout' && method === 'POST') {
    var cookies = parseCookies(req);
    if (cookies.ft_session) delete sessions[cookies.ft_session];
    res.setHeader('Set-Cookie', 'ft_session=; Path=/; HttpOnly; Max-Age=0');
    return sendJson(res, 200, { ok: true });
  }

  var user = getCurrentUser(req);

  if (pathname === '/api/me' && method === 'GET') {
    if (!user) return sendError(res, 401, 'Not authenticated');
    return sendJson(res, 200, { id: user.id, username: user.username, name: user.name, role: user.role, clinic: user.clinic });
  }

  if (!user) return sendError(res, 401, 'Not authenticated');

  // ---- compute (stateless, live wizard preview) ----
  // Returns the ranked catalogue suggestions for both breasts plus the resolved
  // result for whichever implant is selected on each side. The browser runs the same
  // engine locally (lib/calc.js is shared), so this endpoint exists for API clients
  // and as the server-side source of truth.
  if (pathname === '/api/compute' && method === 'POST') {
    return readBody(req, function (err, body) {
      if (err) return sendError(res, 400, 'Invalid JSON');
      try {
        var meas = body.meas || body || {};
        sendJson(res, 200, calc.computeConsultation(meas, body.selection || {}));
      } catch (e) {
        sendError(res, 400, 'Could not compute sizing: ' + e.message);
      }
    });
  }

  // ---- patients ----
  var m;
  if (pathname === '/api/patients' && method === 'GET') {
    var data = db.load();
    return sendJson(res, 200, visiblePatients(data, user));
  }

  if (pathname === '/api/patients' && method === 'POST') {
    return readBody(req, function (err, body) {
      if (err) return sendError(res, 400, 'Invalid JSON');
      var data = db.load();
      var patient = {
        id: db.uid('p'),
        doctorId: user.id,
        firstName: body.firstName || '',
        lastName: body.lastName || '',
        dob: body.dob || '',
        phone: body.phone || '',
        email: body.email || '',
        notes: body.notes || '',
        createdAt: new Date().toISOString()
      };
      data.patients.push(patient);
      db.save(data);
      sendJson(res, 201, patient);
    });
  }

  if ((m = pathname.match(/^\/api\/patients\/([^/]+)$/)) && method === 'GET') {
    var data = db.load();
    var patient = data.patients.find(function (p) { return p.id === m[1]; });
    if (!patient) return sendError(res, 404, 'Patient not found');
    if (user.role !== 'admin' && patient.doctorId !== user.id) return sendError(res, 403, 'Forbidden');
    var consultations = data.consultations
      .filter(function (c) { return c.patientId === patient.id; })
      .map(enrichConsultation);
    var appointments = data.appointments.filter(function (a) { return a.patientId === patient.id; });
    return sendJson(res, 200, { patient: patient, consultations: consultations, appointments: appointments });
  }

  if ((m = pathname.match(/^\/api\/patients\/([^/]+)$/)) && method === 'PUT') {
    return readBody(req, function (err, body) {
      if (err) return sendError(res, 400, 'Invalid JSON');
      var data = db.load();
      var patient = data.patients.find(function (p) { return p.id === m[1]; });
      if (!patient) return sendError(res, 404, 'Patient not found');
      if (user.role !== 'admin' && patient.doctorId !== user.id) return sendError(res, 403, 'Forbidden');
      ['firstName', 'lastName', 'dob', 'phone', 'email', 'notes'].forEach(function (k) {
        if (body[k] !== undefined) patient[k] = body[k];
      });
      db.save(data);
      sendJson(res, 200, patient);
    });
  }

  if ((m = pathname.match(/^\/api\/patients\/([^/]+)$/)) && method === 'DELETE') {
    var dataDel = db.load();
    var patientIdx = dataDel.patients.findIndex(function (p) { return p.id === m[1]; });
    if (patientIdx === -1) return sendError(res, 404, 'Patient not found');
    var patientDel = dataDel.patients[patientIdx];
    if (user.role !== 'admin' && patientDel.doctorId !== user.id) return sendError(res, 403, 'Forbidden');

    // Cascade: drop every record that references this patient, plus any uploaded
    // photo files on disk (external/demo photos live under assets/, untouched).
    dataDel.patients.splice(patientIdx, 1);
    dataDel.consultations = dataDel.consultations.filter(function (c) { return c.patientId !== patientDel.id; });
    dataDel.appointments = dataDel.appointments.filter(function (a) { return a.patientId !== patientDel.id; });
    dataDel.photos = dataDel.photos.filter(function (ph) { return ph.patientId !== patientDel.id; });
    db.save(dataDel);
    try { fs.rmSync(path.join(PHOTOS_DIR, patientDel.id), { recursive: true, force: true }); } catch (e) { /* nothing uploaded */ }

    return sendJson(res, 200, { ok: true });
  }

  // ---- patient photos (pre-op / post-op gallery) ----
  if ((m = pathname.match(/^\/api\/patients\/([^/]+)\/photos$/)) && method === 'GET') {
    var dataPh = db.load();
    var patientPh = dataPh.patients.find(function (p) { return p.id === m[1]; });
    if (!patientPh) return sendError(res, 404, 'Patient not found');
    if (user.role !== 'admin' && patientPh.doctorId !== user.id) return sendError(res, 403, 'Forbidden');
    return sendJson(res, 200, patientPhotos(dataPh, patientPh.id));
  }

  if ((m = pathname.match(/^\/api\/patients\/([^/]+)\/photos$/)) && method === 'POST') {
    return readBody(req, function (err, body) {
      if (err) return sendError(res, 400, 'Invalid JSON');
      var dataPh = db.load();
      var patientPh = dataPh.patients.find(function (p) { return p.id === m[1]; });
      if (!patientPh) return sendError(res, 404, 'Patient not found');
      if (user.role !== 'admin' && patientPh.doctorId !== user.id) return sendError(res, 403, 'Forbidden');
      if (body.phase !== 'before' && body.phase !== 'after') return sendError(res, 400, 'phase must be "before" or "after"');
      var decoded = decodeDataUrl(body.dataUrl);
      if (!decoded) return sendError(res, 400, 'Missing or invalid dataUrl (expected a data: URL)');

      var photoId = db.uid('photo');
      var storedName = photoId + decoded.ext;
      var dir = path.join(PHOTOS_DIR, patientPh.id);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, storedName), decoded.buffer);

      var photo = {
        id: photoId,
        patientId: patientPh.id,
        phase: body.phase,
        source: 'upload',
        filename: body.filename || storedName,
        storedName: storedName,
        uploadedAt: new Date().toISOString()
      };
      dataPh.photos.push(photo);
      db.save(dataPh);
      var out = {};
      for (var k in photo) out[k] = photo[k];
      out.url = photoUrl(photo);
      sendJson(res, 201, out);
    });
  }

  if ((m = pathname.match(/^\/api\/patients\/([^/]+)\/photos\/([^/]+)$/)) && method === 'DELETE') {
    var dataPh = db.load();
    var patientPh = dataPh.patients.find(function (p) { return p.id === m[1]; });
    if (!patientPh) return sendError(res, 404, 'Patient not found');
    if (user.role !== 'admin' && patientPh.doctorId !== user.id) return sendError(res, 403, 'Forbidden');
    var idx = dataPh.photos.findIndex(function (ph) { return ph.id === m[2] && ph.patientId === patientPh.id; });
    if (idx === -1) return sendError(res, 404, 'Photo not found');
    var removed = dataPh.photos[idx];
    dataPh.photos.splice(idx, 1);
    db.save(dataPh);
    if (removed.source === 'upload') {
      try { fs.unlinkSync(path.join(PHOTOS_DIR, removed.patientId, removed.storedName)); } catch (e) { /* already gone */ }
    }
    return sendJson(res, 200, { ok: true });
  }

  // ---- before/after PPTX export ----
  // Simple 3-slide deck (poster / before photos / after photos) built entirely from
  // the patient's photo gallery -- see lib/pptx.js for the zero-dependency writer.
  if ((m = pathname.match(/^\/api\/patients\/([^/]+)\/pptx$/)) && method === 'GET') {
    var dataPx = db.load();
    var patientPx = dataPx.patients.find(function (p) { return p.id === m[1]; });
    if (!patientPx) return sendError(res, 404, 'Patient not found');
    if (user.role !== 'admin' && patientPx.doctorId !== user.id) return sendError(res, 403, 'Forbidden');

    var rawPhotos = dataPx.photos.filter(function (ph) { return ph.patientId === patientPx.id; });
    var beforePhotos = rawPhotos.filter(function (ph) { return ph.phase === 'before'; });
    var afterPhotos = rawPhotos.filter(function (ph) { return ph.phase === 'after'; });
    if (!beforePhotos.length && !afterPhotos.length) {
      return sendError(res, 400, 'This patient has no photos on file yet -- add before/after photos first.');
    }

    function readPhotoBuffer(ph) {
      var filePath = ph.source === 'external'
        ? path.join(BIODYNAMIC_PHOTOS_DIR, DEMO_PHASE_DIRS[ph.phase], ph.filename)
        : path.join(PHOTOS_DIR, ph.patientId, ph.storedName);
      try {
        var buf = fs.readFileSync(filePath);
        var ext = path.extname(filePath).toLowerCase();
        return { buffer: buf, ext: ext === '.png' ? '.png' : '.jpeg' };
      } catch (e) {
        return null;
      }
    }

    var beforeImages = beforePhotos.map(readPhotoBuffer).filter(Boolean);
    var afterImages = afterPhotos.map(readPhotoBuffer).filter(Boolean);

    var logo = null;
    try {
      logo = { buffer: fs.readFileSync(path.join(EXTERNAL_IMAGES_DIR, 'logo_text.png')), ext: '.png' };
    } catch (e) {
      logo = null;
    }

    var doctor = dataPx.users.find(function (u) { return u.id === patientPx.doctorId; });
    var title = 'Feather Touch';
    var subtitle = 'Before & After — ' + patientPx.firstName + ' ' + patientPx.lastName;
    var meta = (doctor ? (doctor.name + ' · ' + doctor.clinic + ' · ') : '') +
      'Generated ' + new Date().toLocaleDateString('en-GB');

    try {
      var pptxBuf = pptxLib.buildBeforeAfterPptx({
        title: title, subtitle: subtitle, meta: meta, logo: logo,
        beforeImages: beforeImages, afterImages: afterImages
      });
      var fname = (patientPx.firstName + '_' + patientPx.lastName + '_before_after')
        .replace(/[^a-zA-Z0-9_-]+/g, '_') + '.pptx';
      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': 'attachment; filename="' + fname + '"',
        'Content-Length': pptxBuf.length
      });
      res.end(pptxBuf);
    } catch (e) {
      sendError(res, 500, 'Could not generate PPTX: ' + e.message);
    }
    return;
  }

  // ---- consultations ----
  if (pathname === '/api/consultations' && method === 'GET') {
    var data = db.load();
    var patientIds = visiblePatients(data, user).map(function (p) { return p.id; });
    var list = data.consultations
      .filter(function (c) { return patientIds.indexOf(c.patientId) !== -1; })
      .map(enrichConsultation);
    return sendJson(res, 200, list);
  }

  if (pathname === '/api/consultations' && method === 'POST') {
    return readBody(req, function (err, body) {
      if (err) return sendError(res, 400, 'Invalid JSON');
      var data = db.load();
      var patient = data.patients.find(function (p) { return p.id === body.patientId; });
      if (!patient) return sendError(res, 400, 'Unknown patient');
      if (user.role !== 'admin' && patient.doctorId !== user.id) return sendError(res, 403, 'Forbidden');
      var consultation = {
        id: db.uid('c'),
        patientId: body.patientId,
        doctorId: user.id,
        date: body.date || new Date().toISOString(),
        status: body.status || 'draft',
        meas: body.meas || {},
        // Chosen catalogue reference per breast: { left: <orderNo>, right: <orderNo> }.
        selection: body.selection || { left: null, right: null },
        chosenSizer: body.chosenSizer !== undefined ? body.chosenSizer : { left: null, right: null },
        notes: body.notes || ''
      };
      data.consultations.push(consultation);
      db.save(data);
      sendJson(res, 201, enrichConsultation(consultation));
    });
  }

  if ((m = pathname.match(/^\/api\/consultations\/([^/]+)$/)) && method === 'PUT') {
    return readBody(req, function (err, body) {
      if (err) return sendError(res, 400, 'Invalid JSON');
      var data = db.load();
      var c = data.consultations.find(function (c) { return c.id === m[1]; });
      if (!c) return sendError(res, 404, 'Consultation not found');
      if (user.role !== 'admin' && c.doctorId !== user.id) return sendError(res, 403, 'Forbidden');
      ['meas', 'status', 'selection', 'chosenSizer', 'notes', 'date'].forEach(function (k) {
        if (body[k] !== undefined) c[k] = body[k];
      });
      db.save(data);
      sendJson(res, 200, enrichConsultation(c));
    });
  }

  // ---- appointments ----
  if (pathname === '/api/appointments' && method === 'GET') {
    var data = db.load();
    var list = user.role === 'admin' ? data.appointments : data.appointments.filter(function (a) { return a.doctorId === user.id; });
    list = list.map(function (a) {
      var out = {};
      for (var k in a) out[k] = a[k];
      out.patientName = a.patientId ? findPatientName(data, a.patientId) : null;
      return out;
    });
    return sendJson(res, 200, list);
  }

  if (pathname === '/api/appointments' && method === 'POST') {
    return readBody(req, function (err, body) {
      if (err) return sendError(res, 400, 'Invalid JSON');
      var data = db.load();
      var appt = {
        id: db.uid('a'),
        doctorId: user.id,
        patientId: body.patientId || null,
        date: body.date,
        time: body.time,
        type: body.type || 'Consultation',
        status: body.status || 'pending',
        notes: body.notes || ''
      };
      data.appointments.push(appt);
      db.save(data);
      sendJson(res, 201, appt);
    });
  }

  if ((m = pathname.match(/^\/api\/appointments\/([^/]+)$/)) && method === 'PUT') {
    return readBody(req, function (err, body) {
      if (err) return sendError(res, 400, 'Invalid JSON');
      var data = db.load();
      var a = data.appointments.find(function (a) { return a.id === m[1]; });
      if (!a) return sendError(res, 404, 'Appointment not found');
      if (user.role !== 'admin' && a.doctorId !== user.id) return sendError(res, 403, 'Forbidden');
      ['patientId', 'date', 'time', 'type', 'status', 'notes'].forEach(function (k) {
        if (body[k] !== undefined) a[k] = body[k];
      });
      db.save(data);
      sendJson(res, 200, a);
    });
  }

  if ((m = pathname.match(/^\/api\/appointments\/([^/]+)$/)) && method === 'DELETE') {
    var data = db.load();
    var idx = data.appointments.findIndex(function (a) { return a.id === m[1]; });
    if (idx === -1) return sendError(res, 404, 'Appointment not found');
    var a = data.appointments[idx];
    if (user.role !== 'admin' && a.doctorId !== user.id) return sendError(res, 403, 'Forbidden');
    data.appointments.splice(idx, 1);
    db.save(data);
    return sendJson(res, 200, { ok: true });
  }

  // ---- reports ----
  if (pathname === '/api/reports/summary' && method === 'GET') {
    var data = db.load();
    var doctorFilter = query.doctorId;
    var doctors = user.role === 'admin' ? data.users.filter(function (u) { return u.role === 'doctor'; }) : data.users.filter(function (u) { return u.id === user.id; });
    var doctorIds = doctors.map(function (d) { return d.id; });
    if (doctorFilter && doctorIds.indexOf(doctorFilter) !== -1) doctorIds = [doctorFilter];

    var patients = data.patients.filter(function (p) { return doctorIds.indexOf(p.doctorId) !== -1; });
    var consultations = data.consultations.filter(function (c) { return doctorIds.indexOf(c.doctorId) !== -1; });
    var appointments = data.appointments.filter(function (a) { return doctorIds.indexOf(a.doctorId) !== -1; });

    // "Top implants" now counts real catalogue shapes rather than the retired 4Two
    // families, and counts each breast separately since the two sides can differ.
    var shapeCounts = {};
    var shapeLabels = {};
    var volumes = [];
    consultations.forEach(function (c) {
      var full;
      try { full = calc.computeConsultation(c.meas || {}, c.selection || {}); } catch (e) { return; }
      calc.SIDES.forEach(function (side) {
        var r = full.sides[side].result;
        if (!r) return;
        var key = r.implant.range + '|' + r.implant.shape;
        shapeCounts[key] = (shapeCounts[key] || 0) + 1;
        shapeLabels[key] = r.implant.rangeLabel + ' ' + r.implant.shapeLabel;
        volumes.push(r.implant.v);
      });
    });
    var avgVolume = volumes.length ? Math.round(volumes.reduce(function (a, b) { return a + b; }, 0) / volumes.length) : 0;
    var topImplants = Object.keys(shapeCounts)
      .map(function (key) { return { family: key, label: shapeLabels[key], count: shapeCounts[key] }; })
      .sort(function (a, b) { return b.count - a.count; });

    var perDoctor = doctors.map(function (d) {
      var dPatients = data.patients.filter(function (p) { return p.doctorId === d.id; });
      var dConsultations = data.consultations.filter(function (c) { return c.doctorId === d.id; });
      var dAppointments = data.appointments.filter(function (a) { return a.doctorId === d.id; });
      return {
        doctorId: d.id,
        name: d.name,
        clinic: d.clinic,
        patients: dPatients.length,
        consultations: dConsultations.length,
        appointments: dAppointments.length
      };
    });

    sendJson(res, 200, {
      totals: {
        patients: patients.length,
        consultations: consultations.length,
        appointments: appointments.length,
        avgVolumeSelected: avgVolume
      },
      topImplants: topImplants,
      perDoctor: perDoctor
    });
    return;
  }

  sendError(res, 404, 'Unknown API route');
}

var server = http.createServer(function (req, res) {
  var parsed = url.parse(req.url, true);
  var pathname = decodeURIComponent(parsed.pathname);

  if (pathname.indexOf('/api/') === 0) {
    try {
      api(req, res, pathname, parsed.query);
    } catch (e) {
      sendError(res, 500, 'Server error: ' + e.message);
    }
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, function () {
  console.log('Feather Touch demo running at http://localhost:' + PORT);
  console.log('Test credentials:');
  console.log('  dr.chioibas / feathertouch2026');
  console.log('  demo / demo1234');
  console.log('  admin / admin2026');
});
