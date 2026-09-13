/* Sprint OS: the offline queue, on IndexedDB. Brick 79.

   The driver app already queued writes when there was no signal, in
   localStorage. That held up until a queued write carried a photo: localStorage
   is a five megabyte string store, read and written whole, on the main thread.
   Three fuel slips and a signature and it is full, and the app freezes while it
   writes. IndexedDB is built for exactly this: structured records, large
   values, off the main thread, and readable by the service worker when the app
   is closed.

   What lives here:
     * a sync_queue store: {id, kind, url, method, body, created_at, tries, last_error}
     * queue(item) and pending(): put a write in, read what is waiting
     * replay(send): send the queue in order, one at a time, and decide per reply
       what to do with each item (below)
     * migrateLegacy(key): moves anything still in the old localStorage queue in,
       once, so an upgrade never loses a write that was waiting
     * requestSync(): asks the browser for a Background Sync, where it has one

   How a replay decides (the conflict rules, written once, used by the page and
   by the service worker alike):
     sent (2xx)          the write landed, drop it
     409 conflict        the hub says the change already landed another way
                         (a version bump, a state it is already in), drop it;
                         except IN_FLIGHT, which means the twin of this write is
                         being handled this instant, so keep it and stop
     401                 not signed in, keep everything and stop, the person
                         must sign in first
     other 4xx           the hub will refuse it again tomorrow, drop it and
                         report it so the screen can say so
     network or 5xx      keep it, count the try, and STOP: the queue is in
                         order and a later write may depend on this one

   Duplicates are prevented by the id, never by the clock. Every item carries
   a random id the hub remembers (hub/services/replay.js), so a write that
   reached the hub while the reply was lost is answered from memory the second
   time, not applied twice. Two writes in the same second are two writes.

   Runs in a page and inside the service worker (importScripts). Nothing here
   touches the DOM. If IndexedDB is unavailable (private browsing, storage
   blocked) the queue keeps working in memory for the life of the page and
   status() says persisted:false, so the screen can warn rather than pretend. */
