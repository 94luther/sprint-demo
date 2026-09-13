/* Sprint OS roles: a phone's own memory of who is holding it. Brick 81.

   PRESENTATION ONLY. Read that twice before touching a route because of
   this file. Nothing here checks a password, a session or a permission;
   it only decides which tiles a phone draws first. The one and only place
   a role is actually enforced is the hub itself, hub/services/auth.js,
   function requireRoleGroups and the ROLE_GROUPS map: that is what stops a
   driver's phone reaching an accounts route, proved live in
   hub/tests/driver-role.test.js. If this file disappeared tonight nothing
   would become less secure, a phone would just go back to showing every
   department to everybody, which is exactly what apps/index.html already
   did before this brick.

   The role names below are not invented here. They are copied from
   hub/services/auth.js: ROLE_SCOPES and ROLE_GROUPS both key off admin,
   staff, ops, accounts, manager and driver, and nothing else exists on a
   real login today. A name added here that the hub does not also use
   would quietly stop meaning anything the day the hub's roles change, so
   KNOWN_ROLES is kept level with that file on purpose, not copied once and
   forgotten.

   What this file does:
     - remembers the current role in localStorage, per phone, wrapped in
       try/catch because a private browsing tab can throw on storage;
     - sets data-role on <html> the moment this script runs, which is
       before <body> exists yet, so whatever CSS a page writes against
       html[data-role="..."] is already correct on the very first frame a
       person sees, never mounted plain and then flipped;
     - offers a subscribe function so a page can react if the role changes
       under it (a live look up from the hub resolving after first paint);
     - best effort refreshes the role from the hub's own /api/me, only on
       the office network, the same reachability check apps/index.html
       already uses for its LIVE badge, and only ever narrows to a role the
       hub actually issued.

   A role this file has never heard of, or no role known yet at all
   (a phone that has never signed in, or one that is offline right now
   and has never cached an answer), gets DEFAULT_ROLE. That default is
   "unknown", and the page consuming this file is expected to treat
   unknown exactly like manager or admin: show the full, unchanged tile
   set. The reasoning: this file can only ever hide or reorder a tile for
   convenience, never protect one, so hiding a tool from someone it does
   not recognise could cost a real member of staff a job they are
   genuinely allowed to do, while showing one extra tile to someone who
   cannot use it costs nothing worse than the same 403 the hub already
   returns today. Fail open on an unknown role, the same choice
   hub/services/auth.js itself already makes for ROLE_GROUPS. */
(function () {
  'use strict';

  var KEY = 'sprintos_role_v1';

  // Kept level with hub/services/auth.js. Do not add a role here that the
  // hub does not also grant a login to.
  var KNOWN_ROLES = ['admin', 'staff', 'ops', 'accounts', 'manager', 'driver'];

  var DEFAULT_ROLE = 'unknown';

  var subscribers = [];
  var current = null;

  function read() {
    try {
      var v = window.localStorage.getItem(KEY);
      return v || null;
    } catch (e) {
      return null;
    }
  }

  function write(role) {
    try {
      window.localStorage.setItem(KEY, role);
    } catch (e) {
      // Private mode, storage full, or storage blocked outright. The role
      // still applies for the rest of this page view, it just will not be
      // remembered for the next one, and that is the only consequence.
    }
  }

  // ?role=driver forces a view for the length of this page load only, the
  // same pattern apps/shared/sprint-chrome.js already uses for ?daypart=,
  // "for checking and for showing someone". It never writes to storage, so
  // a real phone's remembered role is never disturbed by a link someone
  // sent to demonstrate a screen.
  function paramRole() {
    var m = /[?&]role=([a-z]+)/.exec(location.search || '');
    if (m && KNOWN_ROLES.indexOf(m[1]) !== -1) return m[1];
    if (m && m[1] === DEFAULT_ROLE) return DEFAULT_ROLE;
    return null;
  }

  function apply(role) {
    current = role;
    try {
      document.documentElement.setAttribute('data-role', role);
    } catch (e) {}
  }

  // Runs at script parse time, in <head>, before <body> and its tiles
  // exist. This is what makes the first paint already correct: there is
  // no earlier moment to have gotten it wrong in.
  current = paramRole() || read() || DEFAULT_ROLE;
  apply(current);

  function setRole(role, opts) {
    var persist = !opts || opts.persist !== false;
    if (role === current) return;
    apply(role);
    if (persist) write(role);
    for (var i = 0; i < subscribers.length; i++) {
      try { subscribers[i](role); } catch (e) {}
    }
  }

  function subscribe(fn) {
    subscribers.push(fn);
    return function unsubscribe() {
      var idx = subscribers.indexOf(fn);
      if (idx !== -1) subscribers.splice(idx, 1);
    };
  }

  function getRole() {
    return current;
  }

  // Best effort live check against the hub's own session, the same
  // reachability test apps/index.html already runs for its LIVE badge
  // (private network or localhost, fetch available, not opened as a bare
  // file). A phone off that network, or with no signal at all, simply
  // keeps whatever it last remembered, which is the entire point of
  // persisting the role per phone rather than asking every time.
  function refreshFromHub() {
    var host = location.hostname || '';
    var onHub = host === 'localhost' || host === '127.0.0.1' || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
    if (!onHub || !window.fetch || location.protocol === 'file:') return;
    fetch('/api/me', { credentials: 'include' }).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (body) {
      if (!body || !body.ok || !body.data || !body.data.role) return;
      if (KNOWN_ROLES.indexOf(body.data.role) === -1) return; // the hub named a role this file does not know; do not guess, keep DEFAULT_ROLE's safe-open behaviour instead
      setRole(body.data.role);
    }).catch(function () {});
  }

  window.SprintRoles = {
    KNOWN_ROLES: KNOWN_ROLES,
    DEFAULT_ROLE: DEFAULT_ROLE,
    getRole: getRole,
    setRole: setRole,
    subscribe: subscribe,
    refreshFromHub: refreshFromHub
  };
})();
