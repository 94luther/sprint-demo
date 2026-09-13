/* Sprint OS, brick 72: the reference patterns made to WORK, not only drawn.
 *
 * docs/DESIGN-LANGUAGE.md lifted six patterns from the two reference apps Sales chose.
 * Bricks 50, 51 and 53 drew them. This file makes them answer a touch, and it is the
 * only place they live, so a department page stays thin: it calls a function here and
 * gets a working component back. Plain browser JS, no build step, loaded after the
 * page's own script. Everything is ASCII on purpose: a page served without a charset
 * header must not turn into mojibake.
 *
 *   progressLine(shipment)             the four step line, each step tells its time when touched
 *   driverRow(driver, shipment, who)   the delivery partner row: call, or a warm draft that never sends
 *   scoreRing(el, opts)                the score ring, draws on, flips to the numbers behind it
 *   searchField(mount, opts)           search as you type over the rows already on the page
 *   bookingPicker(mount, onPick)       a real calendar and time slots for a collection booking
 *
 * Nothing here sends anything, calls anyone, or invents a number. If a figure is not in
 * the data the ring says so and names who captures it (feedback_never_print_unproven_zero).
 */
(function () {
  'use strict';
  if (window.SprintPatterns) return;

  /* ---------- the look, injected once so a page only needs the script tag ---------- */
  var CSS = [
    /* progress line, the same shape brick 53 put on the driver page */
    '.sp-prog{display:flex;align-items:flex-start;margin:10px 0 2px;padding:0 2px;position:relative}',
    '.sp-prog .st{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;position:relative;min-width:0;min-height:44px;padding-top:2px;cursor:pointer;-webkit-tap-highlight-color:transparent}',
    '.sp-prog .st .dot{width:12px;height:12px;border-radius:50%;background:rgba(255,255,255,.22);border:2px solid rgba(255,255,255,.28);box-sizing:border-box;z-index:1}',
    '.sp-prog .st .lab{font-size:9.5px;font-weight:700;color:#A7B5AE;margin-top:5px;white-space:nowrap;letter-spacing:.2px}',
    '.sp-prog .st::before{content:"";position:absolute;top:5px;left:-50%;width:100%;height:0;border-top:2px dotted rgba(255,255,255,.28)}',
    '.sp-prog .st:first-child::before{display:none}',
    '.sp-prog .st.done .dot{background:#F7941D;border-color:#F7941D}',
    '.sp-prog .st.done .lab{color:#FDBE74}',
    '.sp-prog .st.done::before{border-top-color:#F7941D;border-top-style:solid}',
    '.sp-prog .st.now .dot{background:rgba(14,32,24,.9);border-color:#F7941D;box-shadow:0 0 0 3px rgba(247,148,29,.28)}',
    '.sp-prog .st.now .lab{color:#fff}',
    '.sp-prog .st.now::before{border-top-color:#F7941D;border-top-style:solid}',
    '.sp-prog.delivered .st .dot{background:#3AAA35;border-color:#3AAA35}',
    '.sp-prog.delivered .st .lab{color:#8FE08A}',
    '.sp-prog.delivered .st::before{border-top-color:#3AAA35;border-top-style:solid}',
    '.sp-prog.exception .st.now .dot{border-color:#FF6B61;box-shadow:0 0 0 3px rgba(255,107,97,.28)}',
    '.sp-prog.exception .st.now .lab{color:#FFB3AD}',
    /* the time a step shows when touched */
    '.sp-prog .when{position:absolute;top:-30px;left:50%;transform:translateX(-50%);background:rgba(8,28,20,.92);border:1px solid rgba(255,255,255,.26);color:#F4F7F5;font-size:10.5px;font-weight:700;padding:4px 8px;border-radius:999px;white-space:nowrap;z-index:3;pointer-events:none}',
    '.sp-prog .when.none{color:#A7B5AE;font-weight:600}',

    /* driver row */
    '.sp-driver{display:flex;align-items:center;gap:11px;padding:10px 0;margin:8px 0 2px}',
    '.sp-driver .av{width:40px;height:40px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;background:rgba(58,170,53,.22);color:#8FE08A;font-weight:800;font-size:13.5px;letter-spacing:.3px}',
    '.sp-driver .who{flex:1;min-width:0}',
    '.sp-driver .who b{display:block;color:#F4F7F5;font-size:14px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.sp-driver .who span{display:block;color:#A7B5AE;font-size:11.5px;margin-top:2px}',
    '.sp-driver .act{width:44px;height:44px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;border:1px solid rgba(255,255,255,.26);background:rgba(255,255,255,.08);cursor:pointer;text-decoration:none;padding:0}',
    '.sp-driver .act svg{width:19px;height:19px;stroke:#F4F7F5;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}',
    '.sp-driver .act.call{background:#3AAA35;border-color:#3AAA35}',
    '.sp-driver .act.call svg{stroke:#fff}',
    '.sp-driver .act[disabled],.sp-driver .act.off{opacity:.38;cursor:not-allowed}',
    '.sp-driver.none{color:#A7B5AE;font-size:12.5px;padding:8px 0}',

    /* the sheet a draft opens in. Its own, so it never fights a page drawer. */
    '.sp-sheet-bg{position:fixed;inset:0;background:rgba(5,15,10,.55);z-index:90;display:none}',
    '.sp-sheet-bg.show{display:block}',
    '.sp-sheet{position:fixed;left:0;right:0;bottom:0;z-index:91;display:none;max-height:82vh;overflow:auto;padding:16px 18px 22px;box-sizing:border-box;',
    '  background:rgba(8,28,20,.86);border:1px solid rgba(255,255,255,.26);border-bottom:0;border-radius:22px 22px 0 0;',
    '  backdrop-filter:blur(22px) saturate(150%);-webkit-backdrop-filter:blur(22px) saturate(150%);box-shadow:0 -22px 54px -24px rgba(0,0,0,.65);color:#F4F7F5}',
    '.sp-sheet.show{display:block}',
    '.sp-sheet h3{margin:0 0 4px;font-size:16px;font-weight:800;color:#F4F7F5}',
    '.sp-sheet .to{font-size:12px;color:#A7B5AE;margin-bottom:10px}',
    '.sp-sheet textarea{width:100%;box-sizing:border-box;min-height:150px;border-radius:14px;border:1px solid rgba(255,255,255,.26);background:rgba(255,255,255,.06);color:#F4F7F5;font:inherit;font-size:13.5px;line-height:1.5;padding:12px;resize:vertical}',
    '.sp-sheet .row{display:flex;gap:10px;align-items:center;margin-top:12px}',
    '.sp-sheet .copy{flex:1;display:flex;align-items:center;gap:10px;min-height:44px;background:#fff;color:#0E2F22;border:0;border-radius:999px;padding:5px 14px 5px 5px;font:inherit;font-weight:800;font-size:14px;cursor:pointer}',
    '.sp-sheet .copy i{width:30px;height:30px;border-radius:50%;background:#F7941D;display:flex;align-items:center;justify-content:center;flex:none}',
    '.sp-sheet .copy svg{width:16px;height:16px;stroke:#fff;fill:none;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}',
    '.sp-sheet .close{background:rgba(255,255,255,.1);color:#F4F7F5;border:1px solid rgba(255,255,255,.26);border-radius:999px;min-height:44px;padding:0 16px;font:inherit;font-weight:700;cursor:pointer}',
    '.sp-sheet .note{font-size:11.5px;color:#A7B5AE;margin-top:10px;line-height:1.45}',
    '.sp-sheet .done{color:#8FE08A;font-weight:800;font-size:12.5px;margin-left:4px}',

    /* score ring */
    '.sp-ring{position:relative;width:132px;height:132px;cursor:pointer;-webkit-tap-highlight-color:transparent;flex:none}',
    '.sp-ring svg{display:block;width:132px;height:132px;transform:rotate(-90deg)}',
    '.sp-ring .track{fill:none;stroke:rgba(255,255,255,.14);stroke-width:11}',
    '.sp-ring .arc{fill:none;stroke:#3AAA35;stroke-width:11;stroke-linecap:round;transition:stroke-dashoffset .7s cubic-bezier(.2,.7,.2,1)}',
    '.sp-ring .mid{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:14px;box-sizing:border-box}',
    '.sp-ring .n{font-size:30px;font-weight:800;line-height:1;color:#F4F7F5;letter-spacing:-.8px}',
    '.sp-ring .n.none{font-size:13px;line-height:1.25;color:#A7B5AE}',
    '.sp-ring .l{font-size:9.5px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#A7B5AE;margin-top:4px}',
    '.sp-ring .back{display:none;font-size:11.5px;line-height:1.35;color:#F4F7F5;font-weight:700}',
    '.sp-ring.flip .front{display:none}',
    '.sp-ring.flip .back{display:block}',
    '.sp-ring.flip .arc{stroke:#FDBE74}',
    '.sp-ring .hint{position:absolute;bottom:-16px;left:0;right:0;text-align:center;font-size:9.5px;color:#A7B5AE}',
    '.sp-ring-wrap{display:flex;gap:16px;align-items:center;flex-wrap:wrap;padding-bottom:16px}',
    '.sp-ring-side{flex:1;min-width:150px;font-size:12.5px;color:#C9D6CF;line-height:1.45}',
    '.sp-ring-side b{color:#F4F7F5;display:block;font-size:14px;margin-bottom:3px}',
    '@media (prefers-reduced-motion: reduce){.sp-ring .arc{transition:none}}',

    /* search */
    '.sp-search{display:flex;align-items:center;gap:10px;padding:6px 8px 6px 14px;margin:0 0 12px;border-radius:16px;background:rgba(8,28,20,.40);border:1px solid rgba(255,255,255,.26);backdrop-filter:blur(22px) saturate(150%);-webkit-backdrop-filter:blur(22px) saturate(150%)}',
    '.sp-search svg{width:18px;height:18px;flex:none;stroke:#A7B5AE;fill:none;stroke-width:2.2;stroke-linecap:round}',
    '.sp-search input{flex:1;min-width:0;height:44px;background:none;border:0;outline:0;color:#F4F7F5;font:inherit;font-size:16px}',
    '.sp-search input::placeholder{color:#A7B5AE}',
    '.sp-search .cnt{font-size:11px;font-weight:800;color:#FDBE74;white-space:nowrap}',
    '.sp-search .x{width:44px;height:44px;font-size:18px;border-radius:50%;border:0;background:rgba(255,255,255,.1);color:#F4F7F5;font:inherit;font-weight:800;cursor:pointer;display:none;align-items:center;justify-content:center;line-height:1}',
    '.sp-search.has .x{display:flex}',
    '.sp-hide{display:none !important}',

    /* booking picker */
    '.sp-cal{border-radius:18px;padding:10px 6px 12px;margin:8px 0;box-sizing:border-box;width:100%;background:rgba(8,28,20,.40);border:1px solid rgba(255,255,255,.26);backdrop-filter:blur(22px) saturate(150%);-webkit-backdrop-filter:blur(22px) saturate(150%);color:#F4F7F5}',
    '.sp-cal .head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}',
    '.sp-cal .head b{font-size:14px;font-weight:800}',
    '.sp-cal .head button{width:44px;height:44px;border-radius:50%;border:1px solid rgba(255,255,255,.26);background:rgba(255,255,255,.08);color:#F4F7F5;font:inherit;font-weight:800;cursor:pointer}',
    '.sp-cal .grid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px}',
    '.sp-cal .dn{text-align:center;font-size:9.5px;font-weight:800;letter-spacing:.6px;color:#A7B5AE;padding:2px 0 4px}',
    '.sp-cal .d{height:44px;min-height:44px;border-radius:12px;border:0;background:rgba(255,255,255,.06);color:#F4F7F5;font:inherit;font-size:13px;font-weight:700;cursor:pointer}',
    '.sp-cal .d.pad{background:none;cursor:default}',
    '.sp-cal .d.off{opacity:.3;cursor:not-allowed}',
    '.sp-cal .d.today{box-shadow:inset 0 0 0 2px #F7941D}',
    '.sp-cal .d.on{background:#3AAA35;color:#fff}',
    '.sp-cal .slots{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}',
    '.sp-cal .slot{border-radius:999px;border:1px solid rgba(255,255,255,.26);background:rgba(255,255,255,.08);color:#F4F7F5;font:inherit;font-size:13px;font-weight:800;min-height:44px;padding:0 16px;cursor:pointer}',
    /* the picked slot is green like the picked day: one orange per card, and that one is the Go button */
    '.sp-cal .slot.on{background:#3AAA35;border-color:#3AAA35;color:#fff}',
    '.sp-cal .say{font-size:12px;color:#A7B5AE;margin-top:10px;line-height:1.45}',
    '.sp-cal .say b{color:#8FE08A}',
    '.sp-cal .go{margin-top:10px;width:100%;display:flex;align-items:center;gap:10px;min-height:44px;background:#fff;color:#0E2F22;border:0;border-radius:999px;padding:5px 14px 5px 5px;font:inherit;font-weight:800;font-size:14px;cursor:pointer}',
    '.sp-cal .go[disabled]{opacity:.4;cursor:not-allowed}',
    '.sp-cal .go i{width:30px;height:30px;border-radius:50%;background:#F7941D;display:flex;align-items:center;justify-content:center;flex:none}',
    '.sp-cal .go svg{width:16px;height:16px;stroke:#fff;fill:none;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}'
  ].join('\n');

  var style = document.createElement('style');
  style.setAttribute('data-sprint-patterns', '');
  style.textContent = CSS;
  document.head.appendChild(style);

  /* ---------- small helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function two(n) { return (n < 10 ? '0' : '') + n; }
  /* Gaborone is UTC+2 all year, so a time is shown the way the office clock shows it. */
  function whenLabel(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    var t = new Date(d.getTime() + 2 * 3600 * 1000);
    var today = new Date(Date.now() + 2 * 3600 * 1000);
    var sameDay = t.getUTCFullYear() === today.getUTCFullYear() && t.getUTCMonth() === today.getUTCMonth() && t.getUTCDate() === today.getUTCDate();
    var hm = two(t.getUTCHours()) + ':' + two(t.getUTCMinutes());
    return sameDay ? 'today ' + hm : DAYS[t.getUTCDay()].slice(0, 3) + ' ' + t.getUTCDate() + ' ' + MONTHS[t.getUTCMonth()].slice(0, 3) + ', ' + hm;
  }
  function initials(name) {
    return String(name || '').replace(/^EXAMPLE\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0].toUpperCase(); }).join('') || '?';
  }
  var ICON = {
    call: '<svg viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
    msg: '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-8 8H8l-5 3 1.5-4.5A8 8 0 1 1 21 12z"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    tick: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>'
  };

  /* =====================================================================
     A. the four step progress line
     ===================================================================== */
  var STEPS = ['Booked', 'Collected', 'In transit', 'Delivered'];
  var REACHED = { booked: 0, collected: 1, in_transit: 2, out_for_delivery: 2, delivered: 3, exception: 2 };

  function progressLine(s) {
    s = s || {};
    var reached = REACHED[s.status];
    if (reached === undefined) reached = 0;
    var cls = s.status === 'delivered' ? 'delivered' : (s.status === 'exception' ? 'exception' : '');
    /* the time each step happened, read off the row; a step with no time says so rather than guessing */
    var times = [
      whenLabel(s.booked_at || s.created_at),
      whenLabel(s.collected_at),
      whenLabel(s.in_transit_at || s.dispatched_at),
      whenLabel(s.delivered_at)
    ];
    return '<div class="sp-prog ' + cls + '" data-sp-prog>' + STEPS.map(function (lab, i) {
      var st = i < reached ? 'done' : (i === reached ? 'now' : '');
      if (s.status === 'delivered') st = 'done';
      var when = times[i] ? esc(times[i]) : (i <= reached ? 'time not recorded' : 'not yet');
      return '<div class="st ' + st + '" data-when="' + when + '" title="' + when + '"><div class="dot"></div><div class="lab">' + lab + '</div></div>';
    }).join('') + '</div>';
  }
  /* one listener for every line on the page, present or added later */
  document.addEventListener('click', function (e) {
    var st = e.target.closest && e.target.closest('.sp-prog .st');
    if (!st) return;
    e.stopPropagation();
    var open = st.querySelector('.when');
    var all = document.querySelectorAll('.sp-prog .when');
    for (var i = 0; i < all.length; i++) all[i].parentNode.removeChild(all[i]);
    if (open) return;
    var w = document.createElement('div');
    var text = st.getAttribute('data-when') || 'not yet';
    w.className = 'when' + (/not yet|not recorded/.test(text) ? ' none' : '');
    w.textContent = text;
    st.appendChild(w);
    setTimeout(function () { if (w.parentNode) w.parentNode.removeChild(w); }, 3500);
  }, true);

  /* =====================================================================
     B. the driver row, and the draft that never sends
     ===================================================================== */
  var SHEET = null;
  function sheet() {
    if (SHEET) return SHEET;
    var bg = document.createElement('div'); bg.className = 'sp-sheet-bg';
    var sh = document.createElement('div'); sh.className = 'sp-sheet';
    document.body.appendChild(bg); document.body.appendChild(sh);
    bg.addEventListener('click', closeSheet);
    SHEET = { bg: bg, el: sh };
    return SHEET;
  }
  function closeSheet() { if (!SHEET) return; SHEET.bg.className = 'sp-sheet-bg'; SHEET.el.className = 'sp-sheet'; }
  function openSheet(html) {
    var s = sheet();
    s.el.innerHTML = html;
    s.bg.className = 'sp-sheet-bg show';
    s.el.className = 'sp-sheet show';
  }

  /* Warm language: short sentences, no dashes anywhere. The customer's name is the account name
     the page already shows; nothing is looked up, nothing is invented. */
  function draftFor(driver, s, who) {
    var name = String(who || 'there').replace(/^EXAMPLE\s+/i, '');
    var where = s.destination ? ' to ' + s.destination : '';
    var wb = s.waybill ? ' Waybill ' + s.waybill + '.' : '';
    var line;
    switch (s.status) {
      case 'booked': line = 'Your parcel' + where + ' is booked and ' + driver.name + ' will collect it shortly.'; break;
      case 'collected': line = driver.name + ' has collected your parcel' + where + ' and it is on its way to us.'; break;
      case 'in_transit': line = 'Your parcel' + where + ' is on the road with ' + driver.name + '.'; break;
      case 'out_for_delivery': line = driver.name + ' is out delivering your parcel' + where + ' today. Please keep your phone close.'; break;
      case 'delivered': line = 'Your parcel' + where + ' was delivered by ' + driver.name + '. Thank you for sending with Sprint.'; break;
      case 'exception': line = 'There is a small hold up with your parcel' + where + '. ' + driver.name + ' is on it and we will call you with the next step.'; break;
      default: line = driver.name + ' is looking after your parcel' + where + '.';
    }
    return 'Hello ' + name + '. ' + line + wb + ' Sprint Couriers.';
  }

  function driverRow(driver, s, who) {
    if (!driver) return '<div class="sp-driver none" data-sp-driver="none">No driver assigned yet.</div>';
    var phone = driver.phone || driver.mobile || '';
    var call = phone
      ? '<a class="act call" href="tel:' + esc(String(phone).replace(/\s+/g, '')) + '" title="Call ' + esc(driver.name) + '">' + ICON.call + '</a>'
      : '<span class="act call off" title="No number on file for this driver">' + ICON.call + '</span>';
    return '<div class="sp-driver" data-sp-driver="' + esc(driver.id || '') + '">' +
      '<div class="av">' + esc(initials(driver.name)) + '</div>' +
      '<div class="who"><b>' + esc(driver.name) + '</b><span>' + (phone ? esc(phone) : 'no number on file') + '</span></div>' +
      '<button class="act" type="button" data-sp-msg="1" title="Write to the customer">' + ICON.msg + '</button>' +
      call + '</div>';
  }
  /* the message button finds its own row's draft through a registry, so the page never holds text */
  var DRAFTS = {};
  function registerDraft(key, driver, s, who) { DRAFTS[key] = { driver: driver, s: s, who: who }; return key; }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-sp-msg]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    var row = b.closest('.sp-driver');
    var key = row && row.getAttribute('data-sp-key');
    var d = key && DRAFTS[key];
    if (!d) return;
    var text = draftFor(d.driver, d.s, d.who);
    openSheet(
      '<h3>A message for the customer</h3>' +
      '<div class="to">To ' + esc(String(d.who || '').replace(/^EXAMPLE\s+/i, '')) + ' about ' + esc(d.s.waybill || 'this parcel') + '. Read it, change what you like, then copy it into WhatsApp.</div>' +
      '<textarea id="spDraft">' + esc(text) + '</textarea>' +
      '<div class="row"><button class="copy" type="button" data-sp-copy="1"><i>' + ICON.copy + '</i>Copy the message<span class="done" data-sp-done></span></button>' +
      '<button class="close" type="button" data-sp-close="1">Close</button></div>' +
      '<div class="note">Nothing is sent from here. The number stays on the office system and the message goes out from a phone a person is holding.</div>'
    );
  }, true);
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('[data-sp-close]')) { closeSheet(); return; }
    var c = e.target.closest && e.target.closest('[data-sp-copy]');
    if (!c) return;
    var ta = document.getElementById('spDraft');
    if (!ta) return;
    var done = c.querySelector('[data-sp-done]');
    function ok() { if (done) done.textContent = 'copied'; }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(ok, function () { ta.select(); document.execCommand('copy'); ok(); });
    else { ta.select(); document.execCommand('copy'); ok(); }
  });

  /* =====================================================================
     C. the score ring
     ===================================================================== */
  function scoreRing(el, o) {
    if (!el) return;
    o = o || {};
    var R = 54, C = 2 * Math.PI * R;
    var known = typeof o.value === 'number' && !isNaN(o.value);
    var v = known ? Math.max(0, Math.min(100, o.value)) : 0;
    var col = o.colour || (v >= 85 ? '#3AAA35' : v >= 70 ? '#F7941D' : '#FF6B61');
    var front = known
      ? '<div class="n">' + esc(o.shown != null ? o.shown : Math.round(v) + '%') + '</div><div class="l">' + esc(o.label || '') + '</div>'
      : '<div class="n none">No data yet</div><div class="l">' + esc(o.label || '') + '</div>';
    var back = known
      ? esc(o.detail || '')
      : esc((o.why ? o.why + ' ' : '') + (o.owner ? 'Owner: ' + o.owner + '.' : ''));
    el.innerHTML =
      '<div class="sp-ring" data-sp-ring role="button" tabindex="0" aria-label="' + esc(o.label || 'score') + ', touch for the numbers behind it">' +
      '<svg viewBox="0 0 132 132"><circle class="track" cx="66" cy="66" r="' + R + '"/>' +
      '<circle class="arc" cx="66" cy="66" r="' + R + '" style="stroke:' + (known ? col : 'rgba(255,255,255,.14)') + ';stroke-dasharray:' + C.toFixed(1) + ';stroke-dashoffset:' + C.toFixed(1) + '"/></svg>' +
      '<div class="mid"><div class="front">' + front + '</div><div class="back">' + back + '</div></div>' +
      '<div class="hint">touch for the numbers</div></div>';
    var arc = el.querySelector('.arc');
    var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var target = (C * (1 - (known ? v / 100 : 0))).toFixed(1);
    /* a timer, not requestAnimationFrame: a frame callback never fires in a hidden tab, and a ring
       that stays empty because the page opened in the background reads as a zero */
    if (still) arc.style.setProperty('stroke-dashoffset', target);
    else setTimeout(function () { arc.style.setProperty('stroke-dashoffset', target); }, 30);
    var ring = el.querySelector('.sp-ring');
    function flip() { ring.className = ring.className.indexOf('flip') >= 0 ? 'sp-ring' : 'sp-ring flip'; }
    ring.addEventListener('click', flip);
    ring.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
  }

  /* =====================================================================
     D. search as you type
     ===================================================================== */
  function searchField(mount, o) {
    if (!mount) return;
    o = o || {};
    var rowSel = o.rows || '.job-item';
    var scope = o.scope ? document.querySelector(o.scope) : document;
    mount.innerHTML = '<div class="sp-search" data-sp-search>' + ICON.search +
      '<input type="search" placeholder="' + esc(o.placeholder || 'Search a waybill, a customer, a driver') + '" aria-label="Search">' +
      '<span class="cnt"></span><button class="x" type="button" aria-label="Clear">&#215;</button></div>';
    var box = mount.querySelector('.sp-search'), input = box.querySelector('input'), cnt = box.querySelector('.cnt'), x = box.querySelector('.x');
    function rows() { return Array.prototype.slice.call((scope || document).querySelectorAll(rowSel)); }
    function apply() {
      var q = input.value.trim().toLowerCase();
      var all = rows(), shown = 0;
      all.forEach(function (r) {
        var hit = !q || (r.textContent || '').toLowerCase().indexOf(q) >= 0;
        if (hit) { r.classList.remove('sp-hide'); shown++; } else r.classList.add('sp-hide');
      });
      box.className = 'sp-search' + (q ? ' has' : '');
      cnt.textContent = q ? shown + ' of ' + all.length : (all.length ? all.length + (all.length === 1 ? ' row' : ' rows') : '');
      if (o.onQuery) o.onQuery(q, shown, all.length);
    }
    input.addEventListener('input', apply);
    x.addEventListener('click', function () { input.value = ''; apply(); input.focus(); });
    apply();
    return { apply: apply, input: input };
  }

  /* =====================================================================
     E. the booking picker: a real day, a real slot
     ===================================================================== */
  var SLOTS = ['08:00', '10:00', '12:00', '14:00', '16:00'];
  function bookingPicker(mount, onPick) {
    if (!mount) return;
    var now = new Date(Date.now() + 2 * 3600 * 1000);
    var today = { y: now.getUTCFullYear(), m: now.getUTCMonth(), d: now.getUTCDate() };
    var view = { y: today.y, m: today.m };
    var pick = { day: null, slot: null };
    var box = document.createElement('div');
    box.className = 'sp-cal';
    box.setAttribute('data-sp-cal', '');
    /* On a phone the calendar opens in the full width sheet, not inside the chat column: seven
       day buttons need 44 px each and a 322 px chat column cannot give them that. On a wide
       screen it sits inline where it was asked for. */
    var narrow = window.innerWidth < 480;
    if (narrow) {
      openSheet('<h3>When will it be ready?</h3><div class="to">Pick the day, then a time. Sundays are not collected.</div><div data-sp-cal-home></div>');
      SHEET.el.querySelector('[data-sp-cal-home]').appendChild(box);
    } else {
      mount.appendChild(box);
    }

    function isPast(y, m, d) { return y < today.y || (y === today.y && (m < today.m || (m === today.m && d < today.d))); }
    function sentence() {
      if (!pick.day || !pick.slot) return null;
      var dt = new Date(Date.UTC(pick.day.y, pick.day.m, pick.day.d));
      return DAYS[dt.getUTCDay()] + ' ' + pick.day.d + ' ' + MONTHS[pick.day.m] + ' at ' + pick.slot;
    }
    function draw() {
      var first = new Date(Date.UTC(view.y, view.m, 1)).getUTCDay();
      var days = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
      var h = '<div class="head"><button type="button" data-nav="-1" aria-label="Earlier month">&#8249;</button><b>' + MONTHS[view.m] + ' ' + view.y + '</b><button type="button" data-nav="1" aria-label="Later month">&#8250;</button></div>';
      h += '<div class="grid">' + ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(function (d) { return '<div class="dn">' + d + '</div>'; }).join('');
      for (var i = 0; i < first; i++) h += '<div class="d pad"></div>';
      for (var d = 1; d <= days; d++) {
        var dow = new Date(Date.UTC(view.y, view.m, d)).getUTCDay();
        var off = isPast(view.y, view.m, d) || dow === 0;   /* Sprint does not collect on a Sunday */
        var isT = view.y === today.y && view.m === today.m && d === today.d;
        var on = pick.day && pick.day.y === view.y && pick.day.m === view.m && pick.day.d === d;
        h += '<button type="button" class="d' + (off ? ' off' : '') + (isT ? ' today' : '') + (on ? ' on' : '') + '" data-d="' + d + '"' + (off ? ' disabled' : '') + '>' + d + '</button>';
      }
      h += '</div>';
      if (pick.day) {
        h += '<div class="slots">' + SLOTS.map(function (s) { return '<button type="button" class="slot' + (pick.slot === s ? ' on' : '') + '" data-slot="' + s + '">' + s + '</button>'; }).join('') + '</div>';
      }
      var sent = sentence();
      h += '<div class="say">' + (sent ? 'Ready for collection on <b>' + esc(sent) + '</b>.' : (pick.day ? 'Now pick a time it will be ready.' : 'Pick the day it will be ready. Sundays are not collected.')) + '</div>';
      h += '<button type="button" class="go" data-go="1"' + (sent ? '' : ' disabled') + '><i>' + ICON.tick + '</i>Use this day and time</button>';
      box.innerHTML = h;
    }
    box.addEventListener('click', function (e) {
      var t = e.target.closest('button'); if (!t) return;
      if (t.hasAttribute('data-nav')) {
        view.m += parseInt(t.getAttribute('data-nav'), 10);
        if (view.m < 0) { view.m = 11; view.y--; } if (view.m > 11) { view.m = 0; view.y++; }
        draw(); return;
      }
      if (t.hasAttribute('data-d') && !t.disabled) { pick.day = { y: view.y, m: view.m, d: parseInt(t.getAttribute('data-d'), 10) }; pick.slot = null; draw(); return; }
      if (t.hasAttribute('data-slot')) { pick.slot = t.getAttribute('data-slot'); draw(); return; }
      if (t.hasAttribute('data-go') && !t.disabled) { var s = sentence(); if (narrow) closeSheet(); if (s && onPick) onPick(s); }
    });
    draw();
    return { sentence: sentence, remove: function () { if (narrow) closeSheet(); if (box.parentNode) box.parentNode.removeChild(box); } };
  }

  /* A warm draft for anyone, not only a driver row: the cockpit's NEXT band asks Compliance a
     question about a tender, or Accounts about an overdue account, in the same sheet with the
     same one rule. It copies. It never sends. */
  function openDraft(title, to, text, note) {
    openSheet(
      '<h3>' + esc(title || 'A message to copy') + '</h3>' +
      '<div class="to">' + esc(to || '') + ' Read it, change what you like, then copy it into WhatsApp.</div>' +
      '<textarea id="spDraft">' + esc(text || '') + '</textarea>' +
      '<div class="row"><button class="copy" type="button" data-sp-copy="1"><i>' + ICON.copy + '</i>Copy the message<span class="done" data-sp-done></span></button>' +
      '<button class="close" type="button" data-sp-close="1">Close</button></div>' +
      '<div class="note">' + esc(note || 'Nothing is sent from here. A person presses send.') + '</div>'
    );
  }

  window.SprintPatterns = {
    progressLine: progressLine,
    driverRow: driverRow,
    registerDraft: registerDraft,
    draftFor: draftFor,
    openDraft: openDraft,
    scoreRing: scoreRing,
    searchField: searchField,
    bookingPicker: bookingPicker,
    closeSheet: closeSheet
  };
})();
