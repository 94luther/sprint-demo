// Emergency report taxonomy, read by BOTH the driver app's "report
// emergency" screen and the hub's POST /api/incidents validation. One file
// instead of the two hand copied arrays this repo used to carry (the
// driver phone sent severity: 4, type: 'other' for absolutely everything,
// so a burst tyre and an overturned truck reached ops looking identical,
// with no way to tell them apart and no severity the driver could ever
// tell the truth with). Every caller reads this same list, so the words a
// driver sees on the screen and the severities the server will accept can
// never drift apart the way the old duplicated arrays already had.
//
// default_severity is the FLOOR, not a suggestion: a driver may raise it
// (a burst tyre on a blind bend at night is not a 2) but hub/server.js
// never accepts a payload that quietly lowers it below this number, and
// clamps it back up when one tries. Ordering matters here too: life and
// cargo loss first, delay last, same order the ops desk should triage in.
(function (root) {
  'use strict';
  var EMERGENCY_TYPES = [
    { type: 'accident', label: 'Accident', default_severity: 5 },
    { type: 'hijacking', label: 'Hijacking', default_severity: 5 },
    { type: 'medical', label: 'Medical emergency', default_severity: 5 },
    { type: 'robbery', label: 'Robbery', default_severity: 4 },
    { type: 'load_shift', label: 'Load shift', default_severity: 3 },
    { type: 'temperature_breach', label: 'Temperature breach', default_severity: 3 },
    { type: 'stuck', label: 'Stuck', default_severity: 3 },
    { type: 'breakdown', label: 'Breakdown', default_severity: 3 },
    { type: 'burst_tyre', label: 'Burst tyre', default_severity: 2 },
    { type: 'out_of_fuel', label: 'Out of fuel', default_severity: 2 },
    { type: 'roadblock', label: 'Roadblock', default_severity: 2 },
    { type: 'border_delay', label: 'Border delay', default_severity: 2 },
    { type: 'customer_refused', label: 'Customer refused', default_severity: 1 },
    { type: 'other', label: 'Other', default_severity: 2 }
  ];
  var exported = { EMERGENCY_TYPES: EMERGENCY_TYPES };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  }
  if (root) {
    root.EMERGENCY_TYPES = EMERGENCY_TYPES;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