(function (root) {
  'use strict';

  var DB_NAME = 'sprintos';
  var DB_VERSION = 1;
  var STORE = 'sync_queue';
  var SYNC_TAG = 'sprint-sync';

  var memory = [];          // mirror of the store, so a screen can read the count at once
  var persisted = null;     // null until the first open settles
  var listeners = [];
  var dbp = null;

  function uid() {
    var s = 'q_' + Date.now().toString(36) + '_';
    var a = new Uint8Array(8);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(a);
    else for (var i = 0; i < 8; i++) a[i] = Math.floor(Math.random() * 256);
    for (var j = 0; j < 8; j++) s += ('0' + a[j].toString(16)).slice(-2);
    return s;
  }

  var OPEN_TIMEOUT_MS = 2000;
  function open() {
    if (dbp) return dbp;
    var settled = false;
    dbp = new Promise(function (resolve, reject) {
      // A browser that never answers must not hold a driver's write forever.
      setTimeout(function () {
        if (!settled) { settled = true; reject(new Error('IndexedDB did not answer in ' + OPEN_TIMEOUT_MS + ' ms')); }
      }, OPEN_TIMEOUT_MS);
      var idb = root.indexedDB;
      if (!idb) return reject(new Error('IndexedDB is not available here'));
      var req;
      try { req = idb.open(DB_NAME, DB_VERSION); } catch (e) { return reject(e); }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var s = db.createObjectStore(STORE, { keyPath: 'id' });
          s.createIndex('created_at', 'created_at', { unique: false });
        }
      };
      req.onsuccess = function () { if (settled) { try { req.result.close(); } catch (e) {} return; } settled = true; persisted = true; resolve(req.result); };
      req.onerror = function () { if (settled) return; settled = true; reject(req.error || new Error('IndexedDB refused to open')); };
      req.onblocked = function () { if (settled) return; settled = true; reject(new Error('IndexedDB is blocked by another tab')); };
    });
    dbp.catch(function () { persisted = false; dbp = null; });
    return dbp;
  }

  function tx(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode);
        var s = t.objectStore(STORE);
        var out;
        try { out = fn(s); } catch (e) { return reject(e); }
        t.oncomplete = function () { resolve(out && typeof out === 'object' && 'result' in out ? out.result : out); };
        t.onerror = function () { reject(t.error || new Error('transaction failed')); };
        t.onabort = function () { reject(t.error || new Error('transaction aborted')); };
      });
    });
  }

  function byCreated(a, b) { return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0; }

  function notify() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](memory.slice()); } catch (e) { /* one bad listener must not stop the rest */ }
    }
  }

  function refresh() {
    return tx('readonly', function (s) { return s.getAll(); }).then(function (items) {
      memory = (items || []).sort(byCreated);
      notify();
      return memory.slice();
    }, function () {
      return memory.slice();
    });
  }

  function queue(item) {
    if (!item || !item.url || !item.method) return Promise.reject(new Error('a queued write needs a url and a method'));
    if (!item.id) item.id = uid();
    if (!item.created_at) item.created_at = new Date().toISOString();
    if (typeof item.tries !== 'number') item.tries = 0;
    if (item.last_error === undefined) item.last_error = null;
    return tx('readwrite', function (s) { return s.put(item); }).then(function () {
      return refresh().then(function () { return item; });
    }, function () {
      // storage refused: keep it for the life of this page and say so
      persisted = false;
      var seen = false;
      for (var i = 0; i < memory.length; i++) if (memory[i].id === item.id) { memory[i] = item; seen = true; }
      if (!seen) memory.push(item);
      memory.sort(byCreated);
      notify();
      return item;
    });
  }

  function remove(id) {
    return tx('readwrite', function (s) { return s.delete(id); }).then(refresh, function () {
      memory = memory.filter(function (m) { return m.id !== id; });
      notify();
      return memory.slice();
    });
  }

  function update(item) {
    return tx('readwrite', function (s) { return s.put(item); }).then(refresh, function () {
      for (var i = 0; i < memory.length; i++) if (memory[i].id === item.id) memory[i] = item;
      notify();
      return memory.slice();
    });
  }

  function pending() { return refresh(); }
  function pendingSync() { return memory.slice(); }

  // send(item) must return a promise: resolve when the hub accepted the write,
  // reject with an error carrying .status (0 for no network) and .message
  // (the hub's error word, such as IN_FLIGHT) when it did not.
  var replaying = null;
  function replay(send) {
    if (replaying) return replaying;
    replaying = refresh().then(function (items) {
      var result = { sent: [], dropped: [], rejected: [], kept: [], stopped: null };
      var i = 0;
      function step() {
        if (i >= items.length) return result;
        var item = items[i++];
        return Promise.resolve().then(function () { return send(item); }).then(function () {
          result.sent.push(item);
          return remove(item.id).then(step);
        }, function (err) {
          var status = err && typeof err.status === 'number' ? err.status : 0;
          var word = err && err.message ? String(err.message) : '';
          if (status === 401) { result.stopped = 'not signed in'; result.kept = result.kept.concat(items.slice(i - 1)); return result; }
          if (status === 409 && word === 'IN_FLIGHT') { result.stopped = 'in flight'; result.kept = result.kept.concat(items.slice(i - 1)); return result; }
          if (status === 409) { result.dropped.push(item); return remove(item.id).then(step); }
          if (status >= 400 && status < 500) {
            item.last_error = word || ('refused ' + status);
            result.rejected.push(item);
            return remove(item.id).then(step);
          }
          item.tries = (item.tries || 0) + 1;
          item.last_error = word || (status ? 'hub error ' + status : 'no signal');
          result.stopped = item.last_error;
          result.kept = result.kept.concat(items.slice(i - 1));
          return update(item).then(function () { return result; });
        });
      }
      return step();
    }).then(function (r) { replaying = null; return r; }, function (e) { replaying = null; throw e; });
    return replaying;
  }

  // the old localStorage queue, moved in once and then emptied
  function migrateLegacy(key) {
    var ls = root.localStorage;
    if (!ls) return Promise.resolve(0);
    var raw;
    try { raw = ls.getItem(key); } catch (e) { return Promise.resolve(0); }
    if (!raw) return Promise.resolve(0);
    var old;
    try { old = JSON.parse(raw) || []; } catch (e) { old = []; }
    if (!old.length) { try { ls.removeItem(key); } catch (e) {} return Promise.resolve(0); }
    var chain = Promise.resolve();
    old.forEach(function (it, n) {
      chain = chain.then(function () {
        if (!it.created_at) it.created_at = new Date(Date.now() - (old.length - n) * 1000).toISOString();
        return queue(it);
      });
    });
    return chain.then(function () {
      if (persisted) { try { ls.removeItem(key); } catch (e) {} }
      return old.length;
    });
  }

  // Background Sync where the browser has it (Android Chrome). iPhone Safari
  // has none, so the page keeps its own retry: online event plus a timer. The
  // service worker replays too, when a sync fires with the app closed.
  function requestSync() {
    var sw = root.navigator && root.navigator.serviceWorker;
    if (!sw || !('SyncManager' in root)) return Promise.resolve(false);
    return sw.ready.then(function (reg) {
      if (!reg.sync) return false;
      return reg.sync.register(SYNC_TAG).then(function () { return true; }, function () { return false; });
    }, function () { return false; });
  }

  function headers(item) {
    return { 'Content-Type': 'application/json', 'X-Sprint-Client-Id': item.id };
  }

  function status() {
    return {
      supported: !!root.indexedDB,
      persisted: persisted,
      backgroundSync: !!(root.navigator && root.navigator.serviceWorker && ('SyncManager' in root)),
      count: memory.length
    };
  }

  function onChange(fn) { if (typeof fn === 'function') listeners.push(fn); }

  root.SprintDB = {
    queue: queue, pending: pending, pendingSync: pendingSync, remove: remove, replay: replay,
    migrateLegacy: migrateLegacy, requestSync: requestSync, headers: headers, status: status,
    onChange: onChange, uid: uid, SYNC_TAG: SYNC_TAG
  };
  // warm the mirror so the first count is right
  refresh().then(null, function () {});
})(typeof self !== 'undefined' ? self : this);
