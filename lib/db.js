/*
 * Minimal JSON-file "database" for the Feather Touch demo.
 * No external dependencies -- reads/writes a single JSON file on disk.
 * Good enough for a single-machine functional demo; swap for a real DB later.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var DB_PATH = path.join(__dirname, '..', 'data', 'db.json');
// Lives outside data/ on purpose: on Railway, data/ is a mounted persistent
// Volume, and volumes start empty (they shadow whatever was baked into the
// image at that path). Keeping the seed file outside data/ means it's always
// present in the deployed image for ensureDb()/resetToSeed() to read, even on
// a brand-new volume that has no db.json yet.
var SEED_PATH = path.join(__dirname, '..', 'seed', 'seed.json');

function uid(prefix) {
  return (prefix || 'id') + '_' + crypto.randomBytes(6).toString('hex');
}

function ensureDb() {
  if (!fs.existsSync(DB_PATH)) {
    var seed = fs.readFileSync(SEED_PATH, 'utf8');
    fs.writeFileSync(DB_PATH, seed);
  }
}

function load() {
  ensureDb();
  var data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  // Backward-compatible migration for db.json files written before the photos
  // collection existed.
  if (!data.photos) data.photos = [];
  // Backward-compatible migration for db.json files written before the BioDynamic
  // demo patient (photo gallery / before-after PPTX showcase) was added to the seed.
  // Only injects that one demo patient + its photos -- never touches real data the
  // doctor has since added (other patients, consultations, appointments).
  if (!data.patients.some(function (p) { return p.id === 'p_demo_biodynamic'; })) {
    var seedData = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
    var demoPatient = seedData.patients.find(function (p) { return p.id === 'p_demo_biodynamic'; });
    if (demoPatient) {
      data.patients.push(demoPatient);
      var demoPhotos = seedData.photos.filter(function (ph) { return ph.patientId === 'p_demo_biodynamic'; });
      demoPhotos.forEach(function (ph) {
        if (!data.photos.some(function (existing) { return existing.id === ph.id; })) data.photos.push(ph);
      });
      save(data);
    }
  }
  return data;
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function resetToSeed() {
  var seed = fs.readFileSync(SEED_PATH, 'utf8');
  fs.writeFileSync(DB_PATH, seed);
  return JSON.parse(seed);
}

module.exports = { load: load, save: save, uid: uid, resetToSeed: resetToSeed, DB_PATH: DB_PATH };
