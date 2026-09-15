import { hashSync, Algorithm } from '@node-rs/argon2';
import * as crypto from 'node:crypto';
import { encrypt, blindIndex } from '../common/aes';
import { WAYPOINTS } from '../common/waypoints';
import { StoreShape, UserRecord, MerchantRecord, CourierRecord } from './interfaces';

// Builds the fresh demo dataset described in the Sprint alpha contract:
// 3 demo login users, 4 merchants (food, grocery, vape, pharmacy) with
// realistic Pula pricing and delivery-app grade catalog imagery, and 5 named
// couriers wandering around Gaborone. Called once, the first time the API
// boots and data/store.json does not exist yet.
export function buildSeed(): StoreShape {
  const merchants: MerchantRecord[] = [
    {
      id: 'm1',
      name: "Mama T's Kitchen",
      type: 'food',
      age_restricted: false,
      lat: WAYPOINTS[1].lat + 0.002,
      lng: WAYPOINTS[1].lng - 0.001,
      heroImage: '/food/stew.jpg',
      rating: 4.7,
      ratingCount: 320,
      etaMinLow: 25,
      etaMinHigh: 40,
      deliveryFee: 12,
      promo: '20% off, up to P30',
      status: 'open',
      items: [
        {
          id: 'm1-i1',
          name: 'Seswaa and Pap',
          price_bwp: 55,
          photo: '/food/stew.jpg',
          description: 'Slow-cooked shredded beef with a mound of soft pap.',
        },
        {
          id: 'm1-i2',
          name: 'Chicken and Rice',
          price_bwp: 45,
          photo: '/food/curryrice.jpg',
          description: 'Spiced chicken pieces over fragrant rice.',
        },
        {
          id: 'm1-i3',
          name: 'Beef Stew Plate',
          price_bwp: 50,
          photo: '/food/beans.jpg',
          description: 'Hearty beef stew plate with a side of beans.',
        },
        {
          id: 'm1-i4',
          name: 'Vegetable Relish Plate',
          price_bwp: 35,
          photo: '/food/veg.jpg',
          description: 'Fresh seasonal vegetable relish, lightly spiced.',
        },
        {
          id: 'm1-i5',
          name: 'Grilled Chicken Quarter',
          price_bwp: 40,
          photo: '/food/friedrice.jpg',
          description: 'Chargrilled quarter chicken with a side of rice.',
        },
        {
          id: 'm1-i6',
          name: 'Bogobe with Sour Milk',
          price_bwp: 30,
          photo: '/food/bread2.jpg',
          description: 'Traditional sorghum porridge with cultured sour milk.',
        },
      ],
    },
    {
      id: 'm2',
      name: 'QuickMart Broadhurst',
      type: 'grocery',
      age_restricted: false,
      lat: WAYPOINTS[2].lat - 0.003,
      lng: WAYPOINTS[2].lng + 0.002,
      heroImage: '/food/grocery.jpg',
      rating: 3.9,
      ratingCount: 41,
      etaMinLow: 30,
      etaMinHigh: 50,
      deliveryFee: 15,
      promo: null,
      status: 'busy',
      items: [
        {
          id: 'm2-i1',
          name: 'White Bread 700g',
          price_bwp: 14,
          photo: '/food/bread.jpg',
          description: 'Fresh sliced white bread loaf, 700g.',
        },
        {
          id: 'm2-i2',
          name: 'Fresh Milk 1L',
          price_bwp: 18,
          photo: '/food/milk.jpg',
          description: 'Full cream fresh milk, 1 litre.',
        },
        {
          id: 'm2-i3',
          name: 'Eggs Tray of 30',
          price_bwp: 55,
          photo: '/food/grocery.jpg',
          description: 'Tray of 30 farm fresh eggs.',
        },
        {
          id: 'm2-i4',
          name: 'White Sugar 2kg',
          price_bwp: 32,
          photo: '/food/market.jpg',
          description: 'Refined white sugar, 2kg bag.',
        },
        {
          id: 'm2-i5',
          name: 'Cooking Oil 750ml',
          price_bwp: 28,
          photo: '/food/veg.jpg',
          description: 'Pure sunflower cooking oil, 750ml.',
        },
        {
          id: 'm2-i6',
          name: 'Maize Meal 10kg',
          price_bwp: 95,
          photo: '/food/beans.jpg',
          description: 'Coarse maize meal, 10kg bag, a kitchen staple.',
        },
      ],
    },
    {
      id: 'm3',
      name: 'CloudNine Vapes',
      type: 'vape',
      age_restricted: true,
      lat: WAYPOINTS[0].lat + 0.0015,
      lng: WAYPOINTS[0].lng + 0.0025,
      heroImage: '/food/market.jpg',
      rating: 4.2,
      ratingCount: 96,
      etaMinLow: 25,
      etaMinHigh: 45,
      deliveryFee: 18,
      promo: null,
      status: 'closed',
      items: [
        {
          id: 'm3-i1',
          name: 'Disposable Vape 2500 Puffs',
          price_bwp: 180,
          photo: '/food/market.jpg',
          description: 'Disposable vape device, approximately 2500 puffs.',
        },
        {
          id: 'm3-i2',
          name: 'Disposable Vape 5000 Puffs',
          price_bwp: 250,
          photo: '/food/grocery.jpg',
          description: 'Disposable vape device, approximately 5000 puffs.',
        },
        {
          id: 'm3-i3',
          name: 'Vape Juice 30ml',
          price_bwp: 120,
          photo: '/food/veg.jpg',
          description: 'E-liquid refill bottle, 30ml.',
        },
        {
          id: 'm3-i4',
          name: 'Replacement Coils 5 Pack',
          price_bwp: 90,
          photo: '/food/bread2.jpg',
          description: 'Pack of 5 replacement coils.',
        },
        {
          id: 'm3-i5',
          name: 'Starter Kit',
          price_bwp: 350,
          photo: '/food/beans.jpg',
          description: 'Complete starter kit with device and charger.',
        },
      ],
    },
    {
      id: 'm4',
      name: 'Kgale Pharmacy',
      type: 'pharmacy',
      age_restricted: false,
      lat: WAYPOINTS[3].lat + 0.001,
      lng: WAYPOINTS[3].lng - 0.0015,
      heroImage: '/food/pharmacy.jpg',
      rating: 4.8,
      ratingCount: 142,
      etaMinLow: 15,
      etaMinHigh: 30,
      deliveryFee: 10,
      promo: 'Free delivery on your first order',
      status: 'open',
      items: [
        {
          id: 'm4-i1',
          name: 'Paracetamol 500mg',
          price_bwp: 25,
          photo: '/food/pharmacy.jpg',
          description: 'Pack of 20 paracetamol tablets, 500mg.',
        },
        {
          id: 'm4-i2',
          name: 'Ibuprofen 200mg',
          price_bwp: 30,
          photo: '/food/pharmacy.jpg',
          description: 'Pack of 20 ibuprofen tablets, 200mg.',
        },
        {
          id: 'm4-i3',
          name: 'Multivitamin Tablets 30s',
          price_bwp: 65,
          photo: '/food/pharmacy.jpg',
          description: 'Daily multivitamin, 30 tablet pack.',
        },
        {
          id: 'm4-i4',
          name: 'Digital Thermometer',
          price_bwp: 85,
          photo: '/food/pharmacy.jpg',
          description: 'Fast-read digital body thermometer.',
        },
        {
          id: 'm4-i5',
          name: 'Hand Sanitizer 500ml',
          price_bwp: 35,
          photo: '/food/pharmacy.jpg',
          description: 'Alcohol-based hand sanitizer, 500ml pump bottle.',
        },
      ],
    },
  ];

  const courierNames = ['Kabelo', 'Tumi', 'Ofentse', 'Naledi', 'Thato'];
  // Fixed ratings and earnings: randomizing these on every reseed made the
  // demo data look synthetic (every courier 4.5+, different each restart).
  const courierRatings = [4.9, 4.6, 4.8, 4.3, 4.7];
  const courierEarnings = [86, 42, 110, 23, 67];
  const couriers: CourierRecord[] = courierNames.map((name, i) => {
    const wp = WAYPOINTS[i % WAYPOINTS.length];
    return {
      id: `c${i + 1}`,
      name,
      status: 'online',
      lat: wp.lat,
      lng: wp.lng,
      rating: courierRatings[i],
      earnings_today_bwp: courierEarnings[i],
      waypoint_target: (i + 1) % WAYPOINTS.length,
      move_target: null,
    };
  });

  function makeUser(name: string, role: 'customer' | 'courier' | 'ops', phone: string, courierId?: string): UserRecord {
    return {
      id: crypto.randomUUID(),
      name,
      role,
      phone_hash: blindIndex(phone),
      phone_enc: encrypt(phone),
      pin_hash: hashSync('1234', { algorithm: Algorithm.Argon2id }),
      courier_id: courierId,
    };
  }

  const users: UserRecord[] = [
    makeUser('Neo', 'customer', '71111111'),
    makeUser('Kabelo', 'courier', '72222222', 'c1'),
    makeUser('Amo', 'ops', '73333333'),
  ];

  return {
    users,
    merchants,
    couriers,
    orders: [],
    ledger_entries: [],
    events_outbox: [],
    idempotency: [],
    last_dispatch: null,
  };
}
