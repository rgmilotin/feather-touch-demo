/*
 * Minimal zero-dependency .pptx (OOXML) writer.
 *
 * Only Node's built-ins are used (fs is NOT required here -- callers pass in already
 * -read Buffers) so this keeps the project's "no npm install" property. It hand-builds
 * a ZIP container (STORE / no compression, for simplicity and robustness) and a
 * minimal-but-valid PresentationML package: one slide master/layout/theme, and
 * N slides made of simple text boxes and/or images.
 *
 * This is intentionally NOT a general-purpose pptx library -- just enough surface
 * (title/subtitle text slides + image-grid slides) to build the Feather Touch
 * before/after export. See buildBeforeAfterPptx() at the bottom for the entry point
 * used by server.js.
 */
'use strict';

// ---------------------------------------------------------------------------------
// ZIP container (uncompressed "STORE" entries -- valid per the ZIP spec, and avoids
// any dependency on deflate edge cases for a handful of small XML files + JPEGs that
// are already compressed).
// ---------------------------------------------------------------------------------

var CRC_TABLE = (function () {
  var table = new Uint32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  var crc = 0xFFFFFFFF;
  for (var i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// DOS date/time packed into the fixed "now" -- exact value doesn't matter for
// readers, it's just metadata.
function dosDateTime() {
  var d = new Date();
  var time = ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | ((d.getSeconds() >> 1) & 0x1F);
  var date = (((d.getFullYear() - 1980) & 0x7F) << 9) | (((d.getMonth() + 1) & 0xF) << 5) | (d.getDate() & 0x1F);
  return { time: time, date: date };
}

function buildZip(files) {
  // files: [{ name: 'ppt/presentation.xml', data: Buffer }, ...]
  var dt = dosDateTime();
  var localChunks = [];
  var centralChunks = [];
  var offset = 0;

  files.forEach(function (f) {
    var nameBuf = Buffer.from(f.name, 'utf8');
    var data = f.data;
    var crc = crc32(data);
    var size = data.length;

    var local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(0, 6);           // flags
    local.writeUInt16LE(0, 8);           // method: 0 = store
    local.writeUInt16LE(dt.time, 10);
    local.writeUInt16LE(dt.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);       // compressed size == size (store)
    local.writeUInt32LE(size, 22);       // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);          // extra length
    localChunks.push(local, nameBuf, data);

    var central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);        // version made by
    central.writeUInt16LE(20, 6);        // version needed
    central.writeUInt16LE(0, 8);         // flags
    central.writeUInt16LE(0, 10);        // method
    central.writeUInt16LE(dt.time, 12);
    central.writeUInt16LE(dt.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);        // extra length
    central.writeUInt16LE(0, 32);        // comment length
    central.writeUInt16LE(0, 34);        // disk number start
    central.writeUInt16LE(0, 36);        // internal attrs
    central.writeUInt32LE(0, 38);        // external attrs
    central.writeUInt32LE(offset, 42);   // local header offset
    centralChunks.push(central, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  });

  var centralStart = offset;
  var centralBuf = Buffer.concat(centralChunks);

  var end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);   // disk number
  end.writeUInt16LE(0, 6);   // disk with central dir
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat(localChunks.concat([centralBuf, end]));
}

// ---------------------------------------------------------------------------------
// Minimal JPEG dimension sniff (SOF0/SOF2 marker) so image slides can contain-fit
// photos inside their grid cell instead of stretching them. PNG is also handled
// (IHDR is always the first chunk, at a fixed offset). Falls back to null (caller
// then stretches to fill the cell) if the format isn't recognised.
// ---------------------------------------------------------------------------------
function imageDimensions(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) { // PNG signature
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0xFF && buf[1] === 0xD8) { // JPEG SOI
    var i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xFF) { i++; continue; }
      var marker = buf[i + 1];
      // SOF0..SOF3 / SOF5..SOF7 / SOF9..SOF11 / SOF13..SOF15 all carry width/height
      // at the same offset; skip the standalone markers that have no length/payload.
      if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
        var h = buf.readUInt16BE(i + 5);
        var w = buf.readUInt16BE(i + 7);
        return { w: w, h: h };
      }
      if (marker === 0xD8 || marker === 0xD9) { i += 2; continue; }
      var segLen = buf.readUInt16BE(i + 2);
      i += 2 + segLen;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------
// OOXML XML templates
// ---------------------------------------------------------------------------------
var EMU_PER_IN = 914400;
var SLIDE_W = 12192000; // 13.333in, 16:9
var SLIDE_H = 6858000;  // 7.5in

function xmlEscape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function contentTypesXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
    '<Default Extension="jpg" ContentType="image/jpeg"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
    '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
    '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
    '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
    [1, 2, 3].map(function (n) {
      return '<Override PartName="/ppt/slides/slide' + n + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>';
    }).join('') +
    '</Types>';
}

function rootRelsXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>' +
    '</Relationships>';
}

function presentationXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
    '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
    '<p:sldIdLst>' +
    '<p:sldId id="256" r:id="rId2"/>' +
    '<p:sldId id="257" r:id="rId3"/>' +
    '<p:sldId id="258" r:id="rId4"/>' +
    '</p:sldIdLst>' +
    '<p:sldSz cx="' + SLIDE_W + '" cy="' + SLIDE_H + '"/>' +
    '<p:notesSz cx="6858000" cy="9144000"/>' +
    '</p:presentation>';
}

function presentationRelsXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>' +
    '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide3.xml"/>' +
    '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>' +
    '</Relationships>';
}

function slideMasterXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
    '<p:cSld><p:bg><p:bgPr><a:solidFill><a:schemeClr val="lt1"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>' +
    '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>' +
    '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" ' +
    'accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
    '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>' +
    '</p:sldMaster>';
}

function slideMasterRelsXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>' +
    '</Relationships>';
}

function slideLayoutXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">' +
    '<p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>' +
    '<p:clrMapOvr><a:overrideClrMapping bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" ' +
    'accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:clrMapOvr>' +
    '</p:sldLayout>';
}

function slideLayoutRelsXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>' +
    '</Relationships>';
}

// Palette pulled from public/css/style.css :root custom properties, so the deck
// matches the web app's brand colors (terracotta/espresso Feather Touch palette).
var THEME = {
  bg: 'FAF7F3', surface: 'FFFFFF', border: 'E9DDD0', text: '3C2A1D', textMuted: '8A7566',
  primary: 'C17E6A', primaryDark: 'A1604C', primaryTint: 'F6E6DE', accent: '4F6F64',
  danger: 'C05A4B', warning: 'C98A3A'
};

function themeXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="FeatherTouch"><a:themeElements>' +
    '<a:clrScheme name="FeatherTouch">' +
    '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>' +
    '<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
    '<a:dk2><a:srgbClr val="' + THEME.text + '"/></a:dk2>' +
    '<a:lt2><a:srgbClr val="' + THEME.primaryTint + '"/></a:lt2>' +
    '<a:accent1><a:srgbClr val="' + THEME.primary + '"/></a:accent1>' +
    '<a:accent2><a:srgbClr val="' + THEME.accent + '"/></a:accent2>' +
    '<a:accent3><a:srgbClr val="' + THEME.primaryDark + '"/></a:accent3>' +
    '<a:accent4><a:srgbClr val="' + THEME.warning + '"/></a:accent4>' +
    '<a:accent5><a:srgbClr val="' + THEME.danger + '"/></a:accent5>' +
    '<a:accent6><a:srgbClr val="' + THEME.textMuted + '"/></a:accent6>' +
    '<a:hlink><a:srgbClr val="' + THEME.primaryDark + '"/></a:hlink>' +
    '<a:folHlink><a:srgbClr val="' + THEME.accent + '"/></a:folHlink>' +
    '</a:clrScheme>' +
    '<a:fontScheme name="FeatherTouch">' +
    '<a:majorFont><a:latin typeface="Georgia"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
    '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>' +
    '</a:fontScheme>' +
    '<a:fmtScheme name="FeatherTouch">' +
    '<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>' +
    '<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>' +
    '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
    '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>' +
    '</a:fmtScheme></a:themeElements></a:theme>';
}

