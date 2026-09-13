/* Sprint OS: proof of delivery from the driver's thumb. Brick 80.

   Three sheets, each a promise, each cleaning up after itself:

     SprintEPOD.sign({title, hint})
         a signature pad. Pointer events, so a finger, a glove and a stylus all
         draw; the backing store is scaled to the phone's pixel ratio so the line
         is crisp; the strokes are kept as points, not pixels, so the saved
         picture is drawn again clean, black ink on white, trimmed to the marks
         with a little air, no wider than 600 px. That is what a court or a
         customer wants to see, and it weighs a few kilobytes, so it queues
         happily with no signal. An empty pad cannot be accepted.
         Resolves to a PNG data URL, or null if the driver cancelled.

     SprintEPOD.scan({hint})
         reads a waybill barcode through the rear camera where the phone's
         browser can (Android Chrome has BarcodeDetector). Where it cannot
         (every iPhone, and this desktop) the same sheet offers a plain field to
         type the number, in words that say why. Every path releases the camera:
         done, cancelled, error, and the page going to the background.
         Resolves to the code as text, or null.

     SprintEPOD.exception({title, reasons, pieces})
         what went wrong at the door. A reason is one tap; a partial delivery
         asks how many of how many pieces were accepted; a photo is REQUIRED and
         the Done button stays disabled, and says why, until one exists. The
         photo is taken with the phone's own camera app (capture=environment),
         shrunk to 1280 px on its long side and saved as JPEG, so the evidence is
         real but does not fill the phone.
         Resolves to {code, label, note, photo, accepted, pieces}, or null.

   Nothing here talks to the hub. The caller queues the result through the
   app's own offline queue, so a signature taken with no signal is not lost.
   Every touch target is at least 48 px. Plain ES5, no library. */
