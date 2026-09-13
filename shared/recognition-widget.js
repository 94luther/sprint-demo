// Sprint Pulse shared header widget: shows the signed in person's own
// standing (this week's capped points, on time streak) in any app's
// header. Fetches GET /api/recognition/me (same origin, same session
// cookie every app already uses) and renders a compact line into a
// container element. Never throws into the page: a failed or missing fetch
// just clears the container, so a header never breaks over a widget.
//
// Usage, from any apps/<dept>/index.html:
//   <span id="pulseWidget" class="pulse-widget"></span>
//   <script src="../shared/recognition-widget.js"></script>
//   <script>SprintPulseWidget.mount('pulseWidget');</script>
//
// Local only: no external URL, no external font, one small inline <style>
// injected once (decision #56 -- apps\ can carry no external URL of any
// kind; hub\tests\apps-egress.test.js fails the build on one). Zero dash
// characters in any staff facing string (house rule): this file uses the
// middle dot separator (\u00b7) instead, same as every other app's header.
(function (root) {
  'use strict';

  var STYLE_ID = 'sprint-pulse-widget-style';
  var CSS =
    '.pulse-widget{display:inline-flex; align-items:center; gap:6px; font-size:11px; color:var(--dim,#a6a69f); white-space:nowrap;}' +
    '.pulse-widget .pw-dot{width:6px; height:6px; border-radius:50%; background:var(--line,#2c2c27); flex:none;}' +
    '.pulse-widget .pw-dot.pw-good{background:var(--green,#3AAA35);}' +
    '.pulse-widget .pw-text{overflow:hidden; text-overflow:ellipsis;}';

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = CSS;
    document.head.appendChild(el);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fetchMe() {
    return fetch('/api/recognition/me', { credentials: 'include' })
      .then(function (res) {
        return res.json();
      })
      .then(function (json) {
        return json && json.ok ? json.data : null;
      })
      .catch(function () {
        return null;
      });
  }

  function renderInto(el, data) {
    if (!data) {
      el.innerHTML = '';
      return;
    }
    var pts = (data.week && data.week.total_points) || 0;
    var streakDays = (data.streak && data.streak.days) || 0;
    var broken = data.streak && data.streak.broken;
    var text = 'Your week: ' + pts + ' point' + (pts === 1 ? '' : 's');
    if (streakDays > 0) {
      text += ' \u00b7 on time streak ' + streakDays + ' day' + (streakDays === 1 ? '' : 's');
    } else if (broken) {
      text += ' \u00b7 streak reset today';
    }
    var dotCls = streakDays > 0 ? 'pw-dot pw-good' : 'pw-dot';
    el.innerHTML = '<span class="' + dotCls + '"></span><span class="pw-text">' + esc(text) + '</span>';
    el.title = 'Sprint Pulse: recognises verified on time deliveries, complete proof of delivery, and exceptions raised promptly with a photo and closed with a documented reason. Daily cap ' + (data.daily_cap_points || 15) + ' points.';
  }

  // Mounts the widget into the element with id containerId. Safe to call
  // more than once (e.g. after a login); each call re-fetches and re-renders.
  function mount(containerId) {
    var el = document.getElementById(containerId);
    if (!el) return;
    ensureStyle();
    el.className = (el.className ? el.className + ' ' : '') + 'pulse-widget';
    el.innerHTML = '<span class="pw-dot"></span><span class="pw-text">Loading your standing</span>';
    fetchMe().then(function (data) {
      renderInto(el, data);
    });
  }

  var exported = { mount: mount };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  }
  if (root) {
    root.SprintPulseWidget = exported;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
