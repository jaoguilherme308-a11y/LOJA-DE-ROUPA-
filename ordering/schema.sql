PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS configuration (id TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orders (
 id TEXT PRIMARY KEY, reference TEXT NOT NULL, token_hash TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, status TEXT NOT NULL,
 customer_name TEXT NOT NULL, customer_phone TEXT NOT NULL, fulfillment TEXT NOT NULL,
 address_json TEXT, payment_json TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
 items_json TEXT NOT NULL, subtotal_cents INTEGER NOT NULL, delivery_cents INTEGER,
 total_cents INTEGER, idempotency_key TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_created ON orders(created_at DESC);
CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS request_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS payments (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), provider_id TEXT NOT NULL UNIQUE,
 state TEXT NOT NULL, method TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS payments_order ON payments(order_id);
