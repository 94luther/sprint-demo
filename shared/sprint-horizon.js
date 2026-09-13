/* Sprint OS: what is coming. Brick 91.

   Sales, 13 September 2026: a board for "upcoming things, like maybe fuel price
   increasing on a certain day, house service, fuel up, or storm coming".

   Four bands down the page, soonest first, and every row says three things in
   this order: what is coming, what it costs you if it arrives unprepared, and
   what to do BEFORE it. The last line is the whole point. A warning that turns
   up on the day is not a warning, it is a report.

   What it never does: print a comforting zero. A band with nothing in it says
   so; a source with nothing RECORDED in it is listed underneath as a hole, by
   name, because nine vehicles with no service dates must never read as nine
   vehicles with nothing due. */
(function (root) {
  'use strict';
  var DATA = null, MOUNTED = null;

  var CSS = '' +
    '.hz{margin:14px 0 18px}' +
    '.hz h2{font-family:var(--font-display,inherit);font-size:22px;letter-spacing:.02em;margin:0 0 2px}' +
    '.hz .lede{font-size:12.5px;color:var(--dim,#a6a69f);margin:0 0 12px;line-height:1.45}' +
    '.hz .band{margin-bottom:14px}' +
    '.hz .band-h{display:flex;align-items:baseline;gap:10px;margin-bottom:7px}' +
    '.hz .band-h b{font-size:13px;font-weight:900;letter-spacing:.04em;text-transform:uppercase}' +
    '.hz .band-h span{font-size:12px;color:var(--dim,#a6a69f)}' +
    '.hz .row{display:flex;gap:12px;background:var(--panel,#1d1d19);border:1px solid var(--line,#2c2c27);border-left-width:4px;border-radius:10px;padding:11px 12px;margin-bottom:7px}' +
    '.hz .row.stop{border-left-color:var(--red,#e0483e)}' +
    '.hz .row.money{border-left-color:var(--orange,#F7941D)}' +
    '.hz .row.plan{border-left-color:var(--green,#3AAA35)}' +
    '.hz .row.watch{border-left-color:var(--line,#2c2c27)}' +
    '.hz .when{flex:none;width:62px;text-align:center}' +
    '.hz .when .n{font-family:var(--font-display,inherit);font-size:26px;line-height:1}' +
    '.hz .when .u{font-size:10px;color:var(--dim,#a6a69f);text-transform:uppercase;letter-spacing:.06em}' +
    '.hz .b{flex:1;min-width:0}' +
    '.hz .b .w{font-weight:800;font-size:14px;line-height:1.3}' +
    '.hz .b .s{font-size:12.5px;color:var(--dim,#a6a69f);margin-top:3px;line-height:1.45}' +
    '.hz .b .d{font-size:13px;margin-top:6px;line-height:1.4}' +
    '.hz .b .d b{color:var(--orange,#F7941D)}' +
    '.hz .tag{display:inline-block;font-size:9.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;padding:2px 7px;border-radius:20px;border:1px solid var(--line,#2c2c27);color:var(--dim,#a6a69f);margin-left:6px}' +
    '.hz .empty{font-size:12.5px;color:var(--dim,#a6a69f);padding:4px 0 8px}' +
    '.hz .gaps{border:1px dashed var(--line,#2c2c27);border-radius:10px;padding:11px 12px;margin-top:6px}' +
    '.hz .gaps b{font-size:12px;text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:6px}' +
    '.hz .gaps div{font-size:12.5px;color:var(--dim,#a6a69f);line-height:1.5;margin-bottom:5px}';

  function css() { if (document.getElementById('hz-css')) return; var s = document.createElement('style'); s.id = 'hz-css'; s.textContent = CSS; document.head.appendChild(s); }
  function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function when(d) { return d === 0 ? ['NOW', 'today'] : d === 1 ? ['1', 'day'] : [String(d), 'days']; }
  var CERTAIN = { recorded: 'on record', announced: 'announced', forecast: 'forecast' };

  function rowHtml(it) {
    var w = when(it.days_away);
    return '<div class="row ' + esc(it.severity) + '">' +
      '<div class="when"><div class="n">' + esc(w[0]) + '</div><div class="u">' + esc(w[1]) + '</div></div>' +
      '<div class="b"><div class="w">' + esc(it.what) +
        (it.certainty && it.certainty !== 'recorded' ? '<span class="tag">' + esc(CERTAIN[it.certainty] || it.certainty) + '</span>' : '') +
        (it.who ? '<span class="tag">' + esc(it.who) + '</span>' : '') + '</div>' +
      (it.so_what ? '<div class="s">' + esc(it.so_what) + '</div>' : '') +
      (it.do_now ? '<div class="d"><b>Do now:</b> ' + esc(it.do_now) + '</div>' : '') +
      '</div></div>';
  }

  function html() {
    var d = DATA;
    if (!d) return '<section class="hz"><h2>What is coming</h2><div class="empty">Reading the diary and the record.</div></section>';
    var h = ['<section class="hz"><h2>What is coming</h2>'];
    h.push('<p class="lede">Everything with a date on it, soonest first, with the thing to do before it arrives. Read from ' +
           esc((d.sources_read || []).join(', ')) + '.</p>');
    (d.bands || []).forEach(function (b) {
      h.push('<div class="band"><div class="band-h"><b>' + esc(b.label) + '</b><span>' +
             (b.items.length ? b.items.length + ' thing' + (b.items.length === 1 ? '' : 's') : 'nothing recorded') + '</span></div>');
      if (!b.items.length) h.push('<div class="empty">Nothing on record for this window. That is not the same as nothing coming; see what is not being watched, below.</div>');
      b.items.forEach(function (it) { h.push(rowHtml(it)); });
      h.push('</div>');
    });
    if ((d.gaps || []).length) {
      h.push('<div class="gaps"><b>What is not being watched</b>');
      d.gaps.forEach(function (g) { h.push('<div>' + esc(g.why) + (g.who ? ' <span class="tag">' + esc(g.who) + '</span>' : '') + '</div>'); });
      h.push('</div>');
    }
    h.push('</section>');
    return h.join('');
  }

  var EXAMPLE = null;
  function example(today) {
    if (EXAMPLE) return EXAMPLE;
    var mk = function (d, kind, sev, what, so, doNow, who, cert) {
      return { days_away: d, kind: kind, severity: sev, what: what, so_what: so, do_now: doNow, who: who, certainty: cert || 'recorded' };
    };
    var items = [
      mk(0, 'service', 'stop', 'EXAMPLE B 100 EXA: service due at 180,000 km, last reading 180,420 km',
         'This vehicle is past its service distance now.', 'Take it off the run and book it in.', 'Ops'),
      mk(1, 'weather', 'stop', 'EXAMPLE storm warning on the A1',
         'Invented for this screen. 2 runs the next day name that road: EXAMPLE Gaborone to Francistown; EXAMPLE Palapye return.',
         'Tell every customer on that road today, not tomorrow. Move the cold chain runs first.', 'Ops', 'forecast'),
      mk(4, 'fuel_price', 'money', 'EXAMPLE fuel price change',
         'Invented for this screen. Botswana pump prices are announced ahead, so this is always known before it happens.',
         'Fill every tank the day before it goes up.', 'Ops', 'announced'),
      mk(9, 'licence', 'stop', 'EXAMPLE driver Kabo: driving licence expires',
         'This driver cannot legally drive the day after, and a run with no driver is a run that does not happen.',
         'Tell Kabo today and put the renewal date in their hand.', 'Ops'),
      mk(14, 'paperwork', 'stop', 'EXAMPLE B 200 EXA: insurance expires',
         'One accident after this date is paid for out of the company.', 'Confirm the renewal with the broker in writing.', 'Ops'),
      mk(16, 'holiday', 'plan', 'EXAMPLE public holiday',
         'Invented for this screen. Nothing delivers.', 'Warn every customer expecting a parcel that day, and check no promised time falls on it.', 'Ops', 'announced'),
      mk(23, 'tender', 'money', 'EXAMPLE courier and logistics services closes (EXAMPLE Standards Board)',
         'A tender closes at a time of day, not a date. Late by one minute is not submitted.',
         'The pack must be finished the working day before, never on the morning.', 'Sales'),
      mk(41, 'document', 'stop', 'EXAMPLE trade licence expires',
         'A tender asking for this on the day it has lapsed is a tender lost on paperwork, not on price.',
         'Renew it, and put the new copy in the document register the same day.', 'Ops')
    ];
    var bands = [
      { key: 'today', label: 'Today and tomorrow', items: items.filter(function (i) { return i.days_away <= 1; }) },
      { key: 'week', label: 'This week', items: items.filter(function (i) { return i.days_away > 1 && i.days_away <= 7; }) },
      { key: 'month', label: 'Inside 30 days', items: items.filter(function (i) { return i.days_away > 7 && i.days_away <= 30; }) },
      { key: 'later', label: 'Inside 60 days', items: items.filter(function (i) { return i.days_away > 30; }) }
    ];
    EXAMPLE = { today: today || '', bands: bands, items: items,
      sources_read: ['vehicles', 'drivers', 'documents', 'tenders', 'trips', 'whats-coming.json'],
      gaps: [
        { kind: 'diary', who: 'Ops', why: 'EXAMPLE. Nobody has entered a real fuel price change, holiday, road closure or storm yet. Every row on the diary today is an invented example.' },
        { kind: 'service', who: 'Ops', why: 'EXAMPLE. 2 vehicles have no service date and no service distance recorded, so nothing can be said about them. That is not the same as nothing being due.' }
      ] };
    return EXAMPLE;
  }

  function mount(where) {
    css();
    var host = document.getElementById('hzBoard');
    if (!host) {
      host = document.createElement('div'); host.id = 'hzBoard';
      var anchor = where || document.getElementById('triLanes') || document.querySelector('section');
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(host, anchor.nextSibling);
      else document.body.appendChild(host);
    }
    host.innerHTML = html();
    MOUNTED = true;
  }

  async function load(force) {
    var isExample = false;
    try { isExample = !!(typeof DATA !== 'undefined' && root.DATA && root.DATA.example); } catch (e) { isExample = false; }
    if (isExample) { DATA = example(); return mount(); }
    if (DATA && !force) return mount();
    try {
      if (typeof apiFetch === 'function') DATA = await apiFetch('/api/horizon');
      else { var r = await fetch('/api/horizon', { credentials: 'include' }); var j = await r.json(); DATA = j.data; }
    } catch (e) { if (!DATA) DATA = example(); }
    mount();
  }

  root.SprintHorizon = { load: load, mount: mount, example: function () { DATA = example(); mount(); }, current: function () { return DATA; } };
  document.addEventListener('DOMContentLoaded', function () { setTimeout(function () { load(false); }, 600); });
  setInterval(function () { load(true); }, 10 * 60 * 1000);
})(typeof window !== 'undefined' ? window : this);
