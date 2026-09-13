(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __esm = (fn, res, err) => function __init() {
    if (err) throw err[0];
    try {
      return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
    } catch (e) {
      throw err = [e], e;
    }
  };
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // ../api/src/orders/state_machine.ts
  var state_machine_exports = {};
  __export(state_machine_exports, {
    STATES: () => STATES,
    TRANSITIONS: () => TRANSITIONS,
    TransitionError: () => TransitionError,
    allowedEvents: () => allowedEvents,
    apply: () => apply,
    can: () => can,
    canReachEnd: () => canReachEnd,
    deadEnds: () => deadEnds,
    isStuck: () => isStuck,
    isTerminal: () => isTerminal,
    stuckAfter: () => stuckAfter,
    transitionsFrom: () => transitionsFrom,
    unreachable: () => unreachable,
    untimed: () => untimed
  });
  function isTerminal(state) {
    return STATES[state].terminal;
  }
  function stuckAfter(state) {
    return STATES[state].stuckAfterMinutes;
  }
  function isStuck(state, sinceISO, nowISO) {
    const limit = stuckAfter(state);
    if (limit === null) return false;
    const since = Date.parse(sinceISO);
    const now = nowISO ? Date.parse(nowISO) : Date.now();
    if (Number.isNaN(since) || Number.isNaN(now)) return false;
    return now - since > limit * 6e4;
  }
  function transitionsFrom(state) {
    return TRANSITIONS.filter((t) => t.from === state);
  }
  function allowedEvents(state, actor) {
    return transitionsFrom(state).filter((t) => !actor || t.actors.includes(actor));
  }
  function can(state, event, actor) {
    return allowedEvents(state, actor).some((t) => t.event === event);
  }
  function apply(state, event, opts) {
    const { actor } = opts;
    if (isTerminal(state)) {
      throw new TransitionError(`Order is ${state} and finished, ${event} cannot be applied`);
    }
    const match = transitionsFrom(state).find((t) => t.event === event);
    if (!match) {
      const open = transitionsFrom(state).map((t) => t.event).join(", ");
      throw new TransitionError(`${event} is not possible from ${state}. Possible: ${open}`);
    }
    if (!match.actors.includes(actor)) {
      throw new TransitionError(`${actor} may not do ${event} from ${state}. Allowed: ${match.actors.join(", ")}`);
    }
    if (match.faultRequired && (opts.fault === void 0 || opts.fault === null)) {
      throw new TransitionError(
        `${event} needs somebody to carry the cost. Pass a fault of merchant, customer, sprint, rider or none.`
      );
    }
    return {
      state: match.to,
      fault: match.faultRequired ? opts.fault : "none",
      event,
      actor,
      at: opts.at ?? (/* @__PURE__ */ new Date()).toISOString(),
      says: match.says
    };
  }
  function deadEnds() {
    return Object.keys(STATES).filter(
      (s) => !STATES[s].terminal && transitionsFrom(s).length === 0
    );
  }
  function unreachable() {
    const seen = /* @__PURE__ */ new Set(["placed"]);
    const queue = ["placed"];
    while (queue.length) {
      const s = queue.shift();
      for (const t of transitionsFrom(s)) {
        if (!seen.has(t.to)) {
          seen.add(t.to);
          queue.push(t.to);
        }
      }
    }
    return Object.keys(STATES).filter((s) => !seen.has(s));
  }
  function untimed() {
    return Object.keys(STATES).filter(
      (s) => !STATES[s].terminal && STATES[s].stuckAfterMinutes === null
    );
  }
  function canReachEnd(from) {
    const seen = /* @__PURE__ */ new Set([from]);
    const queue = [from];
    while (queue.length) {
      const s = queue.shift();
      if (STATES[s].terminal) return true;
      for (const t of transitionsFrom(s)) {
        if (!seen.has(t.to)) {
          seen.add(t.to);
          queue.push(t.to);
        }
      }
    }
    return false;
  }
  var STATES, TRANSITIONS, TransitionError;
  var init_state_machine = __esm({
    "../api/src/orders/state_machine.ts"() {
      STATES = {
        placed: { terminal: false, stuckAfterMinutes: 10, customerWaiting: true, says: "Order placed, payment not settled yet" },
        payment_failed: { terminal: false, stuckAfterMinutes: 60, customerWaiting: true, says: "Payment did not go through" },
        paid: { terminal: false, stuckAfterMinutes: 5, customerWaiting: true, says: "Paid, waiting to go to a rider" },
        dispatch_offered: { terminal: false, stuckAfterMinutes: 3, customerWaiting: true, says: "Offered to riders, none has taken it yet" },
        dispatch_accepted: { terminal: false, stuckAfterMinutes: 20, customerWaiting: true, says: "A rider is on the way to the shop" },
        at_merchant: { terminal: false, stuckAfterMinutes: 15, customerWaiting: true, says: "Rider is at the shop waiting for the order" },
        stock_problem: { terminal: false, stuckAfterMinutes: 10, customerWaiting: true, says: "The shop cannot supply something, the customer must choose" },
        picked_up: { terminal: false, stuckAfterMinutes: 45, customerWaiting: true, says: "Rider has the order and is on the road" },
        at_door: { terminal: false, stuckAfterMinutes: 10, customerWaiting: true, says: "Rider is at the address" },
        address_problem: { terminal: false, stuckAfterMinutes: 15, customerWaiting: true, says: "The rider cannot find the place" },
        customer_absent: { terminal: false, stuckAfterMinutes: 10, customerWaiting: true, says: "Nobody is answering at the address" },
        rider_failed: { terminal: false, stuckAfterMinutes: 10, customerWaiting: true, says: "The rider cannot finish this one" },
        returning: { terminal: false, stuckAfterMinutes: 90, customerWaiting: false, says: "Goods are going back to the shop" },
        returned: { terminal: false, stuckAfterMinutes: 1440, customerWaiting: false, says: "Goods are back with the shop, money not settled" },
        delivered: { terminal: false, stuckAfterMinutes: 1440, customerWaiting: false, says: "Handed over, not closed off yet" },
        refund_due: { terminal: false, stuckAfterMinutes: 2880, customerWaiting: true, says: "Money is owed back to somebody" },
        cancelled: { terminal: true, stuckAfterMinutes: null, customerWaiting: false, says: "Cancelled before anyone was out of pocket" },
        closed: { terminal: true, stuckAfterMinutes: null, customerWaiting: false, says: "Finished and settled" }
      };
      TRANSITIONS = [
        // placed
        { from: "placed", event: "pay_succeeded", to: "paid", actors: ["system"], says: "Payment cleared" },
        { from: "placed", event: "pay_failed", to: "payment_failed", actors: ["system"], says: "Payment was refused" },
        { from: "placed", event: "customer_cancelled", to: "cancelled", actors: ["customer", "ops"], says: "Customer changed their mind before paying" },
        // payment_failed
        { from: "payment_failed", event: "retry_payment", to: "placed", actors: ["customer", "ops"], says: "Trying the payment again" },
        { from: "payment_failed", event: "abandon", to: "cancelled", actors: ["customer", "ops", "system"], says: "Payment was never completed" },
        // paid
        { from: "paid", event: "offer_to_riders", to: "dispatch_offered", actors: ["system", "ops"], says: "Sent to the riders nearby" },
        { from: "paid", event: "merchant_rejected", to: "stock_problem", actors: ["merchant", "ops"], faultRequired: true, says: "The shop cannot take the order" },
        { from: "paid", event: "customer_cancelled", to: "refund_due", actors: ["customer", "ops"], faultRequired: true, says: "Cancelled after paying" },
        // dispatch_offered
        { from: "dispatch_offered", event: "rider_accepted", to: "dispatch_accepted", actors: ["courier"], says: "A rider took it" },
        { from: "dispatch_offered", event: "offer_expired", to: "dispatch_offered", actors: ["system"], says: "Nobody took it, offering again" },
        { from: "dispatch_offered", event: "no_rider_available", to: "rider_failed", actors: ["system", "ops"], faultRequired: true, says: "No rider can take this one" },
        { from: "dispatch_offered", event: "customer_cancelled", to: "refund_due", actors: ["customer", "ops"], faultRequired: true, says: "Cancelled while waiting for a rider" },
        // dispatch_accepted
        { from: "dispatch_accepted", event: "rider_arrived_at_shop", to: "at_merchant", actors: ["courier"], says: "Rider reached the shop" },
        { from: "dispatch_accepted", event: "rider_dropped", to: "dispatch_offered", actors: ["courier", "ops"], faultRequired: true, says: "Rider gave it up, offering again" },
        { from: "dispatch_accepted", event: "customer_cancelled", to: "refund_due", actors: ["customer", "ops"], faultRequired: true, says: "Cancelled while the rider was on the way" },
        // at_merchant
        { from: "at_merchant", event: "collected", to: "picked_up", actors: ["courier"], says: "Rider has the goods" },
        { from: "at_merchant", event: "out_of_stock", to: "stock_problem", actors: ["merchant", "courier", "ops"], faultRequired: true, says: "Something is not available" },
        { from: "at_merchant", event: "rider_failed_at_shop", to: "dispatch_offered", actors: ["courier", "ops"], faultRequired: true, says: "Rider cannot carry on, offering again" },
        // stock_problem
        { from: "stock_problem", event: "substitute_accepted", to: "at_merchant", actors: ["customer"], says: "Customer accepted a swap" },
        { from: "stock_problem", event: "line_dropped", to: "at_merchant", actors: ["customer", "ops", "merchant"], says: "Item taken off the order, the rest goes" },
        { from: "stock_problem", event: "cancel_order", to: "refund_due", actors: ["customer", "ops"], faultRequired: true, says: "Order dropped over stock" },
        // picked_up
        { from: "picked_up", event: "arrived", to: "at_door", actors: ["courier"], says: "Rider is at the address" },
        { from: "picked_up", event: "address_unclear", to: "address_problem", actors: ["courier"], says: "Rider cannot work out where to go" },
        { from: "picked_up", event: "rider_failed_en_route", to: "returning", actors: ["courier", "ops"], faultRequired: true, says: "Rider cannot finish, goods going back" },
        // at_door
        { from: "at_door", event: "handed_over", to: "delivered", actors: ["courier"], says: "Given to the customer" },
        { from: "at_door", event: "nobody_there", to: "customer_absent", actors: ["courier"], says: "No answer at the address" },
        { from: "at_door", event: "wrong_address", to: "address_problem", actors: ["courier"], says: "This is not the right place" },
        { from: "at_door", event: "id_check_failed", to: "returning", actors: ["courier"], faultRequired: true, says: "Identity check failed, liquor or medicine cannot be handed over" },
        // address_problem
        { from: "address_problem", event: "address_fixed", to: "picked_up", actors: ["customer", "courier", "ops"], says: "New directions given, rider going again" },
        { from: "address_problem", event: "give_up", to: "returning", actors: ["courier", "ops"], faultRequired: true, says: "The address could not be found" },
        // customer_absent
        { from: "customer_absent", event: "customer_answered", to: "at_door", actors: ["courier", "customer"], says: "Customer came to the door" },
        { from: "customer_absent", event: "wait_expired", to: "returning", actors: ["courier", "ops"], faultRequired: true, says: "Waited long enough, going back" },
        // rider_failed
        { from: "rider_failed", event: "reassigned", to: "dispatch_offered", actors: ["ops"], says: "Given to the riders again" },
        { from: "rider_failed", event: "cannot_recover", to: "refund_due", actors: ["ops"], faultRequired: true, says: "Nobody can deliver this one today" },
        // returning and returned
        { from: "returning", event: "back_at_merchant", to: "returned", actors: ["courier"], says: "Goods are back with the shop" },
        { from: "returned", event: "settle", to: "refund_due", actors: ["ops", "system"], faultRequired: true, says: "Working out who pays" },
        // delivered
        { from: "delivered", event: "close", to: "closed", actors: ["system", "ops"], says: "Order finished" },
        { from: "delivered", event: "dispute_raised", to: "refund_due", actors: ["customer", "ops"], faultRequired: true, says: "Customer says something was wrong" },
        // refund_due
        { from: "refund_due", event: "refunded", to: "closed", actors: ["ops", "system"], says: "Money returned, order finished" },
        { from: "refund_due", event: "no_refund_owed", to: "closed", actors: ["ops"], faultRequired: true, says: "Decided that nothing is owed back" }
      ];
      TransitionError = class extends Error {
        constructor(message) {
          super(message);
          this.name = "TransitionError";
        }
      };
    }
  });

  // ../api/src/orders/settlement.ts
  var settlement_exports = {};
  __export(settlement_exports, {
    SettlementError: () => SettlementError,
    dayPayout: () => dayPayout,
    payoutCsv: () => payoutCsv,
    pula: () => pula,
    readyToPay: () => readyToPay,
    settleOne: () => settleOne
  });
  function pula(thebe) {
    return `P${(thebe / 100).toFixed(2)}`;
  }
  function settleOne(o) {
    if (o.goods < 0 || o.delivery_fee < 0) throw new SettlementError("An order cannot have a negative amount on it.");
    if (o.delivered) {
      return {
        merchant: o.goods,
        perishable_loss: 0,
        sprint_fee: o.delivery_fee,
        sprint_absorbs: 0,
        says: "Delivered, paid in full"
      };
    }
    switch (o.fault) {
      case "merchant":
        return { merchant: 0, perishable_loss: 0, sprint_fee: 0, sprint_absorbs: 0, says: "The shop could not supply it, nothing is owed" };
      case "customer":
        return {
          merchant: 0,
          perishable_loss: o.perishable ? o.goods : 0,
          sprint_fee: o.delivery_fee,
          sprint_absorbs: 0,
          says: o.perishable ? "The customer caused it and the goods cannot be resold, so the shop is covered" : "The customer caused it, the goods go back, the delivery fee stands"
        };
      case "rider":
      case "sprint":
        return {
          merchant: 0,
          perishable_loss: o.perishable ? o.goods : 0,
          sprint_fee: 0,
          sprint_absorbs: (o.perishable ? o.goods : 0) + o.delivery_fee,
          says: "Sprint could not deliver it, so Sprint carries the cost"
        };
      case "none":
      default:
        return {
          merchant: 0,
          perishable_loss: o.perishable ? o.goods : 0,
          sprint_fee: 0,
          sprint_absorbs: o.perishable ? o.goods : 0,
          says: "Nobody was at fault, the goods that cannot be resold are covered"
        };
    }
  }
  function dayPayout(day, orders, agreed) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new SettlementError("A payout needs a day, as 2026-09-13.");
    const byMerchant = /* @__PURE__ */ new Map();
    let fees = 0, absorbed = 0;
    for (const o of orders) {
      const s = settleOne(o);
      fees += s.sprint_fee;
      absorbed += s.sprint_absorbs;
      const line = byMerchant.get(o.merchant_id) ?? {
        merchant_id: o.merchant_id,
        merchant_name: o.merchant_name,
        orders: 0,
        goods: 0,
        deductions: 0,
        perishable_loss: 0,
        net: 0,
        rail: o.rail,
        funded_by_sprint: WALLET.includes(o.rail),
        says: ""
      };
      line.orders += 1;
      line.goods += s.merchant;
      line.perishable_loss += s.perishable_loss;
      if (!o.delivered && o.fault === "merchant") line.deductions += 0;
      byMerchant.set(o.merchant_id, line);
    }
    const lines = [...byMerchant.values()].map((l) => {
      l.net = l.goods + l.perishable_loss - l.deductions;
      l.says = l.funded_by_sprint ? `${pula(l.net)} to ${l.merchant_name}, funded from Sprint's own account because ${railName(l.rail)} leaves the money in a wallet somebody must empty by hand` : IN_HAND.includes(l.rail) ? `${pula(l.net)} to ${l.merchant_name}, out of the cash the rider already collected` : `${pula(l.net)} to ${l.merchant_name} on ${railName(l.rail)}`;
      return l;
    }).sort((a, b) => b.net - a.net);
    const total = lines.reduce((a, l) => a + l.net, 0);
    const funded = lines.filter((l) => l.funded_by_sprint).reduce((a, l) => a + l.net, 0);
    return {
      day,
      lines,
      total,
      funded_by_sprint: funded,
      sprint_delivery_fees: fees,
      sprint_absorbed: absorbed,
      agreed,
      says: agreed ? `${pula(total)} to ${lines.length} merchant${lines.length === 1 ? "" : "s"} for ${day}` : `${pula(total)} worked out for ${day}, NOT PAYABLE until the fault model is agreed`
    };
  }
  function railName(r) {
    return { cash: "cash", orange_money: "Orange Money", myzaka: "MyZaka", smega: "Smega", card: "card", account: "account" }[r];
  }
  function readyToPay(p) {
    if (!p.agreed) {
      return { ready: false, says: "The fault model is still a proposal, so nothing can be paid out yet." };
    }
    if (p.total < 0) {
      return { ready: false, says: "The day works out to less than nothing, which means something is wrong. A person must look." };
    }
    return { ready: true, says: p.says };
  }
  function payoutCsv(p) {
    const head = "day,merchant_id,merchant_name,orders,goods_pula,perishable_pula,net_pula,rail,funded_by_sprint";
    const rows = p.lines.map((l) => [
      p.day,
      l.merchant_id,
      `"${l.merchant_name.replace(/"/g, '""')}"`,
      l.orders,
      (l.goods / 100).toFixed(2),
      (l.perishable_loss / 100).toFixed(2),
      (l.net / 100).toFixed(2),
      l.rail,
      l.funded_by_sprint ? "yes" : "no"
    ].join(","));
    const foot = `${p.day},TOTAL,"",${p.lines.reduce((a, l) => a + l.orders, 0)},,,${(p.total / 100).toFixed(2)},,`;
    return [head, ...rows, foot].join("\n") + "\n";
  }
  var IN_HAND, WALLET, SettlementError;
  var init_settlement = __esm({
    "../api/src/orders/settlement.ts"() {
      IN_HAND = ["cash"];
      WALLET = ["orange_money", "myzaka", "smega"];
      SettlementError = class extends Error {
        constructor(message) {
          super(message);
          this.name = "SettlementError";
        }
      };
    }
  });

  // engine-public.ts
  var require_engine_public = __commonJS({
    "engine-public.ts"() {
      init_state_machine();
      init_settlement();
      window.Engine = { machine: state_machine_exports, settlement: settlement_exports };
    }
  });
  require_engine_public();
})();