function textBoxShape(id, name, x, y, cx, cy, text, opts) {
  opts = opts || {};
  var sz = opts.size || 1800;
  var bold = opts.bold ? '1' : '0';
  var color = opts.color || THEME.text;
  var font = opts.font === 'body' ? '' : '<a:latin typeface="Georgia"/>';
  var align = opts.align || 'ctr';
  return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="' + xmlEscape(name) + '"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>' +
    '<p:spPr><a:xfrm><a:off x="' + x + '" y="' + y + '"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>' +
    '<p:txBody><a:bodyPr wrap="square" anchor="ctr"><a:noAutofit/></a:bodyPr><a:lstStyle/>' +
    '<a:p><a:pPr algn="' + align + '"/><a:r><a:rPr lang="en-US" sz="' + sz + '" b="' + bold + '">' +
    '<a:solidFill><a:srgbClr val="' + color + '"/></a:solidFill>' + font + '</a:rPr>' +
    '<a:t>' + xmlEscape(text) + '</a:t></a:r></a:p></p:txBody></p:sp>';
}

function rectShape(id, name, x, y, cx, cy, fillColor) {
  return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="' + xmlEscape(name) + '"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>' +
    '<p:spPr><a:xfrm><a:off x="' + x + '" y="' + y + '"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="' + fillColor + '"/></a:solidFill>' +
    '<a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>';
}

function pictureShape(id, name, rId, x, y, cx, cy) {
  return '<p:pic><p:nvPicPr><p:cNvPr id="' + id + '" name="' + xmlEscape(name) + '"/>' +
    '<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>' +
    '<p:blipFill><a:blip r:embed="' + rId + '"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>' +
    '<p:spPr><a:xfrm><a:off x="' + x + '" y="' + y + '"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>';
}

function slideXml(bgColor, shapesXml) {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
    '<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="' + bgColor + '"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>' +
    '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>' +
    shapesXml +
    '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';
}

function slideRelsXml(imageRels) {
  // imageRels: [{ rId: 'rId1', target: '../media/image1.jpeg' }, ...]
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    imageRels.map(function (r) {
      return '<Relationship Id="' + r.rId + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="' + r.target + '"/>';
    }).join('') +
    '</Relationships>';
}

// ---------------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------------

// Contain-fit an image of natural size (w,h) inside a cell (cx,cy), centered.
function fitRect(cellX, cellY, cellCx, cellCy, natW, natH) {
  if (!natW || !natH) return { x: cellX, y: cellY, cx: cellCx, cy: cellCy };
  var scale = Math.min(cellCx / natW, cellCy / natH);
  var cx = Math.round(natW * scale);
  var cy = Math.round(natH * scale);
  return { x: Math.round(cellX + (cellCx - cx) / 2), y: Math.round(cellY + (cellCy - cy) / 2), cx: cx, cy: cy };
}

function photoGridSlide(label, images, mediaStartIndex) {
  // images: [{ buffer, ext }]
  var margin = 450000;
  var titleH = 750000;
  var gutter = 150000;
  var cols = 3;
  var rows = 2;
  var gridTop = margin + titleH;
  var usableW = SLIDE_W - margin * 2;
  var usableH = SLIDE_H - gridTop - margin;
  var cellCx = (usableW - gutter * (cols - 1)) / cols;
  var cellCy = (usableH - gutter * (rows - 1)) / rows;

  var shapes = [];
  var rels = [];
  var media = [];
  var shapeId = 2;

  shapes.push(textBoxShape(shapeId++, 'Label', margin, margin, usableW, titleH, label,
    { size: 2800, bold: true, color: THEME.primaryDark, align: 'l' }));

  images.slice(0, cols * rows).forEach(function (img, i) {
    var col = i % cols;
    var row = Math.floor(i / cols);
    var cellX = margin + col * (cellCx + gutter);
    var cellY = gridTop + row * (cellCy + gutter);

    // Card backdrop so the grid reads cleanly even if photos have varying aspect ratios.
    shapes.push(rectShape(shapeId++, 'Card' + i, cellX, cellY, cellCx, cellCy, THEME.surface));

    var dims = imageDimensions(img.buffer);
    var pad = 30000;
    var fit = fitRect(cellX + pad, cellY + pad, cellCx - pad * 2, cellCy - pad * 2, dims && dims.w, dims && dims.h);

    var rId = 'rId' + (i + 1);
    var mediaIndex = mediaStartIndex + i;
    var mediaName = 'image' + mediaIndex + (img.ext === '.png' ? '.png' : '.jpeg');
    rels.push({ rId: rId, target: '../media/' + mediaName });
    media.push({ name: 'ppt/media/' + mediaName, data: img.buffer });

    shapes.push(pictureShape(shapeId++, 'Photo' + i, rId, fit.x, fit.y, fit.cx, fit.cy));
  });

  return { shapesXml: shapes.join(''), rels: rels, media: media };
}

