/* Sprint OS notifications. Brick 69, replacing brick 61's bottom sheet.

   Sales, 13 Sep 2026: "my mum uses Facebook the most. What kind of design will
   be most intuitive to her? Think like her, the owner."

   So this copies the Facebook bell she has opened thousands of times, mapped to
   her business, and nothing else. docs/NOTIFICATIONS-DESIGN.md is the reasoning.

     a full page that slides in, not a little box
     a round picture on the left: initials for a customer, a van, a page
     the bold NAME first, then a plain sentence, then a grey time
     a small coloured badge on the picture: red now, orange soon, green good,
       grey for a thing the system cannot see yet
     unread rows tinted, with a dot; New and Earlier, never severity words
     the buttons for a decision sit under the row, one orange at most
     tap the row to go there and it turns read; three dots for Mark as read
       and Remove; swipe left to remove; Mark all as read at the top

   The house rule survives: a quiet bell must never mean all is well when it
   means nothing is connected. Those rows are grey and say so.

   Mount by giving any element id="bell" and loading this file. */
(function () {
  'use strict';

  var READ_KEY = 'sprintos_notify_read_v2';
  var GONE_KEY = 'sprintos_notify_removed_v2';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function ls(key) { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { return []; } }
  function lsAdd(key, ids) {
    try {
      var have = ls(key);
      ids.forEach(function (id) { if (have.indexOf(id) === -1) have.push(id); });
      localStorage.setItem(key, JSON.stringify(have.slice(-400)));
    } catch (e) { /* a private window forgets; the bell still works */ }
  }
  function ago(iso) {
    if (!iso) return '';
    var m = Math.floor((Date.now() - Date.parse(iso)) / 60000);
    if (isNaN(m)) return '';
    if (m < 1) return 'now';
    if (m < 60) return m + 'm';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h';
    var d = Math.floor(h / 24);
    if (d === 1) return 'Yesterday';
    if (d < 7) return d + 'd';
    return Math.floor(d / 7) + 'w';
  }
  function money(t) {
    var v = (Number(t || 0) / 100).toFixed(2).split('.');
    v[0] = v[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return 'P' + v.join('.');
  }
  function initials(name) {
    var w = String(name || '').replace(/^EXAMPLE\s+/, '').split(/\s+/).filter(Boolean);
    return ((w[0] || '?')[0] + (w[1] ? w[1][0] : '')).toUpperCase();
  }
  function hue(name) {
    var h = 0; for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    return h;
  }

  /* ---- every row: who, what, when, how bad, what to do ---------------------
     who     the bold name, always first
     kind    customer | vehicle | document | parcel | system, decides the picture
     level   now | soon | good | unseen, decides the badge and nothing else
     text    the plain sentence after the name
     act     { label, href }  the one orange button, optional
     more    { label, href }  the plain second button, optional              */
  var EXAMPLE = [
    { id: 'ex-inc-1', kind: 'vehicle', level: 'now', at: new Date(Date.now() - 42 * 60000).toISOString(),
      who: 'EXAMPLE B456ABC', text: 'overturned on the A1. 3 customers have parcels on it and none of them have been told.',
      act: { label: 'Text the 3 customers', href: 'incidents/index.html' }, more: { label: 'See it', href: 'incidents/index.html' } },
    { id: 'ex-doc-1', kind: 'document', level: 'now', at: new Date(Date.now() - 5 * 3600000).toISOString(),
      who: 'EXAMPLE trade licence', text: 'ran out 41 days ago. A tender asking for it today could not be answered.',
      act: { label: 'Fix the paperwork', href: 'cockpit/index.html' } },
    { id: 'ex-veh-1', kind: 'vehicle', level: 'soon', at: new Date(Date.now() - 32 * 60000).toISOString(),
      who: 'EXAMPLE B456ABC', text: 'has been standing 32 minutes near Mahalapye with EXAMPLE Driver Three. It may be a delivery, it may be a breakdown.',
      more: { label: 'See where it is', href: 'fleet/index.html' } },
    { id: 'ex-money-1', kind: 'customer', level: 'soon', at: new Date(Date.now() - 20 * 3600000).toISOString(),
      who: 'EXAMPLE Boteti Mining Supplies', text: 'owes P18 200.00, 38 days overdue. The largest and the oldest.',
      act: { label: 'Chase it', href: 'accounts/index.html' }, more: { label: 'Open', href: 'accounts/index.html' } },
    { id: 'ex-deal-1', kind: 'customer', level: 'soon', at: new Date(Date.now() - 3 * 86400000).toISOString(),
      who: 'EXAMPLE Sunrise Pharmacy Group', text: 'has gone quiet at replied. The next step was due 3 days ago.',
      act: { label: 'Call them', href: 'sales/index.html' }, more: { label: 'Open', href: 'sales/index.html' } },
    { id: 'ex-doc-2', kind: 'vehicle', level: 'soon', at: new Date(Date.now() - 26 * 3600000).toISOString(),
      who: 'EXAMPLE B456ABC', text: 'insurance runs out in 23 days. A vehicle whose insurance has lapsed should not be dispatched.',
      more: { label: 'See the vehicle', href: 'fleet/index.html' } },
    { id: 'ex-good-1', kind: 'parcel', level: 'good', at: new Date(Date.now() - 90 * 60000).toISOString(),
      who: '11 parcels', text: 'delivered today out of 26 booked. One went to exception, the rest are still running.',
      more: { label: 'Open the Ops Board', href: 'ops/index.html' } },
    { id: 'ex-good-2', kind: 'customer', level: 'good', at: new Date(Date.now() - 6 * 3600000).toISOString(),
      who: 'EXAMPLE Tlokweng Hardware', text: 'became a customer. Worth P1 320.00.',
      more: { label: 'Open', href: 'sales/index.html' } }
  ];

  function fromHub(c, live, base) {
    var out = [];
    (c.open_incidents || []).forEach(function (i) {
      out.push({ id: 'inc-' + i.id, kind: 'vehicle', level: (i.severity || 0) >= 3 ? 'now' : 'soon', at: i.opened_at,
        who: String(i.title || 'An incident'), text: 'is open, severity ' + i.severity + ', ' + i.status + '. Every customer with a parcel on it can be told in one tap.',
        act: { label: 'Text the customers', href: base + 'incidents/index.html' }, more: { label: 'See it', href: base + 'incidents/index.html' } });
    });
    (c.documents_expiring || []).forEach(function (d) {
      if (d.days_left < 0) out.push({ id: 'doc-' + d.name, kind: 'document', level: 'now', at: d.expires_at,
        who: d.name, text: 'ran out ' + Math.abs(d.days_left) + ' days ago. Owner ' + (d.owner || 'not named') + '.',
        act: { label: 'Fix the paperwork', href: base + 'cockpit/index.html' } });
      else if (d.days_left <= 60) out.push({ id: 'doc-' + d.name, kind: 'document', level: 'soon', at: d.expires_at,
        who: d.name, text: 'runs out in ' + d.days_left + ' days. Owner ' + (d.owner || 'not named') + '. Renewing takes longer than people expect.',
        more: { label: 'See the paperwork', href: base + 'cockpit/index.html' } });
    });
    ((c.cash || {}).overdue_by_customer || []).slice(0, 3).forEach(function (o) {
      if (!o.days || o.days < 14) return;
      out.push({ id: 'cash-' + o.customer, kind: 'customer', level: o.days > 30 ? 'now' : 'soon', at: null,
        who: o.customer, text: 'owes ' + money(o.amount_thebe) + ', ' + o.days + ' days overdue. Money already earned and not yet collected.',
        act: { label: 'Chase it', href: base + 'accounts/index.html' }, more: { label: 'Open', href: base + 'accounts/index.html' } });
    });
    ((live && live.vehicles) || []).forEach(function (v) {
      if (v.state === 'standing' && (v.standing_minutes || 0) >= 20) out.push({ id: 'veh-' + v.vehicle_id, kind: 'vehicle', level: 'soon', at: v.position && v.position.recorded_at,
        who: v.reg || 'A vehicle', text: 'has been standing ' + v.standing_minutes + ' minutes' + (v.trip && v.trip.driver_name ? ' with ' + v.trip.driver_name : '') + '. It may be a delivery, it may be a breakdown.',
        more: { label: 'See where it is', href: base + 'fleet/index.html' } });
      if (v.state === 'no_signal') out.push({ id: 'sig-' + v.vehicle_id, kind: 'vehicle', level: 'soon', at: v.position && v.position.recorded_at,
        who: v.reg || 'A vehicle', text: 'has gone quiet. ' + (v.note || 'The trip is open but the phone has stopped reporting.'),
        more: { label: 'See the fleet', href: base + 'fleet/index.html' } });
    });
    var jt = c.jobs_today || {};
    var booked = Object.keys(jt).reduce(function (a, k) { return a + jt[k]; }, 0);
    if (jt.exception) out.push({ id: 'exc-today', kind: 'parcel', level: 'soon', at: null,
      who: jt.exception + (jt.exception === 1 ? ' parcel' : ' parcels'), text: (jt.exception === 1 ? 'has' : 'have') + ' gone to exception today. An exception is a parcel that has stopped moving and needs a person.',
      more: { label: 'Open the Ops Board', href: base + 'ops/index.html' } });
    if (jt.delivered) out.push({ id: 'good-delivered', kind: 'parcel', level: 'good', at: null,
      who: jt.delivered + ' parcels', text: 'delivered today out of ' + booked + ' booked.',
      more: { label: 'Open the Ops Board', href: base + 'ops/index.html' } });
    // what the system cannot see is said, never left as silence
    if (c.on_time_rate_30d === null || c.on_time_rate_30d === undefined) out.push({ id: 'blind-ontime', kind: 'system', level: 'unseen', at: null,
      who: 'Deliveries on time', text: 'cannot be measured yet. No delivery in 30 days carries both a promised and a delivered time. Owner: Operations, at booking.',
      more: { label: 'Open the Cockpit', href: base + 'cockpit/index.html' } });
    if (c.documents_with_expiry_total === 0) out.push({ id: 'blind-docs', kind: 'system', level: 'unseen', at: null,
      who: 'The paperwork wall', text: 'is watching nothing. Not one document has an expiry date recorded, so nothing here can warn you before something lapses.',
      more: { label: 'Open the Cockpit', href: base + 'cockpit/index.html' } });
    if (!live || !(live.vehicles || []).some(function (v) { return v.position; })) out.push({ id: 'blind-fleet', kind: 'system', level: 'unseen', at: null,
      who: 'The fleet map', text: 'is empty. Positions come from the driver app while a trip is open, and no driver has run one yet.',
      more: { label: 'Open Fleet', href: base + 'fleet/index.html' } });
    return out;
  }

  /* ---- the page ------------------------------------------------------------ */
  var CSS = '' +
    '.sn-wrap{position:relative}' +
    '.sn-badge{position:absolute;top:-4px;right:-4px;min-width:20px;height:20px;border-radius:999px;font-size:11px;font-weight:800;color:#fff;display:flex;align-items:center;justify-content:center;padding:0 5px;border:2px solid rgba(8,28,20,.9)}' +
    '.sn-badge.now{background:#FF4438}.sn-badge.soon{background:#F7941D}.sn-badge.good{background:#3AAA35}.sn-badge.none{display:none}' +
    '.sn-page{position:fixed;inset:0;z-index:999;background:linear-gradient(170deg,rgba(11,52,37,.99),rgba(9,32,23,1));transform:translateX(100%);transition:transform .24s cubic-bezier(.32,.72,0,1);display:flex;flex-direction:column;overflow:hidden}' +
    '.sn-page.open{transform:translateX(0)}' +
    '.sn-top{display:flex;align-items:center;gap:8px;padding:calc(12px + env(safe-area-inset-top)) 12px 8px;flex:none}' +
    '.sn-back{width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;cursor:pointer;flex:none}' +
    '.sn-back svg{width:20px;height:20px;stroke:#F4F7F5;fill:none;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}' +
    '.sn-top h1{flex:1;font-size:24px;font-weight:900;color:#F4F7F5;margin:0;letter-spacing:-.3px}' +
    '.sn-readall{background:none;border:0;color:#8FE08A;font-size:13px;font-weight:800;cursor:pointer;padding:0 8px;min-height:44px;width:auto}' +
    '.sn-pills{display:flex;gap:8px;padding:2px 12px 10px;flex:none}' +
    '.sn-pill{border-radius:999px;padding:0 16px;min-height:44px;font-size:13px;font-weight:800;background:rgba(255,255,255,.08);color:#D2DCD7;border:1px solid rgba(255,255,255,.14);cursor:pointer;width:auto}' +
    '.sn-pill.on{background:#3AAA35;color:#fff;border-color:#3AAA35}' +
    '.sn-list{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;padding-bottom:calc(24px + env(safe-area-inset-bottom))}' +
    '.sn-h{font-size:16px;font-weight:800;color:#F4F7F5;padding:12px 16px 6px}' +
    '.sn-row{position:relative;overflow:hidden}' +
    '.sn-row .sn-del{position:absolute;inset:0;display:flex;align-items:center;justify-content:flex-end;padding-right:22px;background:#B93A32;color:#fff;font-weight:800;font-size:13px;opacity:0}' +
    '.sn-row .sn-del.lit{opacity:1}' +
    '.sn-card{position:relative;display:flex;gap:12px;align-items:flex-start;padding:12px 12px 12px 14px;background:transparent;transition:background .15s;will-change:transform}' +
    '.sn-row.moving .sn-card{transition:transform .2s cubic-bezier(.32,.72,0,1)}' +
    '.sn-card.unread{background:rgba(58,170,53,.13)}' +
    '.sn-card:active{background:rgba(255,255,255,.08)}' +
    '.sn-av{position:relative;width:56px;height:56px;flex:none}' +
    '.sn-av .sn-circle{width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:19px;font-weight:800;color:#fff;letter-spacing:.5px}' +
    '.sn-av .sn-circle svg{width:26px;height:26px;stroke:#fff;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}' +
    '.sn-av .sn-type{position:absolute;right:-3px;bottom:-3px;width:24px;height:24px;border-radius:50%;border:2.5px solid #0E2F22;display:flex;align-items:center;justify-content:center}' +
    '.sn-av .sn-type svg{width:13px;height:13px;stroke:#fff;fill:none;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}' +
    '.sn-type.now{background:#FF4438}.sn-type.soon{background:#F7941D}.sn-type.good{background:#3AAA35}.sn-type.unseen{background:#7C8C85}' +
    '.sn-body{flex:1;min-width:0;padding-right:4px}' +
    '.sn-text{font-size:14.2px;color:#E6EEE9;line-height:1.35}' +
    '.sn-text b{color:#fff;font-weight:800}' +
    '.sn-card.read .sn-text{color:#C9D6CF}.sn-card.read .sn-text b{color:#E6EEE9;font-weight:700}' +
    '.sn-when{font-size:12px;color:#93A29B;margin-top:3px}' +
    '.sn-card.unread .sn-when{color:#8FE08A;font-weight:700}' +
    '.sn-acts{display:flex;gap:8px;margin-top:9px;flex-wrap:wrap}' +
    '.sn-acts a{display:inline-flex;align-items:center;border-radius:8px;font-size:13px;font-weight:800;padding:8px 14px;text-decoration:none;cursor:pointer}' +
    '.sn-acts a.p{background:#F7941D;color:#fff}' +
    '.sn-acts a.s{background:rgba(255,255,255,.12);color:#F4F7F5;border:1px solid rgba(255,255,255,.18)}' +
    '.sn-right{display:flex;flex-direction:column;align-items:center;gap:6px;flex:none;padding-top:4px}' +
    '.sn-dot{width:11px;height:11px;border-radius:50%;background:#3AAA35;display:none}' +
    '.sn-card.unread .sn-dot{display:block}' +
    '.sn-more{width:32px;height:32px;border-radius:50%;background:transparent;border:0;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#C9D6CF;font-size:20px;font-weight:800;line-height:1;padding:0}' +
    '.sn-more:active{background:rgba(255,255,255,.12)}' +
    '.sn-menu{position:absolute;right:14px;top:44px;z-index:5;background:#123D2B;border:1px solid rgba(255,255,255,.22);border-radius:14px;box-shadow:0 18px 40px -14px rgba(0,0,0,.8);min-width:190px;overflow:hidden;display:none}' +
    '.sn-menu.open{display:block}' +
    '.sn-menu button{display:block;width:100%;text-align:left;background:none;border:0;color:#F4F7F5;font-size:14px;font-weight:700;padding:12px 16px;cursor:pointer}' +
    '.sn-menu button:active{background:rgba(255,255,255,.1)}' +
    '.sn-empty{margin:24px 16px;padding:22px 18px;border-radius:18px;background:rgba(255,255,255,.06);text-align:center;color:#C9D6CF;font-size:14px;line-height:1.45}' +
    '.sn-empty b{display:block;color:#F4F7F5;font-size:16px;margin-bottom:4px}' +
'.sn-alerts{display:flex;align-items:center;gap:10px;margin:0 12px 8px;padding:10px 12px;border-radius:14px;background:rgba(58,170,53,.12);border:1px solid rgba(58,170,53,.32);font-size:12.6px;color:#D2DCD7}' +
    '.sn-alerts span{flex:1;min-width:0}' +
    '.sn-alertbtn{background:#3AAA35;color:#fff;border:0;border-radius:999px;font-weight:800;font-size:12.5px;padding:0 16px;min-height:44px;cursor:pointer;width:auto;flex:none}' +
    '.sn-alertbtn.on{background:rgba(255,255,255,.12);color:#8FE08A}' +
    '.sn-foot{font-size:11.5px;color:#93A29B;padding:16px 16px 4px;line-height:1.45;text-align:center}';

  var ICON = {
    vehicle: '<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/>',
    document: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>',
    parcel: '<path d="M21 8v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8"/><path d="M2 4h20v4H2zM12 4v16"/>',
    system: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>'
  };
  var BADGE = {
    now: '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
    soon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    good: '<path d="M20 6 9 17l-5-5"/>',
    unseen: '<path d="M6 12h12"/>'
  };

  var ITEMS = [], FILTER = 'all';

  function injectCss() {
    if (document.getElementById('sn-css')) return;
    var s = document.createElement('style'); s.id = 'sn-css'; s.textContent = CSS; document.head.appendChild(s);
  }
  function badgeLevel() {
    var u = ITEMS.filter(function (i) { return !i.read && !i.gone; });
    if (u.some(function (i) { return i.level === 'now'; })) return 'now';
    if (u.some(function (i) { return i.level === 'soon'; })) return 'soon';
    if (u.length) return 'good';
    return 'none';
  }
  function paintBells() {
    var unread = ITEMS.filter(function (i) { return !i.read && !i.gone; }).length;
    document.querySelectorAll('[id="bell"], .bell').forEach(function (b) {
      var badge = b.querySelector('.sn-badge'); if (!badge) return;
      badge.className = 'sn-badge ' + badgeLevel();
      badge.textContent = unread > 9 ? '9+' : String(unread);
      b.setAttribute('aria-label', unread ? unread + ' notifications' : 'No new notifications');
    });
  }

  function avatarHtml(i) {
    var badge = '<span class="sn-type ' + i.level + '"><svg viewBox="0 0 24 24">' + BADGE[i.level] + '</svg></span>';
    if (i.kind === 'customer') {
      return '<div class="sn-av"><div class="sn-circle" style="background:hsl(' + hue(i.who) + ',38%,38%)">' + esc(initials(i.who)) + '</div>' + badge + '</div>';
    }
    var bg = i.kind === 'system' ? 'rgba(255,255,255,.12)' : 'rgba(58,170,53,.30)';
    return '<div class="sn-av"><div class="sn-circle" style="background:' + bg + '"><svg viewBox="0 0 24 24">' + (ICON[i.kind] || ICON.system) + '</svg></div>' + badge + '</div>';
  }

  function rowHtml(i) {
    var acts = '';
    if (i.act || i.more) {
      acts = '<div class="sn-acts">' +
        (i.act ? '<a class="p" href="' + esc(i.act.href) + '" data-go="' + esc(i.id) + '">' + esc(i.act.label) + '</a>' : '') +
        (i.more ? '<a class="s" href="' + esc(i.more.href) + '" data-go="' + esc(i.id) + '">' + esc(i.more.label) + '</a>' : '') + '</div>';
    }
    return '<div class="sn-row" data-id="' + esc(i.id) + '"><div class="sn-del">Remove</div>' +
      '<div class="sn-card ' + (i.read ? 'read' : 'unread') + '" data-href="' + esc((i.act || i.more || {}).href || '') + '">' +
      avatarHtml(i) +
      '<div class="sn-body"><div class="sn-text"><b>' + esc(i.who) + '</b> ' + esc(i.text) + '</div>' +
      (i.at ? '<div class="sn-when">' + esc(ago(i.at)) + '</div>' : '') + acts + '</div>' +
      '<div class="sn-right"><span class="sn-dot"></span><button class="sn-more" type="button" aria-label="More">&#8943;</button></div>' +
      '<div class="sn-menu"><button type="button" data-act="read">Mark as read</button><button type="button" data-act="remove">Remove this notification</button></div>' +
      '</div></div>';
  }

  function render() {
    var list = document.getElementById('sn-list'); if (!list) return;
    var live = ITEMS.filter(function (i) { return !i.gone; });
    if (FILTER === 'unread') live = live.filter(function (i) { return !i.read; });
    var fresh = live.filter(function (i) { return !i.read; });
    var earlier = live.filter(function (i) { return i.read; });
    var html = [];
    if (!live.length) {
      html.push('<div class="sn-empty"><b>' + (FILTER === 'unread' ? 'Nothing unread' : 'Nothing to show') + '</b>' +
        (ITEMS.some(function (i) { return i.level === 'unseen' && !i.gone; })
          ? 'Some parts of the business cannot be seen yet. Switch to All to see which.'
          : 'When something needs you it will be here, newest first.') + '</div>');
    }
    if (fresh.length) { html.push('<div class="sn-h">New</div>'); fresh.forEach(function (i) { html.push(rowHtml(i)); }); }
    if (earlier.length) { html.push('<div class="sn-h">Earlier</div>'); earlier.forEach(function (i) { html.push(rowHtml(i)); }); }
    html.push('<div class="sn-foot">Nothing here sends a message on its own. A button takes you to the screen where you decide.</div>');
    list.innerHTML = html.join('');
    wireRows();
    paintBells();
    var pills = document.querySelectorAll('.sn-pill');
    pills.forEach(function (p) { p.classList.toggle('on', p.getAttribute('data-f') === FILTER); });
  }

  function find(id) { for (var i = 0; i < ITEMS.length; i++) if (ITEMS[i].id === id) return ITEMS[i]; return null; }
  function markRead(id) { var it = find(id); if (it) { it.read = true; lsAdd(READ_KEY, [id]); } }
  function remove(id) { var it = find(id); if (it) { it.gone = true; lsAdd(GONE_KEY, [id]); } }

  function wireRows() {
    document.querySelectorAll('.sn-row').forEach(function (row) {
      var id = row.getAttribute('data-id');
      var card = row.querySelector('.sn-card');
      var menu = row.querySelector('.sn-menu');
      var more = row.querySelector('.sn-more');
      // tap the row: go there, and it turns read
      card.addEventListener('click', function (e) {
        if (e.target.closest('.sn-more') || e.target.closest('.sn-menu') || e.target.closest('.sn-acts')) return;
        if (swallow) return;
        markRead(id);
        var go = card.getAttribute('data-href');
        if (go) location.href = go; else render();
      });
      // a button: same, but to that button's screen
      row.querySelectorAll('.sn-acts a').forEach(function (a) {
        a.addEventListener('click', function () { markRead(id); });
      });
      // three dots
      more.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = menu.classList.contains('open');
        document.querySelectorAll('.sn-menu.open').forEach(function (m) { m.classList.remove('open'); });
        if (!open) menu.classList.add('open');
      });
      menu.querySelectorAll('button').forEach(function (b) {
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          if (b.getAttribute('data-act') === 'read') markRead(id); else remove(id);
          render();
        });
      });
      attachSwipe(row, id);
    });
  }

  var swallow = false;
  function attachSwipe(row, id) {
    var card = row.querySelector('.sn-card'), del = row.querySelector('.sn-del');
    var sx = 0, sy = 0, dx = 0, on = false, decided = false;
    // A third of the row on a phone, but never more than a thumb's reach. On a
    // wide office screen a third of the row is four hundred pixels, which no
    // hand will drag; the cap keeps the gesture the same size everywhere.
    var limit = function () { return Math.min(140, Math.max(70, row.offsetWidth * 0.34)); };
    var reset = function () { row.classList.add('moving'); card.style.transform = ''; del.classList.remove('lit'); setTimeout(function () { row.classList.remove('moving'); }, 220); };
    row.addEventListener('touchstart', function (e) { var t = e.touches[0]; sx = t.clientX; sy = t.clientY; dx = 0; on = true; decided = false; }, { passive: true });
    row.addEventListener('touchmove', function (e) {
      if (!on) return;
      var t = e.touches[0], mx = t.clientX - sx, my = t.clientY - sy;
      if (!decided) { if (Math.abs(my) > Math.abs(mx)) { on = false; return; } if (Math.abs(mx) < 8) return; decided = true; }
      if (mx > 0) mx = mx * 0.25; // only left removes; right just resists
      if (e.cancelable) e.preventDefault();
      dx = mx; card.style.transform = 'translateX(' + dx + 'px)';
      del.classList.toggle('lit', dx < 0 && Math.abs(dx) >= limit());
    }, { passive: false });
    var end = function (e) {
      if (!on) return; on = false;
      if (decided) { if (e && e.cancelable) e.preventDefault(); swallow = true; setTimeout(function () { swallow = false; }, 500); }
      if (dx < 0 && Math.abs(dx) >= limit()) {
        row.classList.add('moving'); card.style.transform = 'translateX(-110%)';
        setTimeout(function () { remove(id); render(); }, 180);
      } else reset();
    };
    row.addEventListener('touchend', end);
    row.addEventListener('touchcancel', function () { on = false; reset(); });
  }

  function open() { var p = document.getElementById('sn-page'); if (p) { render(); p.classList.add('open'); document.body.style.overflow = 'hidden'; } }
  function close() { var p = document.getElementById('sn-page'); if (p) { p.classList.remove('open'); document.body.style.overflow = ''; } paintBells(); }

  /* ---- the buzz: only for things that are new since she last looked --------
     A phone that buzzes for the same three items every morning is a phone that
     gets muted. So the count she last saw is remembered, and only a rise buzzes. */
  var SEEN_KEY = 'sprintos_notify_seen_count_v1';
  var ALERT_KEY = 'sprintos_notify_alerts_v1';
  function alertsWanted() { try { return localStorage.getItem(ALERT_KEY) === 'yes'; } catch (e) { return false; } }
  function canNotify() { return typeof Notification !== 'undefined' && Notification.permission === 'granted' && alertsWanted(); }
  function trayNotify(title, body, href) {
    if (!canNotify()) return;
    try {
      var opts = { body: body, tag: 'sprint-os-' + (href || 'home'), data: { href: href || './index.html' }, icon: 'shared/logo-mark.png', badge: 'shared/logo-mark.png', vibrate: [120, 60, 120] };
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(function (reg) { reg.showNotification(title, opts); }).catch(function () { new Notification(title, opts); });
      } else { new Notification(title, opts); }
    } catch (e) { /* a browser that cannot show one simply does not */ }
  }
  function buzzIfNew() {
    var unread = ITEMS.filter(function (i) { return !i.read && !i.gone; });
    var last = 0; try { last = Number(localStorage.getItem(SEEN_KEY) || 0); } catch (e) {}
    var rise = unread.length - last;
    try { localStorage.setItem(SEEN_KEY, String(unread.length)); } catch (e) {}
    if (rise <= 0) return;
    try { if (navigator.vibrate) navigator.vibrate([90, 70, 90]); } catch (e) {}
    document.querySelectorAll('.sn-badge').forEach(function (b) {
      b.style.transition = 'transform .18s';
      b.style.transform = 'scale(1.35)';
      setTimeout(function () { b.style.transform = ''; }, 380);
    });
    var worst = unread.filter(function (i) { return i.level === 'now'; })[0] || unread[0];
    var title = rise === 1 ? '1 new thing needs you' : rise + ' new things need you';
    trayNotify(title, worst ? (worst.who + ' ' + worst.text).slice(0, 110) : 'Open Sprint OS to see what.', (worst && (worst.act || worst.more) || {}).href);
  }
  function askForAlerts(btn) {
    if (typeof Notification === 'undefined') { btn.textContent = 'This phone cannot show alerts'; btn.disabled = true; return; }
    Notification.requestPermission().then(function (p) {
      if (p === 'granted') {
        try { localStorage.setItem(ALERT_KEY, 'yes'); } catch (e) {}
        btn.textContent = 'Alerts are on';
        btn.classList.add('on');
        trayNotify('Sprint OS alerts are on', 'When something new needs you, it will show here.', './index.html');
      } else {
        btn.textContent = 'Alerts were not allowed';
      }
    });
  }
  function alertsBarHtml() {
    if (typeof Notification === 'undefined') return '';
    var on = canNotify();
    return '<div class="sn-alerts"><span>' + (on ? 'Alerts are on for this phone.' : 'Get told when something new needs you.') + '</span>' +
      '<button type="button" class="sn-alertbtn' + (on ? ' on' : '') + '" id="sn-alertbtn"' + (on ? ' disabled' : '') + '>' + (on ? 'Alerts are on' : 'Turn on alerts') + '</button></div>';
  }

  function mount(items, base) {
    var read = ls(READ_KEY), gone = ls(GONE_KEY);
    ITEMS = items.map(function (i) { i.read = read.indexOf(i.id) !== -1; i.gone = gone.indexOf(i.id) !== -1; return i; });
    var rank = { now: 0, soon: 1, good: 2, unseen: 3 };
    ITEMS.sort(function (a, b) {
      var ta = Date.parse(a.at || 0) || 0, tb = Date.parse(b.at || 0) || 0;
      if (ta !== tb) return tb - ta;              // newest first, like her feed
      return rank[a.level] - rank[b.level];
    });
    injectCss();
    if (!document.getElementById('sn-page')) {
      var page = document.createElement('div'); page.id = 'sn-page'; page.className = 'sn-page';
      page.innerHTML =
        '<div class="sn-top"><span class="sn-back" id="sn-back" role="button" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></span>' +
        '<h1>Notifications</h1><button class="sn-readall" type="button" id="sn-readall">Mark all as read</button></div>' +
        alertsBarHtml() +
        '<div class="sn-pills"><button class="sn-pill on" type="button" data-f="all">All</button><button class="sn-pill" type="button" data-f="unread">Unread</button></div>' +
        '<div class="sn-list" id="sn-list"></div>';
      document.body.appendChild(page);
      document.getElementById('sn-back').addEventListener('click', close);
      var ab = document.getElementById('sn-alertbtn');
      if (ab) ab.addEventListener('click', function () { askForAlerts(ab); });
      document.getElementById('sn-readall').addEventListener('click', function () {
        ITEMS.forEach(function (i) { if (!i.gone) { i.read = true; } });
        lsAdd(READ_KEY, ITEMS.map(function (i) { return i.id; }));
        render();
      });
      page.querySelectorAll('.sn-pill').forEach(function (p) {
        p.addEventListener('click', function () { FILTER = p.getAttribute('data-f'); render(); });
      });
      page.addEventListener('click', function (e) {
        if (!e.target.closest('.sn-more') && !e.target.closest('.sn-menu')) {
          document.querySelectorAll('.sn-menu.open').forEach(function (m) { m.classList.remove('open'); });
        }
      });
    }
    document.querySelectorAll('[id="bell"], .bell').forEach(function (b) {
      b.classList.add('sn-wrap');
      if (!b.querySelector('.sn-badge')) { var s = document.createElement('span'); s.className = 'sn-badge none'; b.appendChild(s); }
      b.style.cursor = 'pointer'; b.setAttribute('role', 'button'); b.setAttribute('tabindex', '0');
      b.addEventListener('click', function (e) { e.preventDefault(); open(); });
      b.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
    paintBells();
    buzzIfNew();
  }

  function boot() {
    var path = location.pathname;
    var base = /\/(cockpit|sales|fleet|ops|incidents|insights|tenders|accounts|care|marketing|driver|demo|quote)\//.test(path) ? '../' : '';
    var h = location.hostname || '';
    var onHub = h === 'localhost' || h === '127.0.0.1' || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);
    var example = function () {
      mount(EXAMPLE.map(function (x) {
        var y = Object.assign({}, x);
        if (y.act) y.act = { label: y.act.label, href: base + y.act.href };
        if (y.more) y.more = { label: y.more.label, href: base + y.more.href };
        return y;
      }), base);
    };
    if (!onHub || !window.fetch || location.protocol === 'file:') { example(); return; }
    var get = function (u) {
      return fetch(u, { credentials: 'include' }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (b) { return b && b.ok ? b.data : null; }).catch(function () { return null; });
    };
    Promise.all([get('/api/cockpit'), get('/api/fleet/live')]).then(function (res) {
      if (!res[0]) { example(); return; }
      mount(fromHub(res[0], res[1], base), base);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.SprintNotify = { open: open, close: close, mount: mount };
})();
