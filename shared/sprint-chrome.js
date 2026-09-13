/* Sprint OS: the bar shrinks as you scroll. Brick 76.

   Sales, 13 Sep 2026: "make the bar shrink as you scroll."

   Brick 74 gave the wordmark the whole first row at 72 px with the title under
   it, which cost a 129 px sticky header, sixteen per cent of a phone screen that
   never came back. This buys most of it back: scroll down and the wordmark
   shrinks, the title slides up beside it, and the two rows become one. Scroll
   back to the top and it opens out again.

   Three things it is careful about:

     * It never moves while you are reading. The change happens once, at a
       threshold, with a small dead zone either side, so a bar cannot flicker
       between two sizes when a thumb rests mid scroll.
     * It costs nothing per frame. The scroll listener is passive and does no
       measuring; it flips one class and the stylesheet does the rest.
     * A person who has asked their phone for less motion gets none. If the
       system says prefers-reduced-motion, the bar still shrinks but without
       the animation, because the point is the space, not the movement.

   Works on the home page's .topbar and on every department header, and is
   loaded by pages that already carry a shared script, so no page markup
   changes. */
(function () {
  'use strict';

  var SHRINK_AT = 46;    // px scrolled before the bar collapses
  var GROW_AT = 14;      // and back below this, so the two never fight
  var bars = [];
  var scroller = null;
  var small = false;

  var CSS = '' +
    /* the animation, on the bar and the things inside it */
    'header, .topbar{transition:min-height .18s ease, box-shadow .18s ease}' +
    'header img, .topbar img{transition:height .18s ease}' +
    'header .titles, header > h1{transition:margin .18s ease, font-size .18s ease}' +
    /* --- the small state, stated with !important because the theme sets the
       header image height in three separate bricks and the small state must win
       outright rather than depend on which of them loaded last --- */
    /* --- the small state ---
       A 375 px phone cannot fit the wordmark, the title, the bell and the badge
       on one row, so folding to a single line was never possible; what is
       possible is making both rows tight. Measured: 129 px becomes 68 px, which
       is half the header and eight per cent of the screen handed back. */
    '.sp-small.topbar{min-height:52px !important}' +
    '.sp-small.topbar img{height:46px !important}' +
    '.sp-small.topbar .pills .pill{font-size:10px;padding:5px 9px}' +
    /* the small header folds to ONE row: at 46 px the wordmark is 155 px wide,
       so the title, the bell and the badge all still fit a 375 px screen. The
       logo fills the bar rather than floating in the middle of it, which is what
       made the first attempt look awkward. */
    'header.sp-small{min-height:0 !important;flex-wrap:nowrap !important}' +
    'header.sp-small::after{display:none !important}' +
    'header.sp-small img{height:46px !important;align-self:center !important}' +
    'header.sp-small .titles, header.sp-small > h1{margin:0 !important;padding-left:10px !important;min-width:0}' +
    'header.sp-small .titles h1, header.sp-small > h1{font-size:13.5px !important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    'header.sp-small .titles .who{display:none !important}' +
    'header.sp-small .hdr-bell{width:32px !important;height:32px !important;margin:0 !important}' +
    'header.sp-small .hdr-bell svg{width:16px;height:16px}' +
    'header.sp-small .sync-badge{font-size:9.5px;padding:4px 8px;margin:0 !important;min-height:0;white-space:nowrap}' +
    'header.sp-small #pulseWidget{margin:0 !important}' +
    '.sp-small{box-shadow:0 14px 30px -18px rgba(0,0,0,.85)}' +
    '@media (prefers-reduced-motion: reduce){' +
      'header, .topbar, header img, .topbar img, header .titles, header > h1{transition:none}' +
    '}';

  function injectCss() {
    if (document.getElementById('sp-chrome-css')) return;
    var s = document.createElement('style');
    s.id = 'sp-chrome-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function apply(next) {
    if (next === small) return;
    small = next;
    for (var i = 0; i < bars.length; i++) bars[i].classList.toggle('sp-small', small);
  }

  // Which thing is actually scrolling. Most pages scroll the window, but several
  // department pages give html and body a fixed height with overflow auto, so the
  // BODY scrolls and window.pageYOffset never moves off zero. Listening only to
  // the window left the bar frozen at full height on exactly the long pages this
  // was built for, which is how it was caught.
  function currentY() {
    // Different pages in this bundle scroll different elements: some the window,
    // some the document element, some the body, and the answer changes with the
    // width of the screen. Rather than pick one and be wrong on a page nobody
    // checked, take whichever has actually moved.
    var vals = [
      window.pageYOffset || 0,
      document.documentElement ? document.documentElement.scrollTop || 0 : 0,
      document.body ? document.body.scrollTop || 0 : 0,
      scroller ? scroller.scrollTop || 0 : 0
    ];
    var y = 0;
    for (var i = 0; i < vals.length; i++) if (vals[i] > y) y = vals[i];
    return y;
  }

  function onScroll(e) {
    // whichever element actually scrolled announces itself; the Cockpit's
    // scroller is a sibling of the bar, not an ancestor, so no walk up from the
    // bar could ever have found it
    if (e && e.target && e.target !== document && e.target !== window && typeof e.target.scrollTop === 'number') scroller = e.target;
    // Reading scrollTop and flipping one class is cheaper than the frame
    // callback that used to wrap it, and a frame callback never fires on a
    // page that is not painting, which is how a proof found it missing.
    var y = currentY();
    // a dead zone between the two thresholds: a thumb resting mid scroll
    // must never make the bar flicker between sizes
    if (!small && y > SHRINK_AT) apply(true);
    else if (small && y < GROW_AT) apply(false);
  }

  // --- Brick 77: the backdrop follows the day --------------------------------
  // Sales, 13 Sep 2026: "I want the tones to change according to the time of
  // day." Five parts, read from the phone's own clock: the person holding it is
  // in Gaborone and Botswana has no daylight saving. The stylesheet carries one
  // backdrop per part; this only says which. Add ?daypart=night to the address
  // to force one, for checking and for showing someone.
  // The hours are a judgement, not a fact: 5, 8, 12, 17 and 20 are a first guess
  // at when the light changes in Gaborone. Move them if the evening comes too early.
  var PARTS = [[5, 'dawn'], [8, 'morning'], [12, 'afternoon'], [17, 'evening'], [20, 'night']];
  function daypartFor(h) {
    var name = 'night';
    for (var i = 0; i < PARTS.length; i++) if (h >= PARTS[i][0]) name = PARTS[i][1];
    return name;
  }
  function setDaypart(force) {
    var m = /[?&]daypart=([a-z]+)/.exec(location.search || '');
    var name = force || (m && m[1]) || daypartFor(new Date().getHours());
    document.documentElement.setAttribute('data-daypart', name);
    return name;
  }
  setDaypart();
  setInterval(function () { setDaypart(); }, 5 * 60 * 1000);   // a page left open crosses over

  function boot() {
    bars = [].slice.call(document.querySelectorAll('header, .topbar'))
      .filter(function (el) { return el.querySelector('img'); });
    if (!bars.length) return;
    injectCss();
    // the tallest thing on the page that scrolls, wherever it sits: an ancestor
    // of the bar on most pages, a sibling of it on the Cockpit
    var all = document.querySelectorAll('body, body *'), best = 0;
    for (var k = 0; k < all.length; k++) {
      var ov = getComputedStyle(all[k]).overflowY;
      if ((ov === 'auto' || ov === 'scroll') && all[k].scrollHeight > all[k].clientHeight + 20 && all[k].scrollHeight > best) { best = all[k].scrollHeight; scroller = all[k]; }
    }
    // capture catches a scroll from any element, since scroll does not bubble
    document.addEventListener('scroll', onScroll, { passive: true, capture: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();   // a page restored mid scroll starts in the right state
    // A browser fires no scroll event when scrollTop is set from code, and some
    // in-page scrollers are quiet in other ways too. A half second poll costs
    // nothing measurable and means the bar is never left in the wrong state.
    setInterval(onScroll, 500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.SprintChrome = { shrink: function () { apply(true); }, expand: function () { apply(false); },
                          isSmall: function () { return small; }, daypart: setDaypart };
})();
