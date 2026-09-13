/* Sprint OS: one question, one answer. Brick 94.

   Paste a waybill, a registration or a customer name and get the whole picture
   in one overlay: where the vehicle is, what has gone wrong, and what this
   customer is worth. No tab switching, no four screens.

   Three things it is careful about:
     * The box is anchored to the BOTTOM of the screen with the field at the
       bottom too, because a thumb reaches the bottom of a phone and not the
       top. The results grow upward from the field.
     * It never claims. A customer with no history says so. A consignment with
       no trip says why there is no vehicle to look at.
     * It asks the hub at most three times a second while typing, and an answer
       that arrives for a query the person has already changed is thrown away
       rather than drawn over the newer one. */
(function (root) {
  'use strict';
  var CSS = '' +
    '#findWrap{position:fixed;inset:0;z-index:80;display:none;background:rgba(4,20,14,.72);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}' +
    '#findWrap.show{display:flex;flex-direction:column;justify-content:flex-end}' +
    '#findBox{max-width:560px;width:100%;margin:0 auto;padding:0 14px calc(14px + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;max-height:92vh}' +
    '#findOut{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;display:flex;flex-direction:column-reverse;padding-bottom:10px}' +
    '#findOut .in{display:flex;flex-direction:column;gap:10px}' +
    '.fnd-bar{display:flex;gap:10px;align-items:center;background:rgba(8,28,20,.92);border:1px solid rgba(255,255,255,.3);border-radius:999px;padding:6px 6px 6px 18px;box-shadow:0 22px 54px -20px rgba(0,0,0,.8)}' +
    '.fnd-bar input{flex:1;min-width:0;min-height:52px;background:none;border:0;color:#F4F7F5;font:inherit;font-size:17px;font-weight:600;outline:none}' +
    '.fnd-bar input::placeholder{color:#A7B5AE;font-weight:500}' +
    '.fnd-bar button{flex:none;width:52px;height:52px;border-radius:50%;border:0;background:rgba(255,255,255,.14);color:#fff;font:inherit;font-size:20px;font-weight:800}' +
    '.fnd-c{background:rgba(8,28,20,.94);border:1px solid rgba(255,255,255,.24);border-radius:22px;padding:14px 15px;box-shadow:0 22px 54px -24px rgba(0,0,0,.7)}' +
    '.fnd-c .kind{font-size:10.5px;font-weight:800;letter-spacing:1.1px;text-transform:uppercase;color:#FDDCB5}' +
    '.fnd-c h3{font-size:18px;font-weight:900;margin:3px 0 2px;line-height:1.2;color:#F4F7F5}' +
    '.fnd-c .sub{font-size:12.5px;color:#A7B5AE;margin-bottom:8px}' +
    '.fnd-c .l{display:flex;gap:8px;font-size:13px;line-height:1.5;color:#D3DDD8;padding:5px 0;border-top:1px solid rgba(255,255,255,.1)}' +
    '.fnd-c .l b{flex:none;width:92px;color:#A7B5AE;font-weight:700;font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;padding-top:2px}' +
    '.fnd-c .l span{flex:1;min-width:0}' +
    '.fnd-c .warn{color:#FFB3AD;font-weight:700}' +
    '.fnd-c .good{color:#8FE08A;font-weight:700}' +
    '.fnd-c .why{font-size:11.5px;color:#A7B5AE;margin-top:8px;font-style:italic}' +
    '.fnd-note{background:rgba(8,28,20,.9);border:1px dashed rgba(255,255,255,.28);border-radius:18px;padding:14px;font-size:13.5px;color:#D3DDD8;line-height:1.5}' +
    'html[data-glare="on"] #findWrap{backdrop-filter:none;-webkit-backdrop-filter:none;background:#04140E}' +
    'html[data-glare="on"] .fnd-c,html[data-glare="on"] .fnd-bar{background:#0A2417}';
  function css(){ if(document.getElementById('fnd-css')) return; var s=document.createElement('style'); s.id='fnd-css'; s.textContent=CSS; document.head.appendChild(s); }
  function esc(s){ return String(s===undefined||s===null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function pula(t){ if(t===null||t===undefined) return null; var n=Math.round(Number(t)||0); return 'P'+(n/100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,','); }
  function when(iso){ if(!iso) return null; try{ return new Date(iso).toLocaleString('en-GB',{timeZone:'Africa/Gaborone',weekday:'short',hour:'2-digit',minute:'2-digit'}); }catch(e){ return iso; } }
  function line(label, value, cls){ if(value===null||value===undefined||value==='') return ''; return '<div class="l"><b>'+esc(label)+'</b><span'+(cls?' class="'+cls+'"':'')+'>'+esc(value)+'</span></div>'; }

  var STATE_WORD = { moving:'moving now', standing:'standing still', no_signal:'no signal from this vehicle', no_trip:'not on a trip today' };

  function shipmentHtml(c){
    var h = ['<div class="fnd-c"><div class="kind">Consignment</div><h3>'+esc(c.title)+'</h3><div class="sub">'+esc(c.subtitle)+'</div>'];
    h.push(line('Status', c.status));
    h.push(line('To', c.destination || 'destination not recorded'));
    h.push(line('Promised', c.promised_at ? when(c.promised_at) : 'no promised time recorded'));
    if (c.delivered_at) h.push(line('Delivered', when(c.delivered_at), 'good'));
    if (c.cod_amount_thebe) h.push(line('Cash owed', pula(c.cod_amount_thebe), 'warn'));
    if (c.priority) h.push(line('Priority', c.priority, 'warn'));
    if (c.trip) h.push(line('On the run', (c.trip.route_label||c.trip.id)+', '+c.trip.status));
    else h.push(line('On the run', c.trip_note, 'warn'));
    if (c.vehicle) {
      h.push(line('Vehicle', c.vehicle.title+', '+(STATE_WORD[c.vehicle.state]||c.vehicle.state)));
      if (c.vehicle.position) h.push(line('Last seen', c.vehicle.position.lat.toFixed(4)+', '+c.vehicle.position.lng.toFixed(4)+' at '+when(c.vehicle.position.recorded_at)));
    }
    if (c.driver) h.push(line('Driver', c.driver.name));
    if (c.incidents && c.incidents.length) {
      h.push(line('Gone wrong', c.incidents.map(function(i){ return i.title+(i.status==='closed'?' (closed)':''); }).join('; '), 'warn'));
    } else h.push(line('Gone wrong', 'nothing recorded against this consignment', 'good'));
    h.push('<div class="why">'+esc(c.why)+'</div></div>');
    return h.join('');
  }
  function vehicleHtml(c){
    var h = ['<div class="fnd-c"><div class="kind">Vehicle</div><h3>'+esc(c.title)+'</h3><div class="sub">'+esc(c.subtitle)+'</div>'];
    h.push(line('Right now', STATE_WORD[c.state]||c.state, c.state==='no_signal'?'warn':''));
    if (c.standing_minutes) h.push(line('Standing', c.standing_minutes+' minutes', c.standing_minutes>20?'warn':''));
    if (c.position) h.push(line('Last seen', c.position.lat.toFixed(4)+', '+c.position.lng.toFixed(4)+' at '+when(c.position.recorded_at)));
    if (c.trip) h.push(line('On the run', (c.trip.route_label||c.trip.id||'')+(c.trip.driver_name?', '+c.trip.driver_name:'')));
    if (c.documents) h.push(line('Paperwork', c.documents.map(function(d){ return d.what+' to '+d.on; }).join('; ')));
    else h.push(line('Paperwork', c.documents_note, 'warn'));
    if (c.incidents && c.incidents.length) h.push(line('Gone wrong', c.incidents.map(function(i){ return i.title; }).join('; '), 'warn'));
    else h.push(line('Gone wrong', 'nothing recorded against this vehicle', 'good'));
    h.push('<div class="why">'+esc(c.why)+'</div></div>');
    return h.join('');
  }
  function customerHtml(c){
    var h = ['<div class="fnd-c"><div class="kind">Customer</div><h3>'+esc(c.title)+'</h3>'];
    if (c.subtitle) h.push('<div class="sub">'+esc(c.subtitle)+'</div>');
    h.push(line('Trend', c.trend.say, c.trend.direction==='down'?'warn':c.trend.direction==='up'?'good':''));
    h.push(line('Recent work', c.shipments.length ? c.shipments.map(function(s){ return (s.waybill||s.id)+' '+s.status; }).join('; ') : c.shipments_note));
    h.push(line('Open trouble', c.open_incidents.length ? c.open_incidents.map(function(i){ return i.title; }).join('; ') : 'nothing open', c.open_incidents.length?'warn':'good'));
    h.push(line('Quotes', c.quotes.length ? c.quotes.map(function(q){ return (pula(q.amount_thebe)||'amount not recorded')+' on '+String(q.created_at).slice(0,10); }).join('; ') : c.quotes_note));
    h.push(line('Pipeline', c.leads.length ? c.leads.map(function(l){ return l.stage+(l.value_thebe?', '+pula(l.value_thebe):', value not quoted'); }).join('; ') : c.leads_note));
    h.push('<div class="why">'+esc(c.why)+'</div></div>');
    return h.join('');
  }

  var seq = 0, wrap = null, input = null, out = null;
  function build(){
    css();
    if (wrap) return;
    wrap = document.createElement('div'); wrap.id='findWrap'; wrap.setAttribute('role','dialog'); wrap.setAttribute('aria-label','Find anything');
    wrap.innerHTML = '<div id="findBox"><div id="findOut"><div class="in"></div></div>' +
      '<div class="fnd-bar"><input id="findIn" type="search" autocomplete="off" autocapitalize="characters" ' +
      'placeholder="Waybill, registration or customer" aria-label="Waybill, registration or customer">' +
      '<button type="button" id="findX" aria-label="Close">&times;</button></div></div>';
    document.body.appendChild(wrap);
    input = wrap.querySelector('#findIn'); out = wrap.querySelector('#findOut .in');
    wrap.querySelector('#findX').addEventListener('click', close);
    wrap.addEventListener('click', function(e){ if (e.target === wrap) close(); });
    var timer = null;
    input.addEventListener('input', function(){ clearTimeout(timer); timer = setTimeout(run, 320); });
    input.addEventListener('keydown', function(e){ if (e.key === 'Escape') close(); if (e.key === 'Enter') { clearTimeout(timer); run(); } });
  }
  function draw(html){ out.innerHTML = html; }
  async function run(){
    var q = String(input.value || '').trim();
    if (q.length < 2) { draw(''); return; }
    var mine = ++seq;
    try {
      var data;
      if (typeof root.apiFetch === 'function') data = await root.apiFetch('/api/find?q=' + encodeURIComponent(q));
      else { var r = await fetch('/api/find?q=' + encodeURIComponent(q), { credentials:'include' }); var j = await r.json(); if(!j.ok) throw new Error(j.error); data = j.data; }
      if (mine !== seq) return;            // a newer question is already on its way
      if (!data.count) { draw('<div class="fnd-note">' + esc(data.note) + '</div>'); return; }
      draw(data.results.map(function(c){
        return c.kind === 'shipment' ? shipmentHtml(c) : c.kind === 'vehicle' ? vehicleHtml(c) : customerHtml(c);
      }).join(''));
    } catch (e) {
      if (mine !== seq) return;
      draw('<div class="fnd-note">Could not reach the office system just now, so nothing can be looked up. What is on this screen already is still here.</div>');
    }
  }
  function open(){ build(); wrap.classList.add('show'); setTimeout(function(){ input.focus(); }, 60); }
  function close(){ if (!wrap) return; wrap.classList.remove('show'); input.value=''; draw(''); }

  root.SprintFind = { open: open, close: close, run: run };
  document.addEventListener('keydown', function(e){
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); open(); }
  });
})(typeof window !== 'undefined' ? window : this);
