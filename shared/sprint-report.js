/* Sprint OS "what do you want to report" sheet. Brick 62.

   Sales, 13 Sep 2026: "fix the plus button so it asks what to report".

   The plus used to drop you straight onto the Incident Desk, which is right for
   an overturned vehicle and wrong for the other five things a person actually
   needs to report. Now it asks first, in the words somebody would use standing
   next to the problem, and takes them to the desk that records it.

   The order is deliberate. The thing that costs the most when it is late sits at
   the top and is the only orange item on the sheet. Nothing here saves anything
   by itself: each choice opens the desk where a person writes it down, and the
   sheet says so rather than implying a report was filed.

   Mount by putting id="report" on any element and loading this file. */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var ICONS = {
    crash: '<path d="M3 17h18M5 17V9l2-4h10l2 4v8"/><circle cx="7.5" cy="17.5" r="1.5"/><circle cx="16.5" cy="17.5" r="1.5"/><path d="M12 2v3M9 3l1 2M15 3l-1 2"/>',
    parcel: '<path d="M21 8v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8"/><path d="M2 4h20v4H2zM12 4v16"/>',
    fuel: '<path d="M3 21h10V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1z"/><path d="M13 9h3a2 2 0 0 1 2 2v6a2 2 0 0 0 2 2v0a2 2 0 0 0 2-2V9l-3-3"/><path d="M6 8h4"/>',
    heart: '<path d="M12 21s-7-4.7-9.3-9A5 5 0 0 1 12 6.5 5 5 0 0 1 21.3 12C19 16.3 12 21 12 21z"/>',
    handshake: '<path d="M12 8l3-2 6 4-5 6-3-3"/><path d="M12 8L9 6 3 10l5 6 3-3"/>',
    quote: '<path d="M4 4h16v12H8l-4 4z"/><path d="M8 9h8M8 12h5"/>'
  };

  var CHOICES = [
    { key: 'incident', accent: true, icon: 'crash',
      label: 'Something happened to a vehicle or a parcel',
      sub: 'An accident, a breakdown, a theft, water or damage. Anything where a customer may need to be told today.',
      go: 'incidents/index.html', desk: 'Incident Desk' },
    { key: 'exception', icon: 'parcel',
      label: 'A parcel cannot be delivered',
      sub: 'Nobody there, the address is wrong, the customer refused it, or it is going back on the van.',
      go: 'ops/index.html', desk: 'Ops Board' },
    { key: 'fuel', icon: 'fuel',
      label: 'A fuel slip or an odometer reading',
      sub: 'The litres and the reading at the pump. This is what turns into kilometres per litre and cost per delivery.',
      go: 'fleet/index.html', desk: 'Fleet and Fuel' },
    { key: 'complaint', icon: 'heart',
      label: 'A customer is unhappy',
      sub: 'A complaint, a late parcel they have phoned about, or something that needs an apology and a promise.',
      go: 'care/index.html', desk: 'Customer Care' },
    { key: 'lead', icon: 'handshake',
      label: 'A new enquiry or a lead',
      sub: 'Somebody asked what we charge, or a name worth calling. It goes on the pipeline before it is forgotten.',
      go: 'sales/index.html', desk: 'Sales Desk' },
    { key: 'quote', icon: 'quote',
      label: 'Somebody needs a price',
      sub: 'Weight, where from and where to. The quote desk works it out from the rate card.',
      go: 'quote/QuoteEngine.html', desk: 'Quote Desk' }
  ];

  var CSS = '' +
    '.sr-bg{position:fixed;inset:0;background:rgba(4,14,9,.62);backdrop-filter:blur(3px);opacity:0;pointer-events:none;transition:opacity .18s;z-index:998}' +
    '.sr-bg.open{opacity:1;pointer-events:auto}' +
    '.sr-sheet{position:fixed;left:0;right:0;bottom:0;max-height:88vh;overflow:auto;z-index:999;background:linear-gradient(170deg,rgba(12,45,32,.97),rgba(9,32,23,.98));border-radius:26px 26px 0 0;border-top:1px solid rgba(255,255,255,.24);box-shadow:0 -20px 60px -20px rgba(0,0,0,.8);transform:translateY(100%);transition:transform .22s cubic-bezier(.32,.72,0,1);padding:8px 0 24px;-webkit-overflow-scrolling:touch}' +
    '.sr-sheet.open{transform:translateY(0)}' +
    '.sr-grab{width:38px;height:4px;border-radius:999px;background:rgba(255,255,255,.3);margin:6px auto 14px}' +
    '.sr-head{padding:0 18px 2px}' +
    '.sr-head b{display:block;font-size:19px;font-weight:800;color:#F4F7F5;letter-spacing:-.2px}' +
    '.sr-head span{display:block;font-size:12.5px;color:#A7B5AE;margin-top:4px}' +
    '.sr-item{display:flex;gap:12px;align-items:flex-start;margin:10px 12px 0;padding:13px 14px;border-radius:18px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.13);cursor:pointer;transition:background .15s;text-align:left}' +
    '.sr-item:active{background:rgba(255,255,255,.14)}' +
    '.sr-item.accent{background:rgba(247,148,29,.14);border-color:rgba(247,148,29,.46)}' +
    '.sr-ic{width:42px;height:42px;border-radius:14px;background:rgba(58,170,53,.20);display:flex;align-items:center;justify-content:center;flex:none}' +
    '.sr-item.accent .sr-ic{background:#F7941D}' +
    '.sr-ic svg{width:21px;height:21px;stroke:#8FE08A;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}' +
    '.sr-item.accent .sr-ic svg{stroke:#fff}' +
    '.sr-b{flex:1;min-width:0}' +
    '.sr-l{font-size:14px;font-weight:800;color:#F4F7F5;line-height:1.25}' +
    '.sr-s{font-size:12.1px;color:#C9D6CF;margin-top:4px;line-height:1.35}' +
    '.sr-d{display:inline-block;font-size:10.5px;font-weight:800;letter-spacing:.3px;color:#8FE08A;background:rgba(58,170,53,.16);border:1px solid rgba(58,170,53,.36);border-radius:999px;padding:3px 9px;margin-top:8px}' +
    '.sr-item.accent .sr-d{color:#FDBE74;background:rgba(247,148,29,.18);border-color:rgba(247,148,29,.45)}' +
    '.sr-foot{font-size:11.4px;color:#93A29B;padding:16px 18px 0;line-height:1.45}' +
    '.sr-cancel{display:block;margin:14px auto 0;background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.2);color:#D2DCD7;border-radius:999px;font-weight:800;font-size:13px;padding:10px 26px;cursor:pointer;width:auto}';

  function injectCss() {
    if (document.getElementById('sr-css')) return;
    var s = document.createElement('style');
    s.id = 'sr-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function build(base, onHub) {
    var html = ['<div class="sr-grab"></div>',
      '<div class="sr-head"><b>What do you want to report?</b>',
      '<span>Pick the one closest to what happened. It opens the desk that writes it down.</span></div>'];
    CHOICES.forEach(function (c) {
      html.push('<div class="sr-item' + (c.accent ? ' accent' : '') + '" data-go="' + esc(base + c.go) + '" role="button" tabindex="0">' +
        '<span class="sr-ic"><svg viewBox="0 0 24 24">' + ICONS[c.icon] + '</svg></span>' +
        '<span class="sr-b"><span class="sr-l">' + esc(c.label) + '</span>' +
        '<span class="sr-s">' + esc(c.sub) + '</span>' +
        '<span class="sr-d">' + esc(c.desk) + '</span></span></div>');
    });
    html.push('<div class="sr-foot">' + (onHub
      ? 'Nothing is filed by picking one of these. Each opens the desk where a person writes it down, so what is recorded is what somebody meant to record.'
      : 'This is the example copy, so nothing typed here is saved anywhere. On the office system each of these opens the desk that records it against a real trip.') +
      '</div>');
    html.push('<button class="sr-cancel" type="button" id="sr-cancel">Nothing, close this</button>');
    return html.join('');
  }

  function open() {
    document.getElementById('sr-sheet').classList.add('open');
    document.getElementById('sr-bg').classList.add('open');
  }
  function close() {
    document.getElementById('sr-sheet').classList.remove('open');
    document.getElementById('sr-bg').classList.remove('open');
  }

  function boot() {
    var btn = document.getElementById('report');
    if (!btn) return;
    var path = location.pathname;
    var base = /\/(cockpit|sales|fleet|ops|incidents|insights|tenders|accounts|care|marketing|driver|demo|quote)\//.test(path) ? '../' : '';
    var h = location.hostname || '';
    var onHub = h === 'localhost' || h === '127.0.0.1' || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);

    injectCss();
    var bg = document.createElement('div'); bg.id = 'sr-bg'; bg.className = 'sr-bg';
    var sheet = document.createElement('div'); sheet.id = 'sr-sheet'; sheet.className = 'sr-sheet';
    sheet.innerHTML = build(base, onHub);
    document.body.appendChild(bg); document.body.appendChild(sheet);
    bg.addEventListener('click', close);

    sheet.querySelectorAll('.sr-item').forEach(function (el) {
      var go = function () { location.href = el.getAttribute('data-go'); };
      el.addEventListener('click', go);
      el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
    var cancel = document.getElementById('sr-cancel');
    if (cancel) cancel.addEventListener('click', close);

    btn.addEventListener('click', function (e) { e.preventDefault(); open(); });
    btn.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.SprintReport = { open: open, close: close };
})();
