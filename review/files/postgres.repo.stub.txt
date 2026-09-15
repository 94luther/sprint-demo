// This file is a stub on purpose. The alpha runs on a JSON file
// (data/store.json, see ../store.service.ts) so the whole demo starts with
// zero native dependencies and runs on any machine that has Node. Nothing
// here is wired up or imported by the app.
//
// When Sprint moves past alpha, each *.repo.ts in this folder gets a
// Postgres implementation of the same repo-interfaces.ts contract
// (IOrdersRepo, ICouriersRepo, ILedgerRepo, IOutboxRepo, ...), and the
// modules swap StoreService based repos for these without touching
// controllers or services.
//
// Production DDL note, per the Sprint blueprint:
//
// create table merchants (
//   id            uuid primary key default gen_random_uuid(),
//   name          text not null,
//   type          text not null check (type in ('food','grocery','vape')),
//   age_restricted boolean not null default false,
//   lat           double precision not null,
//   lng           double precision not null,
//   created_at    timestamptz not null default now()
// );
//
// create table merchant_items (
//   id            uuid primary key default gen_random_uuid(),
//   merchant_id   uuid not null references merchants(id),
//   name          text not null,
//   price_bwp     numeric(10,2) not null
// );
//
// create table orders (
//   id              uuid primary key default gen_random_uuid(),
//   customer_id     uuid not null references users(id),
//   merchant_id     uuid not null references merchants(id),
//   total_bwp       numeric(10,2) not null,
//   payment_method  text not null,
//   address_enc     text not null, -- AES-256-GCM ciphertext, iv:tag:ciphertext
//   delivery_lat    double precision not null,
//   delivery_lng    double precision not null,
//   age_confirmed   boolean not null default false,
//   status          text not null,
//   courier_id      uuid references couriers(id),
//   eta_min         integer,
//   idempotency_key text not null,
//   created_at      timestamptz not null default now(),
//   unique (customer_id, idempotency_key)
// );
//
// create table order_items (
//   id          uuid primary key default gen_random_uuid(),
//   order_id    uuid not null references orders(id),
//   item_id     text not null,
//   name        text not null,
//   qty         integer not null,
//   price_bwp   numeric(10,2) not null
// );
//
// create table couriers (
//   id                  uuid primary key default gen_random_uuid(),
//   name                text not null,
//   status              text not null default 'offline',
//   rating              numeric(2,1) not null default 5.0,
//   earnings_today_bwp  numeric(10,2) not null default 0,
//   created_at          timestamptz not null default now()
// );
//
// create table courier_locations (
//   courier_id  uuid not null references couriers(id),
//   lat         double precision not null,
//   lng         double precision not null,
//   h3_cell     text not null,
//   recorded_at timestamptz not null default now(),
//   primary key (courier_id, recorded_at)
// );
//
// create table payments (
//   id              uuid primary key default gen_random_uuid(),
//   order_id        uuid not null references orders(id),
//   method          text not null,
//   status          text not null,
//   created_at      timestamptz not null default now()
// );
//
// create table ledger_entries (
//   id          uuid primary key default gen_random_uuid(),
//   order_id    uuid not null references orders(id),
//   account     text not null,
//   type        text not null check (type in ('debit','credit')),
//   amount_bwp  numeric(10,2) not null,
//   created_at  timestamptz not null default now()
// );
//
// create table events_outbox (
//   id          uuid primary key default gen_random_uuid(),
//   event       text not null,
//   order_id    uuid not null references orders(id),
//   payload     jsonb not null,
//   created_at  timestamptz not null default now(),
//   published_at timestamptz
// );
//
// Note: pins are argon2id since 13 Sep 2026, and phone /
// address encryption keys move from a .env value to a managed secret store
// (KMS backed), rotated on a schedule.

export {};
