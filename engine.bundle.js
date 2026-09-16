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
    var _a;
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
      at: (_a = opts.at) != null ? _a : (/* @__PURE__ */ new Date()).toISOString(),
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
    var _a;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new SettlementError("A payout needs a day, as 2026-09-13.");
    const byMerchant = /* @__PURE__ */ new Map();
    let fees = 0, absorbed = 0;
    for (const o of orders) {
      const s = settleOne(o);
      fees += s.sprint_fee;
      absorbed += s.sprint_absorbs;
      const line = (_a = byMerchant.get(o.merchant_id)) != null ? _a : {
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

  // ../api/src/orders/payments.ts
  var payments_exports = {};
  __export(payments_exports, {
    MemoryBook: () => MemoryBook,
    PaymentError: () => PaymentError,
    RAILS: () => RAILS,
    THEBE: () => THEBE,
    UnconfiguredRail: () => UnconfiguredRail,
    canMove: () => canMove,
    isFinal: () => isFinal,
    move: () => move,
    netOf: () => netOf,
    pula: () => pula2,
    railCost: () => railCost,
    railsAvailableToday: () => railsAvailableToday,
    railsWaitingOnSomebody: () => railsWaitingOnSomebody,
    refund: () => refund,
    take: () => take
  });
  function railsAvailableToday() {
    return Object.keys(RAILS).filter((r) => RAILS[r].blockedBy === null);
  }
  function railsWaitingOnSomebody() {
    return Object.keys(RAILS).filter((r) => RAILS[r].blockedBy !== null).map((r) => ({ rail: r, blockedBy: RAILS[r].blockedBy }));
  }
  function railCost(rail, amountThebe) {
    const spec = RAILS[rail];
    if (amountThebe < 0) throw new PaymentError("An amount cannot be negative.");
    return Math.round(amountThebe * spec.costBp / 1e4) + spec.costFlatThebe;
  }
  function netOf(rail, amountThebe) {
    return amountThebe - railCost(rail, amountThebe);
  }
  function pula2(thebe) {
    const sign = thebe < 0 ? "-" : "";
    const n = Math.abs(thebe);
    return sign + "P" + Math.floor(n / THEBE) + "." + String(n % THEBE).padStart(2, "0");
  }
  function canMove(from, to) {
    return MOVES[from].includes(to);
  }
  function isFinal(s) {
    return MOVES[s].length === 0;
  }
  function take(book, req) {
    if (!req.key) throw new PaymentError("A payment needs an idempotency key.");
    if (!Number.isInteger(req.amount_thebe)) {
      throw new PaymentError("Money is whole thebe. " + req.amount_thebe + " is not.");
    }
    if (req.amount_thebe <= 0) throw new PaymentError("An amount must be more than nothing.");
    const existing = book.get(req.key);
    if (existing) {
      if (existing.order_id !== req.order_id || existing.rail !== req.rail || existing.amount_thebe !== req.amount_thebe) {
        throw new PaymentError(
          "This key has already been used for a different payment. Refusing to charge again."
        );
      }
      return existing;
    }
    const spec = RAILS[req.rail];
    if (spec.blockedBy) {
      throw new PaymentError(spec.label + " is not switched on yet: " + spec.blockedBy);
    }
    if (req.amount_thebe < spec.minThebe) {
      throw new PaymentError(spec.label + " does not take amounts under " + pula2(spec.minThebe) + ".");
    }
    if (req.amount_thebe > spec.maxThebe) {
      throw new PaymentError(spec.label + " does not take amounts over " + pula2(spec.maxThebe) + ".");
    }
    const p = {
      key: req.key,
      order_id: req.order_id,
      rail: req.rail,
      amount_thebe: req.amount_thebe,
      state: spec.needsCustomerAction ? "awaiting_customer" : "created",
      cost_thebe: 0,
      refunded_thebe: 0,
      rail_ref: null,
      says: spec.needsCustomerAction ? "Approve " + pula2(req.amount_thebe) + " on your phone." : pula2(req.amount_thebe) + " due at the door."
    };
    book.put(p);
    return p;
  }
  function move(book, key, to, railRef) {
    const p = book.get(key);
    if (!p) throw new PaymentError("No payment with that key.");
    if (!canMove(p.state, to)) {
      throw new PaymentError("A payment cannot go from " + p.state + " to " + to + ".");
    }
    p.state = to;
    if (railRef) p.rail_ref = railRef;
    if (to === "captured") {
      p.cost_thebe = railCost(p.rail, p.amount_thebe);
      p.says = pula2(p.amount_thebe) + " received.";
    }
    if (to === "failed") p.says = "That payment did not go through. Nothing was taken.";
    if (to === "cancelled") p.says = "Payment cancelled. Nothing was taken.";
    book.put(p);
    return p;
  }
  function refund(book, key, amountThebe) {
    const p = book.get(key);
    if (!p) throw new PaymentError("No payment with that key.");
    if (p.state !== "captured") throw new PaymentError("Only money actually taken can be sent back.");
    if (!RAILS[p.rail].refundable) {
      throw new PaymentError(
        RAILS[p.rail].label + " cannot be refunded by software. This one goes through settlement."
      );
    }
    if (!Number.isInteger(amountThebe) || amountThebe <= 0) {
      throw new PaymentError("A refund must be a whole amount of thebe, more than nothing.");
    }
    if (p.refunded_thebe + amountThebe > p.amount_thebe) {
      throw new PaymentError("That is more than was taken.");
    }
    p.refunded_thebe += amountThebe;
    if (p.refunded_thebe === p.amount_thebe) p.state = "refunded";
    p.says = pula2(p.refunded_thebe) + " sent back.";
    book.put(p);
    return p;
  }
  var THEBE, PaymentError, RAILS, MOVES, MemoryBook, UnconfiguredRail;
  var init_payments = __esm({
    "../api/src/orders/payments.ts"() {
      THEBE = 100;
      PaymentError = class extends Error {
      };
      RAILS = {
        cash: {
          label: "Cash at the door",
          needsCustomerAction: false,
          refundable: false,
          // a rider cannot un-take cash; this goes through settlement
          costBp: 0,
          costFlatThebe: 0,
          minThebe: 0,
          maxThebe: 1e5,
          // P1000, the cap cash.ts already enforces
          blockedBy: null
        },
        orange_money: {
          label: "Orange Money",
          needsCustomerAction: true,
          // the customer approves on their handset
          refundable: true,
          costBp: 0,
          costFlatThebe: 0,
          minThebe: 100,
          maxThebe: 5e5,
          blockedBy: "Orange Money merchant credentials and rate (email queued Monday 10:05)"
        },
        myzaka: {
          label: "MyZaka",
          needsCustomerAction: true,
          refundable: true,
          costBp: 0,
          costFlatThebe: 0,
          minThebe: 100,
          maxThebe: 5e5,
          blockedBy: "Mascom MyZaka merchant credentials and rate (email queued Monday 10:35)"
        },
        smega: {
          label: "Smega",
          needsCustomerAction: true,
          refundable: true,
          costBp: 0,
          costFlatThebe: 0,
          minThebe: 100,
          maxThebe: 5e5,
          blockedBy: "BTC Smega merchant credentials and rate (email queued Monday 11:05)"
        },
        card: {
          label: "Card",
          needsCustomerAction: true,
          refundable: true,
          costBp: 0,
          costFlatThebe: 0,
          minThebe: 100,
          maxThebe: 2e6,
          blockedBy: "A card gateway chosen and signed: DPO or Tingg"
        },
        account: {
          label: "On account",
          needsCustomerAction: false,
          refundable: true,
          costBp: 0,
          costFlatThebe: 0,
          minThebe: 0,
          maxThebe: 1e7,
          blockedBy: null
          // corporate.ts already governs who may do this
        }
      };
      MOVES = {
        created: ["awaiting_customer", "captured", "failed", "cancelled"],
        awaiting_customer: ["captured", "failed", "cancelled"],
        captured: ["refunded"],
        failed: [],
        cancelled: [],
        refunded: []
      };
      MemoryBook = class {
        constructor() {
          this.m = /* @__PURE__ */ new Map();
        }
        get(key) {
          return this.m.get(key);
        }
        put(p) {
          this.m.set(p.key, p);
        }
        all() {
          return [...this.m.values()];
        }
      };
      UnconfiguredRail = class {
        constructor(rail) {
          this.rail = rail;
        }
        async charge() {
          var _a;
          const spec = RAILS[this.rail];
          throw new PaymentError(
            spec.label + " has no credentials on this machine. Waiting on: " + ((_a = spec.blockedBy) != null ? _a : "nothing")
          );
        }
      };
    }
  });

  // ../api/src/orders/cash.ts
  var cash_exports = {};
  __export(cash_exports, {
    CASH_CAP_THEBE: () => CASH_CAP_THEBE,
    CashError: () => CashError,
    FLOAT_SIGNOFF_THEBE: () => FLOAT_SIGNOFF_THEBE,
    NOTES: () => NOTES,
    THEBE: () => THEBE2,
    WRITE_OFF_THEBE: () => WRITE_OFF_THEBE,
    canBeHandedOver: () => canBeHandedOver,
    cashAllowed: () => cashAllowed,
    changeFor: () => changeFor,
    floatFor: () => floatFor,
    needsCashPhoto: () => needsCashPhoto,
    notesFor: () => notesFor,
    payableWith: () => payableWith,
    pula: () => pula3,
    reconcile: () => reconcile,
    saysNotes: () => saysNotes,
    tendersFor: () => tendersFor
  });
  function pula3(thebe) {
    return `P${(thebe / THEBE2).toFixed(2)}`;
  }
  function cashAllowed(totalThebe) {
    if (!Number.isInteger(totalThebe) || totalThebe <= 0) {
      throw new CashError("An order total must be a whole number of thebe before cash can be offered.");
    }
    if (totalThebe > CASH_CAP_THEBE) {
      return {
        allowed: false,
        says: `Orders over ${pula3(CASH_CAP_THEBE)} cannot be paid in cash. Please choose another way to pay.`
      };
    }
    return { allowed: true, says: "You can pay the rider in cash" };
  }
  function payableWith(totalThebe) {
    return NOTES.filter((n) => n >= totalThebe || n >= smallestCovering(totalThebe));
  }
  function smallestCovering(totalThebe) {
    const fits = NOTES.filter((n) => n >= totalThebe);
    return fits.length ? Math.min(...fits) : Math.max(...NOTES);
  }
  function notesFor(amountThebe) {
    if (!Number.isInteger(amountThebe) || amountThebe < 0) return null;
    if (amountThebe === 0) return [];
    const smallest = Math.min(...NOTES);
    if (amountThebe % smallest !== 0) return null;
    const out = [];
    let left = amountThebe;
    for (const n of [...NOTES].sort((a, b) => b - a)) {
      while (left >= n) {
        out.push(n);
        left -= n;
      }
    }
    return left === 0 ? out : null;
  }
  function canBeHandedOver(amountThebe) {
    return notesFor(amountThebe) !== null;
  }
  function saysNotes(amountThebe) {
    var _a;
    const ns = notesFor(amountThebe);
    if (!ns || ns.length === 0) return "nothing";
    const counted = /* @__PURE__ */ new Map();
    for (const n of ns) counted.set(n, ((_a = counted.get(n)) != null ? _a : 0) + 1);
    const parts = [...counted.entries()].map(
      ([note, times]) => times === 1 ? "a " + pula3(note) : times + " x " + pula3(note)
    );
    if (parts.length === 1) return parts[0];
    return parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
  }
  function tendersFor(totalThebe) {
    const check = cashAllowed(totalThebe);
    if (!check.allowed) return [];
    const smallest = Math.min(...NOTES);
    const least = Math.ceil(totalThebe / smallest) * smallest;
    const out = /* @__PURE__ */ new Set();
    if (canBeHandedOver(least)) out.add(least);
    for (const step of [5e3, 1e4, 2e4]) {
      const rounded = Math.ceil(totalThebe / step) * step;
      if (rounded !== least && canBeHandedOver(rounded) && rounded <= CASH_CAP_THEBE) {
        out.add(rounded);
      }
    }
    return [...out].sort((a, b) => a - b).slice(0, 3);
  }
  function changeFor(totalThebe, payingWithThebe) {
    const check = cashAllowed(totalThebe);
    if (!check.allowed) throw new CashError(check.says);
    if (!canBeHandedOver(payingWithThebe)) {
      throw new CashError(
        `${pula3(payingWithThebe)} is not an amount anyone can hand over. The smallest note is ${pula3(Math.min(...NOTES))}.`
      );
    }
    if (payingWithThebe < totalThebe) {
      throw new CashError(
        `${pula3(payingWithThebe)} does not cover ${pula3(totalThebe)}. Hand over more.`
      );
    }
    const change = payingWithThebe - totalThebe;
    return {
      change,
      riderNeeds: change,
      says: change === 0 ? "No change needed, the customer has it exactly" : `Your rider will bring ${pula3(change)} change`,
      handingOver: saysNotes(payingWithThebe)
    };
  }
  function floatFor(orders) {
    const per_order = orders.map((o) => ({
      order_id: o.order_id,
      change: changeFor(o.total, o.paying_with).change
    }));
    const float = per_order.reduce((a, b) => a + b.change, 0);
    const needs_signoff = float > FLOAT_SIGNOFF_THEBE;
    return {
      float,
      needs_signoff,
      per_order,
      says: needs_signoff ? `${pula3(float)} float, which needs a supervisor to hand it over and sign` : `${pula3(float)} float for ${orders.length} cash order${orders.length === 1 ? "" : "s"}`
    };
  }
  function reconcile(floatOut, orders, countedIn) {
    if (!Number.isInteger(countedIn) || countedIn < 0) {
      throw new CashError("The counted amount must be a whole number of thebe. Count it again.");
    }
    const collected = orders.reduce((a, o) => a + o.paying_with, 0);
    const givenOut = orders.reduce((a, o) => a + changeFor(o.total, o.paying_with).change, 0);
    const expected = floatOut + collected - givenOut;
    const difference = countedIn - expected;
    const within = Math.abs(difference) <= WRITE_OFF_THEBE;
    return {
      expected,
      counted: countedIn,
      difference,
      short: difference < 0,
      within_write_off: within,
      says: difference === 0 ? "Balanced exactly" : within ? `${pula3(Math.abs(difference))} ${difference < 0 ? "short" : "over"}, inside the write off, closed` : `${pula3(Math.abs(difference))} ${difference < 0 ? "SHORT" : "OVER"}, this one needs a person to look at it`
    };
  }
  function needsCashPhoto(totalThebe) {
    return totalThebe >= 2e4;
  }
  var NOTES, THEBE2, CASH_CAP_THEBE, FLOAT_SIGNOFF_THEBE, WRITE_OFF_THEBE, CashError;
  var init_cash = __esm({
    "../api/src/orders/cash.ts"() {
      NOTES = [2e4, 1e4, 5e3, 2e3, 1e3];
      THEBE2 = 100;
      CASH_CAP_THEBE = 1e5;
      FLOAT_SIGNOFF_THEBE = 5e4;
      WRITE_OFF_THEBE = 500;
      CashError = class extends Error {
        constructor(message) {
          super(message);
          this.name = "CashError";
        }
      };
    }
  });

  // ../api/src/catalog/verticals.ts
  var verticals_exports = {};
  __export(verticals_exports, {
    VERTICALS: () => VERTICALS,
    allVerticals: () => allVerticals,
    gatesFor: () => gatesFor,
    groupByVertical: () => groupByVertical,
    isVertical: () => isVertical,
    mayList: () => mayList,
    rulesFor: () => rulesFor
  });
  function allVerticals() {
    return Object.keys(VERTICALS).sort(
      (a, b) => VERTICALS[a].order - VERTICALS[b].order
    );
  }
  function isVertical(v) {
    return Object.prototype.hasOwnProperty.call(VERTICALS, v);
  }
  function rulesFor(v) {
    return VERTICALS[v];
  }
  function gatesFor(v) {
    const r = VERTICALS[v];
    const gates = [];
    if (r.ageRestricted) gates.push("identity checked at the door");
    if (r.licenceRequired) gates.push("merchant licence on file");
    if (r.tradingHours) gates.push("handover inside licensed hours");
    if (r.prescription) gates.push("pharmacist dispensed and sealed");
    if (r.coldChain) gates.push("cold box where flagged");
    return gates;
  }
  function mayList(v) {
    const r = VERTICALS[v];
    if (r.blockedBy) return { listable: false, reason: r.blockedBy };
    return { listable: true, reason: null };
  }
  function groupByVertical(merchants) {
    var _a;
    const unplaced = [];
    const bucket = /* @__PURE__ */ new Map();
    for (const m of merchants) {
      if (!isVertical(m.type)) {
        unplaced.push(m);
        continue;
      }
      const list = (_a = bucket.get(m.type)) != null ? _a : [];
      list.push(m);
      bucket.set(m.type, list);
    }
    const sections = [];
    const blocked = [];
    for (const v of allVerticals()) {
      const found = bucket.get(v);
      if (!found || found.length === 0) continue;
      if (!mayList(v).listable) {
        blocked.push(v);
        continue;
      }
      sections.push({
        vertical: v,
        label: VERTICALS[v].label,
        gates: gatesFor(v),
        merchants: found
      });
    }
    return { sections, unplaced, blocked };
  }
  var VERTICALS;
  var init_verticals = __esm({
    "../api/src/catalog/verticals.ts"() {
      VERTICALS = {
        food: {
          label: "Restaurants",
          order: 1,
          ageRestricted: false,
          licenceRequired: false,
          tradingHours: false,
          prescription: false,
          coldChain: false,
          blockedBy: null
        },
        grocery: {
          label: "Groceries",
          order: 2,
          ageRestricted: false,
          licenceRequired: false,
          tradingHours: false,
          prescription: false,
          coldChain: true,
          // frozen and chilled baskets travel in a cold box
          blockedBy: null
        },
        pet: {
          label: "Pet and vet",
          order: 3,
          ageRestricted: false,
          licenceRequired: false,
          tradingHours: false,
          prescription: false,
          coldChain: false,
          blockedBy: null
        },
        hardware: {
          label: "Hardware and home",
          order: 4,
          ageRestricted: false,
          licenceRequired: false,
          tradingHours: false,
          prescription: false,
          coldChain: false,
          blockedBy: null
        },
        baby: {
          label: "Baby and kids",
          order: 5,
          ageRestricted: false,
          licenceRequired: false,
          tradingHours: false,
          prescription: false,
          coldChain: false,
          blockedBy: null
        },
        parcel: {
          label: "Send a parcel",
          order: 6,
          ageRestricted: false,
          licenceRequired: false,
          tradingHours: false,
          prescription: false,
          coldChain: false,
          blockedBy: null
        },
        liquor: {
          label: "Liquor",
          order: 7,
          ageRestricted: true,
          licenceRequired: true,
          tradingHours: true,
          prescription: false,
          coldChain: false,
          blockedBy: null
          // the gates are built; a merchant licence is a merchant problem
        },
        pharmacy: {
          label: "Pharmacy",
          order: 8,
          ageRestricted: true,
          licenceRequired: true,
          tradingHours: false,
          prescription: true,
          coldChain: true,
          blockedBy: "BoMRA's written answer on carrying a sealed, pharmacist dispensed prescription (brick 8)"
        }
      };
    }
  });

  // engine-public.ts
  var require_engine_public = __commonJS({
    "engine-public.ts"() {
      init_state_machine();
      init_settlement();
      init_payments();
      init_cash();
      init_verticals();
      window.Engine = { machine: state_machine_exports, settlement: settlement_exports, payments: payments_exports, cash: cash_exports, verticals: verticals_exports };
    }
  });
  require_engine_public();
})();