function posterSlide(title, subtitle, meta, logo) {
  var shapes = [];
  var rels = [];
  var media = [];
  var shapeId = 2;

  if (logo) {
    var dims = imageDimensions(logo.buffer) || { w: 400, h: 120 };
    var maxCx = 3200000;
    var scale = maxCx / dims.w;
    var cx = maxCx;
    var cy = Math.round(dims.h * scale);
    var x = Math.round((SLIDE_W - cx) / 2);
    var y = 1150000;
    rels.push({ rId: 'rId1', target: '../media/logo.png' });
    media.push({ name: 'ppt/media/logo.png', data: logo.buffer });
    shapes.push(pictureShape(shapeId++, 'Logo', 'rId1', x, y, cx, cy));
    shapes.push(textBoxShape(shapeId++, 'Title', 685800, y + cy + 200000, SLIDE_W - 1371600, 900000, title,
      { size: 4000, bold: true, color: THEME.primaryDark }));
  } else {
    shapes.push(textBoxShape(shapeId++, 'Title', 685800, 2350000, SLIDE_W - 1371600, 1100000, title,
      { size: 5400, bold: true, color: THEME.primaryDark }));
  }

  shapes.push(textBoxShape(shapeId++, 'Subtitle', 685800, 3900000, SLIDE_W - 1371600, 700000, subtitle,
    { size: 2400, bold: false, color: THEME.text }));
  shapes.push(textBoxShape(shapeId++, 'Meta', 685800, 4550000, SLIDE_W - 1371600, 600000, meta,
    { size: 1400, bold: false, color: THEME.textMuted, font: 'body' }));

  return { shapesXml: shapes.join(''), rels: rels, media: media };
}

// ---------------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------------

// buildBeforeAfterPptx({ title, subtitle, meta, logo: {buffer,ext}|null,
//                         beforeImages: [{buffer,ext}], afterImages: [{buffer,ext}] })
// -> Buffer (a complete .pptx file)
function buildBeforeAfterPptx(opts) {
  opts = opts || {};
  var poster = posterSlide(opts.title || 'Feather Touch', opts.subtitle || '', opts.meta || '', opts.logo);
  var before = photoGridSlide('Before', opts.beforeImages || [], 100);
  var after = photoGridSlide('After', opts.afterImages || [], 200);

  var files = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypesXml(), 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rootRelsXml(), 'utf8') },
    { name: 'ppt/presentation.xml', data: Buffer.from(presentationXml(), 'utf8') },
    { name: 'ppt/_rels/presentation.xml.rels', data: Buffer.from(presentationRelsXml(), 'utf8') },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: Buffer.from(slideMasterXml(), 'utf8') },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: Buffer.from(slideMasterRelsXml(), 'utf8') },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: Buffer.from(slideLayoutXml(), 'utf8') },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: Buffer.from(slideLayoutRelsXml(), 'utf8') },
    { name: 'ppt/theme/theme1.xml', data: Buffer.from(themeXml(), 'utf8') },
    { name: 'ppt/slides/slide1.xml', data: Buffer.from(slideXml(THEME.primaryTint, poster.shapesXml), 'utf8') },
    { name: 'ppt/slides/_rels/slide1.xml.rels', data: Buffer.from(slideRelsXml(poster.rels), 'utf8') },
    { name: 'ppt/slides/slide2.xml', data: Buffer.from(slideXml(THEME.bg, before.shapesXml), 'utf8') },
    { name: 'ppt/slides/_rels/slide2.xml.rels', data: Buffer.from(slideRelsXml(before.rels), 'utf8') },
    { name: 'ppt/slides/slide3.xml', data: Buffer.from(slideXml(THEME.bg, after.shapesXml), 'utf8') },
    { name: 'ppt/slides/_rels/slide3.xml.rels', data: Buffer.from(slideRelsXml(after.rels), 'utf8') }
  ];
  poster.media.forEach(function (m) { files.push(m); });
  before.media.forEach(function (m) { files.push(m); });
  after.media.forEach(function (m) { files.push(m); });

  return buildZip(files);
}

module.exports = { buildBeforeAfterPptx: buildBeforeAfterPptx, buildZip: buildZip, imageDimensions: imageDimensions };
