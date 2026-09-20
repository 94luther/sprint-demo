/* THE STRING TABLE. Every word a customer reads lives here, in both languages.
   Nothing in the interface may hard-code English text any more: it calls T('key').

   STATUS OF THE SETSWANA, stated plainly rather than pretended:
   These are DRAFT translations. They were written carefully, but not by a first-language
   Setswana speaker, and a delivery app that speaks broken Setswana is worse than one that
   does not try. Every line below is marked with how confident it is:

     ok     ordinary, everyday word. Safe.
     check  understandable but a native speaker may have a better word.
     ASK    genuinely uncertain. Do not ship this line without asking someone.

   The mechanism is finished. Replacing a draft line is editing one string in this file,
   and lint-strings.py reports what is still unverified. Give this file to a Motswana
   colleague and the language ships the same day.                     20 September 2026 */

var STRINGS = {
  en: {
    /* shell */
    "nav.home": "Home",
    "nav.browse": "Browse",
    "nav.basket": "Basket",
    "nav.orders": "Orders",
    "app.tagline": "Sprint Me \u00b7 several shops, one delivery",
    "deliver.to": "Deliver to",
    "search.placeholder": "Search shops, food, groceries and more",

    /* categories */
    "cat.food": "Food",
    "cat.groceries": "Groceries",
    "cat.pharmacy": "Pharmacy",
    "cat.parcels": "Parcels",

    /* feed */
    "feed.fastest": "Usually fastest",
    "feed.foodnow": "Food you can order now",
    "feed.groceries": "Groceries, same delivery",
    "feed.pharmacy": "Pharmacy and health",
    "feed.allshops": "All {n} shops you can order from",
    "feed.soon": "Coming soon",
    "feed.seeall": "See all",
    "feed.nomenu": "Menu not sent yet",

    /* shop */
    "shop.minimum": "Minimum {a} \u00b7 delivery {b}",
    "shop.addmore": "Add {a} more to reach this shop\u2019s minimum of {b}",
    "shop.viewbasket": "View basket, {a}",
    "shop.addsomething": "Add something to your basket",
    "shop.nomenu.title": "{shop} has not sent us a menu yet",
    "shop.nomenu.body": "This shop is on the Sprint Me network, but its prices and stock come from the shop itself and have not arrived. Nothing here is invented while we wait.",
    "shop.findothers": "See shops you can order from",
    "price.ask": "Price confirmed at the shop",

    /* basket */
    "basket.title": "Your basket",
    "basket.shops.one": "1 shop, one delivery",
    "basket.shops.many": "{n} shops, one delivery",
    "basket.empty.title": "Your basket is empty",
    "basket.empty.body": "Add something from any shop. Everything travels together on one delivery.",
    "basket.empty.cta": "Find a shop",
    "basket.removeshop": "Remove shop",
    "basket.items": "Items",
    "basket.separate": "{n} separate deliveries",
    "basket.onefee": "One Sprint Me delivery",
    "basket.saving": "You save",
    "basket.delivery": "Delivery",
    "basket.total": "Total",
    "basket.sofar": "Total so far",
    "basket.toconfirm": "{n} to confirm",
    "bar.items.one": "1 item",
    "bar.items.many": "{n} items",
    "bar.shops.one": "1 shop",
    "bar.shops.many": "{n} shops",
    "bar.addany": "Add from any shop. One delivery.",
    "bar.onefee": "Different shops. One delivery, {a}.",
    "bar.view": "View basket",

    /* how it arrives: delivery or collection */
    "how.title": "How would you like it?",
    "how.deliver": "Bring it to me",
    "how.deliver.sub": "One rider, every shop, to your door",
    "how.collect": "I will collect it",
    "how.collect.sub": "Free. Pick it up at a Sprint branch",
    "collect.free": "No delivery fee",
    "collect.pick": "Choose a Sprint branch",
    "collect.change": "Change branch",
    "collect.searchtown": "Search a town or a branch",
    "collect.points": "{n} Sprint branches in {t} towns",
    "collect.at": "Collect at {b}",
    "collect.code": "Your collection code",
    "collect.code.help": "Show this code at the counter. Nobody else can collect with it.",
    "collect.ready": "We will tell you the moment it is ready",
    "collect.othertown": "Collect in another town",
    "collect.othertown.sub": "Sprint runs to {t} towns every working day. Order here, collect there.",
    "collect.nobranch": "No branch matches that. Try a town name.",

    /* checkout */
    "pay.address": "Where the rider goes",
    "pay.confirm": "That is right",
    "pay.notconfirmed": "Not confirmed",
    "pay.how": "How you pay",
    "pay.place": "Place the order",
    "pay.empty": "Your basket is empty",
    "pay.needprice.one": "One item still needs a price from the shop",
    "pay.needprice.many": "{n} items still need a price from the shop",
    "pay.needmore": "Add {a} more from {shop}",
    "pay.needaddress": "Confirm the address first",
    "pay.needrail": "Choose how you pay",
    "pay.needcash": "Pick an amount the rider can change",
    "pay.pickbranch": "Choose a branch to collect from",

    /* general */
    "lang.name": "English",
    "lang.switch": "Setswana"
  },

  tn: {
    /* shell */
    "nav.home": "Gae",                                  /* ok */
    "nav.browse": "Lebelela",                           /* ok, "look at" */
    "nav.basket": "Kgetsi",                             /* ok, basket/bag */
    "nav.orders": "Ditaelo",                            /* ok, orders/instructions */
    "app.tagline": "Sprint Me \u00b7 mabenkele a mantsi, thomelo e le nngwe",   /* check */
    "deliver.to": "Isa kwa go",                         /* check, "take it to" */
    "search.placeholder": "Batla mabenkele, dijo le tse dingwe",   /* ok */

    /* categories */
    "cat.food": "Dijo",                                 /* ok */
    "cat.groceries": "Dijo tsa ntlo",                   /* check, "food of the house" */
    "cat.pharmacy": "Khemisi",                          /* ok, borrowed and in daily use */
    "cat.parcels": "Diphuthelo",                        /* ok, parcels */

    /* feed */
    "feed.fastest": "Ka bonako",                        /* ok, "quickly" */
    "feed.foodnow": "Dijo tse o ka di rekang jaanong",  /* check */
    "feed.groceries": "Dijo tsa ntlo, thomelo e le nngwe",  /* check */
    "feed.pharmacy": "Khemisi le boitekanelo",          /* check, "chemist and health" */
    "feed.allshops": "Mabenkele otlhe a le {n}",        /* check */
    "feed.soon": "A e tla",                             /* check, "it is coming" */
    "feed.seeall": "Bona tsotlhe",                      /* ok */
    "feed.nomenu": "Ga go na menu",                     /* ASK, "menu" is borrowed */

    /* shop */
    "shop.minimum": "Bonnye {a} \u00b7 thomelo {b}",     /* check */
    "shop.addmore": "Tsenya {a} gape go fitlha bonnye jwa {b}",   /* ASK */
    "shop.viewbasket": "Bona kgetsi, {a}",              /* ok */
    "shop.addsomething": "Tsenya sengwe mo kgetsing",   /* ok */
    "shop.nomenu.title": "{shop} ga e ise e re romele menu",      /* ASK */
    "shop.nomenu.body": "Lebenkele le le mo networking ya Sprint Me, mme ditlhwatlhwa le dithoto di tswa mo lebenkeleng ka bolone, mme ga di ise di goroge. Ga re itlhamele sepe fa re letile.",   /* ASK */
    "shop.findothers": "Bona mabenkele a o ka rekang mo go one",  /* check */
    "price.ask": "Tlhwatlhwa e tlhomamisiwa kwa lebenkeleng",     /* check */

    /* basket */
    "basket.title": "Kgetsi ya gago",                   /* ok */
    "basket.shops.one": "Lebenkele le le 1, thomelo e le nngwe",  /* check */
    "basket.shops.many": "Mabenkele a le {n}, thomelo e le nngwe", /* check */
    "basket.empty.title": "Kgetsi ya gago ga e na sepe",          /* ok */
    "basket.empty.body": "Tsenya sengwe go tswa lebenkeleng lengwe le lengwe. Tsotlhe di tla mmogo ka thomelo e le nngwe.",  /* check */
    "basket.empty.cta": "Batla lebenkele",              /* ok */
    "basket.removeshop": "Ntsha lebenkele",             /* ok */
    "basket.items": "Dilo",                             /* ok, "things" */
    "basket.separate": "Dithomelo tse di farologaneng tse {n}",   /* check */
    "basket.onefee": "Thomelo e le nngwe ya Sprint Me", /* check */
    "basket.saving": "O boloka",                        /* ok, "you save" */
    "basket.delivery": "Thomelo",                       /* ok */
    "basket.total": "Palogotlhe",                       /* ok */
    "basket.sofar": "Palogotlhe go fitlha jaanong",     /* check */
    "basket.toconfirm": "{n} e santse e tlhomamisiwa",  /* ASK */
    "bar.items.one": "Selo se le 1",                    /* check */
    "bar.items.many": "Dilo tse {n}",                   /* ok */
    "bar.shops.one": "Lebenkele le le 1",               /* check */
    "bar.shops.many": "Mabenkele a le {n}",             /* check */
    "bar.addany": "Tsenya go tswa lebenkeleng lengwe le lengwe. Thomelo e le nngwe.",  /* check */
    "bar.onefee": "Mabenkele a a farologaneng. Thomelo e le nngwe, {a}.",  /* check */
    "bar.view": "Bona kgetsi",                          /* ok */

    /* how it arrives */
    "how.title": "O batla e tla jang?",                 /* check, "how do you want it to come" */
    "how.deliver": "E tlisetswe nna",                   /* check */
    "how.deliver.sub": "Morwalo a le mongwe, mabenkele otlhe, go ya kgorong ya gago",  /* ASK */
    "how.collect": "Ke tla e tsaya",                    /* ok, "I will take it" */
    "how.collect.sub": "Mahala. E tsee kwa lekaleng la Sprint",   /* check */
    "collect.free": "Ga go na tuelo ya thomelo",        /* check */
    "collect.pick": "Tlhopha lekala la Sprint",         /* check, lekala = branch */
    "collect.change": "Fetola lekala",                  /* ok */
    "collect.searchtown": "Batla toropo kgotsa lekala", /* ok */
    "collect.points": "Makala a Sprint a le {n} mo ditoropong tse {t}",  /* check */
    "collect.at": "E tsee kwa {b}",                     /* check */
    "collect.code": "Nomoro ya gago ya go tsaya",       /* check */
    "collect.code.help": "Bontsha nomoro e kwa counter. Ga go na ope yo mongwe yo o ka e tsayang.",  /* ASK */
    "collect.ready": "Re tla go itsise fa e siame",     /* check */
    "collect.othertown": "E tsee kwa toropong e nngwe", /* check */
    "collect.othertown.sub": "Sprint e tsamaya kwa ditoropong tse {t} letsatsi lengwe le lengwe la tiro. Reka fa, o tsee koo.",  /* ASK */
    "collect.nobranch": "Ga go na lekala le le tshwanang le seo. Leka leina la toropo.",  /* check */

    /* checkout */
    "pay.address": "Kwa morwalo a yang teng",           /* ASK */
    "pay.confirm": "Go siame",                          /* ok, "it is right" */
    "pay.notconfirmed": "Ga go a tlhomamisiwa",         /* check */
    "pay.how": "O duela jang",                          /* ok */
    "pay.place": "Romela taelo",                        /* ok */
    "pay.empty": "Kgetsi ya gago ga e na sepe",         /* ok */
    "pay.needprice.one": "Selo se le sengwe se santse se tlhoka tlhwatlhwa",      /* check */
    "pay.needprice.many": "Dilo tse {n} di santse di tlhoka tlhwatlhwa",          /* check */
    "pay.needmore": "Tsenya {a} gape go tswa {shop}",   /* check */
    "pay.needaddress": "Tlhomamisa aterese pele",       /* check */
    "pay.needrail": "Tlhopha gore o duela jang",        /* ok */
    "pay.needcash": "Tlhopha madi a morwalo a ka a ntshang chenchi",  /* ASK */
    "pay.pickbranch": "Tlhopha lekala la go tsaya",     /* check */

    /* general */
    "lang.name": "Setswana",
    "lang.switch": "English"
  }
};