(function (root) {
  'use strict';

  var CSS = '' +
    '.epod-wrap{position:fixed;inset:0;z-index:70;display:none;align-items:flex-end;background:rgba(4,20,14,.62);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}' +
    '.epod-wrap.show{display:flex}' +
    '.epod{width:100%;max-width:560px;margin:0 auto;background:linear-gradient(135deg,rgba(20,70,45,.96),rgba(14,47,34,.98));color:#F4F7F5;' +
      'border-radius:26px 26px 0 0;border:1px solid rgba(255,255,255,.22);border-bottom:0;padding:18px 16px calc(18px + env(safe-area-inset-bottom,0px));' +
      'box-shadow:0 -18px 50px -20px rgba(0,0,0,.8);font-family:inherit}' +
    '.epod h3{margin:0 0 4px;font-size:18px;font-weight:800}' +
    '.epod p.h{margin:0 0 12px;font-size:13px;color:#C9D6CF;line-height:1.4}' +
    '.epod .pad{position:relative;border-radius:16px;background:rgba(255,255,255,.08);border:1px dashed rgba(255,255,255,.35);overflow:hidden}' +
    '.epod canvas{display:block;width:100%;height:220px;touch-action:none;cursor:crosshair}' +
    '.epod .pad .line{position:absolute;left:16px;right:16px;bottom:44px;border-top:1px solid rgba(255,255,255,.28);pointer-events:none}' +
    '.epod .pad .x{position:absolute;left:18px;bottom:48px;font-size:22px;color:rgba(255,255,255,.4);pointer-events:none}' +
    '.epod .row{display:flex;gap:10px;margin-top:14px}' +
    '.epod .b{flex:1;min-height:52px;border-radius:999px;border:1px solid rgba(255,255,255,.28);background:rgba(255,255,255,.10);color:#fff;font:inherit;font-weight:800;font-size:15px;padding:0 16px}' +
    '.epod .b.go{background:#F7941D;border-color:#F7941D;color:#0E2F22}' +
    '.epod .b:disabled{opacity:.45}' +
    '.epod .why{margin:8px 0 0;font-size:12.5px;color:#FDBE74;min-height:16px}' +
    '.epod .err{margin:8px 0 0;font-size:13px;color:#FFB3AD;display:none}' +
    '.epod video{width:100%;height:240px;object-fit:cover;border-radius:16px;background:#000;display:block}' +
    '.epod .field{width:100%;min-height:52px;border-radius:14px;border:1px solid rgba(255,255,255,.28);background:rgba(255,255,255,.10);color:#fff;font:inherit;font-size:17px;padding:0 14px;margin-top:10px}' +
    '.epod textarea.field{min-height:72px;padding:12px 14px;resize:vertical}' +
    '.epod .reasons{display:grid;grid-template-columns:1fr 1fr;gap:8px}' +
    '.epod .reason{min-height:48px;border-radius:14px;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.08);color:#fff;font:inherit;font-size:14px;font-weight:700;padding:8px 12px;text-align:left}' +
    '.epod .reason.on{background:#F7941D;border-color:#F7941D;color:#0E2F22}' +
    '.epod .photo{margin-top:12px;display:flex;align-items:center;gap:12px}' +
    '.epod .photo label{flex:1;min-height:52px;border-radius:999px;border:1px solid rgba(255,255,255,.28);background:rgba(255,255,255,.10);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px}' +
    '.epod .photo input{position:absolute;opacity:0;width:1px;height:1px}' +
    '.epod .thumb{width:64px;height:64px;border-radius:12px;object-fit:cover;background:rgba(0,0,0,.3);display:none}' +
    '.epod .thumb.show{display:block}' +
    '.epod .count{display:none;margin-top:10px}' +
    '.epod .count.show{display:block}';

  function css() {
    if (document.getElementById('sp-epod-css')) return;
    var s = document.createElement('style'); s.id = 'sp-epod-css'; s.textContent = CSS; document.head.appendChild(s);
  }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }
  function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // one sheet at a time; opening another closes the first with null
  var current = null;
  function sheet(title, hint) {
    css();
    if (current) current.close(null);
    var wrap = el('div', 'epod-wrap');
    var box = el('div', 'epod');
    box.appendChild(el('h3', '', esc(title)));
    if (hint) box.appendChild(el('p', 'h', esc(hint)));
    var body = el('div', 'body');
    box.appendChild(body);
    var err = el('div', 'err');
    box.appendChild(err);
    wrap.appendChild(box);
    document.body.appendChild(wrap);
    var settled = false, resolveFn = null, cleanups = [];
    var api = {
      wrap: wrap, body: body,
      promise: new Promise(function (resolve) { resolveFn = resolve; }),
      onClose: function (fn) { cleanups.push(fn); },
      error: function (msg) { err.textContent = msg; err.style.display = msg ? 'block' : 'none'; },
      close: function (value) {
        if (settled) return; settled = true;
        for (var i = 0; i < cleanups.length; i++) { try { cleanups[i](); } catch (e) { /* releasing must never throw */ } }
        wrap.classList.remove('show');
        setTimeout(function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }, 0);
        if (current === api) current = null;
        resolveFn(value);
      }
    };
    wrap.addEventListener('click', function (e) { if (e.target === wrap) api.close(null); });
    current = api;
    setTimeout(function () { wrap.classList.add('show'); }, 0);
    return api;
  }
  function button(text, cls, onClick) {
    var b = el('button', 'b' + (cls ? ' ' + cls : ''), esc(text)); b.type = 'button'; b.addEventListener('click', onClick); return b;
  }

  /* ---------------- 1. the signature ---------------- */
  function sign(opts) {
    opts = opts || {};
    var s = sheet(opts.title || 'Sign here', opts.hint || 'Ask the person receiving the parcel to sign with a finger. Clear starts again.');
    var pad = el('div', 'pad');
    var canvas = el('canvas');
    pad.appendChild(canvas); pad.appendChild(el('div', 'line')); pad.appendChild(el('div', 'x', '&times;'));
    s.body.appendChild(pad);
    var why = el('div', 'why', 'Nothing signed yet');
    s.body.appendChild(why);
    var row = el('div', 'row');
    var clear = button('Clear', '', function () { strokes = []; redraw(); state(); });
    var cancel = button('Cancel', '', function () { s.close(null); });
    var done = button('Done', 'go', function () {
      if (!hasInk()) { s.error('Nothing has been signed yet.'); return; }
      s.close(exportPng());
    });
    row.appendChild(clear); row.appendChild(cancel); row.appendChild(done);
    s.body.appendChild(row);

    var ctx = canvas.getContext('2d');
    var dpr = Math.max(1, Math.min(3, root.devicePixelRatio || 1));
    var W = 0, H = 220;
    var strokes = [], live = null;
    function size() {
      W = Math.max(200, pad.clientWidth || 300);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redraw();
    }
    function pt(e) { var r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    function stroke(c, pts, colour, width) {
      if (pts.length < 1) return;
      c.strokeStyle = colour; c.lineWidth = width; c.lineCap = 'round'; c.lineJoin = 'round';
      c.beginPath();
      if (pts.length === 1) { c.moveTo(pts[0][0], pts[0][1]); c.lineTo(pts[0][0] + 0.1, pts[0][1]); }
      else { c.moveTo(pts[0][0], pts[0][1]); for (var i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]); }
      c.stroke();
    }
    function redraw() { ctx.clearRect(0, 0, W, H); for (var i = 0; i < strokes.length; i++) stroke(ctx, strokes[i], '#FFFFFF', 2.6); }
    function inkLength() {
      var n = 0;
      for (var i = 0; i < strokes.length; i++) for (var j = 1; j < strokes[i].length; j++) {
        var a = strokes[i][j - 1], b = strokes[i][j]; n += Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]));
      }
      return n;
    }
    function hasInk() { return inkLength() >= 24; }   // a dot or a slip is not a signature
    function state() { var ok = hasInk(); done.disabled = !ok; why.textContent = ok ? '' : 'Nothing signed yet'; s.error(''); }
    canvas.addEventListener('pointerdown', function (e) { e.preventDefault(); try { canvas.setPointerCapture(e.pointerId); } catch (x) {} live = [pt(e)]; strokes.push(live); stroke(ctx, live, '#FFFFFF', 2.6); });
    canvas.addEventListener('pointermove', function (e) { if (!live) return; e.preventDefault(); live.push(pt(e)); stroke(ctx, live.slice(-2), '#FFFFFF', 2.6); });
    function up() { if (!live) return; live = null; state(); }
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up); canvas.addEventListener('pointerleave', up);
    function exportPng() {
      // black on white, trimmed to the ink with 12 px of air, no wider than 600 px
      var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
      for (var i = 0; i < strokes.length; i++) for (var j = 0; j < strokes[i].length; j++) {
        var p = strokes[i][j]; if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]; if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
      }
      var pad2 = 12, w = Math.max(60, maxX - minX + pad2 * 2), h = Math.max(40, maxY - minY + pad2 * 2);
      var scale = Math.min(1, 600 / w) * 2;          // drawn at 2x for a crisp line, capped at 600 css px wide
      var out = document.createElement('canvas');
      out.width = Math.round(w * scale); out.height = Math.round(h * scale);
      var c = out.getContext('2d');
      c.fillStyle = '#FFFFFF'; c.fillRect(0, 0, out.width, out.height);
      c.setTransform(scale, 0, 0, scale, 0, 0);
      for (var k = 0; k < strokes.length; k++) {
        stroke(c, strokes[k].map(function (p) { return [p[0] - minX + pad2, p[1] - minY + pad2]; }), '#111111', 2.6);
      }
      return out.toDataURL('image/png');
    }
    done.disabled = true;
    setTimeout(size, 20);
    var onResize = function () { size(); };
    root.addEventListener('resize', onResize);
    s.onClose(function () { root.removeEventListener('resize', onResize); });
    return s.promise;
  }

  /* ---------------- 2. the barcode ---------------- */
  var FORMATS = ['code_128', 'code_39', 'ean_13', 'ean_8', 'itf', 'codabar', 'qr_code'];
  function scan(opts) {
    opts = opts || {};
    var s = sheet(opts.title || 'Scan the waybill', opts.hint || 'Point the camera at the barcode on the label.');
    var can = typeof root.BarcodeDetector === 'function';
    var field = el('input', 'field'); field.type = 'text'; field.placeholder = 'Or type the waybill number'; field.autocapitalize = 'characters'; field.setAttribute('inputmode', 'text');
    var why = el('div', 'why', '');
    var row = el('div', 'row');
    var cancel = button('Cancel', '', function () { s.close(null); });
    var done = button('Use this number', 'go', function () {
      var v = String(field.value || '').trim().toUpperCase();
      if (!v) { s.error('Type the waybill number first.'); return; }
      s.close(v);
    });
    row.appendChild(cancel); row.appendChild(done);
    var stream = null, ticking = false, stopped = false;
    function release() {
      stopped = true;
      if (stream) { stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} }); stream = null; }
    }
    s.onClose(release);
    var onHide = function () { release(); };
    document.addEventListener('visibilitychange', function v() { if (document.hidden) { onHide(); document.removeEventListener('visibilitychange', v); } });
    root.addEventListener('pagehide', onHide, { once: true });

    if (!can) {
      why.textContent = 'This phone’s browser cannot read barcodes through the camera, so type the number from the label.';
      s.body.appendChild(field); s.body.appendChild(why); s.body.appendChild(row);
      setTimeout(function () { field.focus(); }, 50);
      return s.promise;
    }
    var video = el('video'); video.setAttribute('playsinline', ''); video.muted = true; video.autoplay = true;
    s.body.appendChild(video); s.body.appendChild(field); s.body.appendChild(why); s.body.appendChild(row);
    var detector;
    try { detector = new root.BarcodeDetector({ formats: FORMATS }); } catch (e) { try { detector = new root.BarcodeDetector(); } catch (e2) { detector = null; } }
    if (!detector || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      video.style.display = 'none';
      why.textContent = 'The camera cannot be used here, so type the number from the label.';
      return s.promise;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }).then(function (st) {
      if (stopped) { st.getTracks().forEach(function (t) { t.stop(); }); return; }
      stream = st; video.srcObject = st;
      return video.play().catch(function () {});
    }).then(function () {
      if (stopped) return;
      why.textContent = 'Looking for a barcode';
      (function tick() {
        if (stopped) return;
        if (ticking) { setTimeout(tick, 300); return; }
        ticking = true;
        detector.detect(video).then(function (codes) {
          ticking = false;
          if (stopped) return;
          var hit = null;
          for (var i = 0; i < codes.length; i++) if (codes[i].rawValue) { hit = codes[i].rawValue; break; }
          if (hit) { s.close(String(hit).trim().toUpperCase()); return; }
          setTimeout(tick, 300);
        }, function () { ticking = false; setTimeout(tick, 500); });
      })();
    }).catch(function (e) {
      release();
      video.style.display = 'none';
      var name = e && e.name ? e.name : '';
      why.textContent = name === 'NotAllowedError' ? 'The camera was not allowed. Type the number from the label instead.' :
                        name === 'NotFoundError' ? 'No camera was found on this device. Type the number from the label.' :
                        'The camera could not start. Type the number from the label.';
    });
    return s.promise;
  }

  /* ---------------- 3. the exception, with the photo that is not optional ---------------- */
  var EXTRA = [
    { type: 'consignee_not_available', label: 'Consignee not available' },
    { type: 'wrong_address', label: 'Wrong address' },
    { type: 'closed_premises', label: 'Closed premises' },
    { type: 'partial_delivery', label: 'Partial delivery' }
  ];
  function shrink(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('Could not read that photo.')); };
      reader.onload = function () {
        var img = new Image();
        img.onload = function () {
          var max = 1280, w = img.width, h = img.height, k = Math.min(1, max / Math.max(w, h));
          var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', 0.8));
        };
        img.onerror = function () { reject(new Error('That file is not a photo.')); };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  function exception(opts) {
    opts = opts || {};
    var reasons = (opts.reasons || []).slice();
    for (var i = 0; i < EXTRA.length; i++) {
      var have = false;
      for (var j = 0; j < reasons.length; j++) if (reasons[j].type === EXTRA[i].type) have = true;
      if (!have) reasons.push(EXTRA[i]);
    }
    var pieces = typeof opts.pieces === 'number' && opts.pieces > 0 ? opts.pieces : null;
    var s = sheet(opts.title || 'What happened at the door?', opts.hint || 'One tap for the reason. A photo is required before this can be closed.');
    var grid = el('div', 'reasons');
    var chosen = null;
    reasons.forEach(function (r) {
      var b = el('button', 'reason', esc(r.label || r.type)); b.type = 'button';
      b.addEventListener('click', function () {
        chosen = r;
        var all = grid.querySelectorAll('.reason'); for (var k = 0; k < all.length; k++) all[k].classList.remove('on');
        b.classList.add('on');
        count.className = 'count' + (r.type === 'partial_delivery' ? ' show' : '');
        state();
      });
      grid.appendChild(b);
    });
    s.body.appendChild(grid);
    var count = el('div', 'count');
    var countIn = el('input', 'field'); countIn.type = 'number'; countIn.min = '0'; countIn.setAttribute('inputmode', 'numeric');
    countIn.placeholder = pieces ? 'How many of the ' + pieces + ' pieces were accepted?' : 'How many pieces were accepted?';
    if (pieces) countIn.max = String(pieces);
    countIn.addEventListener('input', state);
    count.appendChild(countIn);
    s.body.appendChild(count);
    var photoRow = el('div', 'photo');
    var label = el('label', '', 'Take a photo');
    var input = el('input'); input.type = 'file'; input.accept = 'image/*'; input.setAttribute('capture', 'environment');
    label.appendChild(input);
    var thumb = el('img', 'thumb'); thumb.alt = '';
    photoRow.appendChild(label); photoRow.appendChild(thumb);
    s.body.appendChild(photoRow);
    var photo = null;
    function setPhoto(dataUrl) { photo = dataUrl || null; thumb.src = photo || ''; thumb.className = 'thumb' + (photo ? ' show' : ''); label.textContent = photo ? 'Retake the photo' : 'Take a photo'; label.appendChild(input); state(); }
    input.addEventListener('change', function () {
      var f = input.files && input.files[0]; if (!f) return;
      label.textContent = 'Reading the photo'; label.appendChild(input);
      shrink(f).then(setPhoto, function (e) { s.error(e.message); setPhoto(null); });
    });
    var note = el('textarea', 'field'); note.placeholder = 'Anything else, optional';
    s.body.appendChild(note);
    var why = el('div', 'why', '');
    s.body.appendChild(why);
    var row = el('div', 'row');
    var cancel = button('Cancel', '', function () { s.close(null); });
    var done = button('Done', 'go', function () {
      var m = missing(); if (m) { s.error(m); return; }
      var accepted = chosen.type === 'partial_delivery' ? parseInt(countIn.value, 10) : null;
      s.close({ code: chosen.type, label: chosen.label || chosen.type, note: String(note.value || '').trim() || null,
                photo: photo, accepted: isNaN(accepted) ? null : accepted, pieces: pieces });
    });
    row.appendChild(cancel); row.appendChild(done);
    s.body.appendChild(row);
    function missing() {
      if (!chosen) return 'Pick what happened.';
      if (chosen.type === 'partial_delivery') {
        var n = parseInt(countIn.value, 10);
        if (isNaN(n) || n < 0) return 'Say how many pieces were accepted.';
        if (pieces && n >= pieces) return 'If every piece was accepted, deliver it instead.';
      }
      if (!photo) return 'Take a photo first. An exception with no picture cannot be closed.';
      return null;
    }
    function state() { var m = missing(); done.disabled = !!m; why.textContent = m || ''; s.error(''); }
    state();
    if (opts._test) opts._test({ setPhoto: setPhoto, choose: function (type) { var all = grid.querySelectorAll('.reason'); for (var k = 0; k < reasons.length; k++) if (reasons[k].type === type) all[k].click(); }, done: done });
    return s.promise;
  }

  /* ---------------- 4. cash on delivery: the receipt that is not optional ---------------- */
  function receipt(opts) {
    opts = opts || {};
    var owed = Number(opts.amountThebe) || 0;
    var s = sheet(opts.title || 'Cash on delivery', 'P' + pula(owed) + ' is owed on this parcel. Enter what was collected and photograph the cash or the EFT receipt. The job cannot close without the photo.');
    var amt = el('input', 'field'); amt.type = 'number'; amt.step = '0.01'; amt.min = '0'; amt.setAttribute('inputmode', 'decimal'); amt.placeholder = 'Collected, in Pula'; amt.value = (owed / 100).toFixed(2);
    s.body.appendChild(amt);
    var photoRow = el('div', 'photo'); var label = el('label', '', 'Photograph the receipt');
    var input = el('input'); input.type = 'file'; input.accept = 'image/*'; input.setAttribute('capture', 'environment'); label.appendChild(input);
    var thumb = el('img', 'thumb'); thumb.alt = ''; photoRow.appendChild(label); photoRow.appendChild(thumb); s.body.appendChild(photoRow);
    var why = el('div', 'why', ''); s.body.appendChild(why);
    var photo = null;
    function setPhoto(d) { photo = d || null; thumb.src = photo || ''; thumb.className = 'thumb' + (photo ? ' show' : ''); label.textContent = photo ? 'Retake the photo' : 'Photograph the receipt'; label.appendChild(input); state(); }
    input.addEventListener('change', function () { var f = input.files && input.files[0]; if (!f) return; shrink(f).then(setPhoto, function (e) { s.error(e.message); setPhoto(null); }); });
    var row = el('div', 'row');
    var cancel = button('Cancel', '', function () { s.close(null); });
    var done = button('Done', 'go', function () {
      var m = missing(); if (m) { s.error(m); return; }
      var collected = Math.round(parseFloat(amt.value) * 100);
      s.close({ collectedThebe: collected, photo: photo, owedThebe: owed, shortThebe: Math.max(0, owed - collected) });
    });
    row.appendChild(cancel); row.appendChild(done); s.body.appendChild(row);
    function missing() {
      var v = parseFloat(amt.value);
      if (isNaN(v) || v < 0) return 'Say how much was collected.';
      if (!photo) return 'Photograph the cash or the receipt first.';
      var c = Math.round(v * 100);
      if (c < owed) return null;
      return null;
    }
    function state() { var m = missing(); done.disabled = !!m; var c = Math.round(parseFloat(amt.value || '0') * 100); why.textContent = m || (c < owed ? 'Short by P' + pula(owed - c) + '. Dispatch will be asked to approve it.' : ''); s.error(''); }
    amt.addEventListener('input', state); state();
    if (opts._test) opts._test({ setPhoto: setPhoto, done: done, amt: amt });
    return s.promise;
  }
  function pula(thebe) { var n = Math.round(Number(thebe) || 0); return (n / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  /* ---------------- 5. the tape measure: length, width, height in centimetres ---------------- */
  function dims(opts) {
    opts = opts || {};
    var s = sheet(opts.title || 'Measure the parcel', 'Length, width and height in centimetres. A parcel bigger than it is heavy is charged on its size.');
    var f = ['Length cm', 'Width cm', 'Height cm'].map(function (ph) { var i = el('input', 'field'); i.type = 'number'; i.min = '1'; i.setAttribute('inputmode', 'numeric'); i.placeholder = ph; s.body.appendChild(i); i.addEventListener('input', state); return i; });
    var why = el('div', 'why', ''); s.body.appendChild(why);
    var row = el('div', 'row');
    var cancel = button('Cancel', '', function () { s.close(null); });
    var done = button('Done', 'go', function () { var m = missing(); if (m) { s.error(m); return; } s.close({ lengthCm: +f[0].value, widthCm: +f[1].value, heightCm: +f[2].value }); });
    row.appendChild(cancel); row.appendChild(done); s.body.appendChild(row);
    function missing() { for (var i = 0; i < 3; i++) { var v = parseFloat(f[i].value); if (isNaN(v) || v <= 0) return 'All three sides are needed.'; } return null; }
    function state() { var m = missing(); done.disabled = !!m; why.textContent = m || ('By volume: ' + (Math.round(f[0].value * f[1].value * f[2].value / 50) / 100) + ' kg'); s.error(''); }
    state();
    return s.promise;
  }

  root.SprintEPOD = { sign: sign, scan: scan, exception: exception, receipt: receipt, dims: dims, EXTRA_REASONS: EXTRA };
})(typeof window !== 'undefined' ? window : this);
