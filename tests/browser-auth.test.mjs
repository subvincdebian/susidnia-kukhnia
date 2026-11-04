import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createBrowserApi, BrowserApiError } from "../apps/web/src/shared/api/browser/core.ts";
import { memoryTokenStore } from "../apps/web/src/shared/api/browser/auth.ts";
import { checkoutKey } from "../apps/web/src/entities/cart/model.ts";
import { initializeDatabase, parseSeed, isInitialized } from "../apps/web/src/shared/api/browser/initialize.ts";

const requireWeb = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { PGlite } = await import(pathToFileURL(requireWeb.resolve("@electric-sql/pglite")).href);
const schema = await readFile(new URL("../apps/web/public/demo/schema.sql", import.meta.url), "utf8");
const seed = parseSeed(JSON.parse(await readFile(new URL("../apps/web/public/demo/seed.json", import.meta.url), "utf8")));
const denied = status => error => error instanceof BrowserApiError && error.status === status;
let db, admin, dish;
before(async () => {
  db = await PGlite.create();
  await initializeDatabase(db, schema, seed);
  admin = createBrowserApi(db);
  await admin.request("/auth/login", "POST", { email: "admin@demo.test", password: "AdminDemo2026!" });
  dish = (await db.query("SELECT m.id,m.restaurant_id,m.price FROM menu_items m JOIN restaurants r ON r.id=m.restaurant_id WHERE m.is_available AND r.is_active ORDER BY m.id LIMIT 1")).rows[0];
});
after(async () => { await db?.close(); });
const registration = (suffix, extra = {}) => ({ email: `browser-${suffix}@example.test`, password: "UserDemo2026!", full_name: `Гість ${suffix}`, phone: `+38000088${suffix}`, ...extra });
const checkout = (key, extra = {}) => ({ request_key: key.repeat(64), full_name: "Одержувач", phone: "+380000776655", restaurant_id: dish.restaurant_id,
  delivery_address: "Київ, Хрещатик, 1", payment_method: "картка", expected_total: dish.price, items: [{ menu_item_id: dish.id, quantity: 1 }], ...extra });

test("browser auth protects routes and bootstrap; registration cannot claim a role or old contact", async () => {
  const guest = createBrowserApi(db);
  assert.deepEqual(await guest.request("/auth/session"), { user: null });
  assert.equal((await guest.request("/restaurants")).total, 10);
  const bootstrap = await guest.request("/bootstrap");
  assert.deepEqual(bootstrap.customers, []); assert.deepEqual(bootstrap.couriers, []); assert.deepEqual(bootstrap.counts, {});
  for (const path of ["/orders", "/customers", "/couriers", "/analytics", "/orders/1", "/reviews"])
    await assert.rejects(guest.request(path), denied(401));
  await assert.rejects(guest.request("/auth/login", "POST", { email: "admin@demo.test", password: "wrong" }), denied(401));
  const old = (await db.query("SELECT id,email,phone FROM customers WHERE email IS NOT NULL ORDER BY id LIMIT 1")).rows[0];
  await assert.rejects(guest.request("/auth/register", "POST", registration("001", { email: old.email, phone: old.phone })), denied(409));
  assert.equal((await db.query("SELECT count(*)::integer AS total FROM app_users WHERE customer_id=$1", [old.id])).rows[0].total, 0);
  const created = await guest.request("/auth/register", "POST", registration("001", { role: "admin", customer_id: old.id }));
  assert.equal(created.user.role, "user"); assert.notEqual(created.user.customer_id, old.id);
  await assert.rejects(guest.request("/customers"), denied(403));
  await assert.rejects(guest.request("/orders", "POST", { customer_id: old.id }), denied(403));
  const hashes = (await db.query("SELECT password_hash FROM app_users WHERE id=$1", [created.user.id])).rows[0];
  assert.ok(hashes.password_hash.startsWith("pbkdf2-sha256$600000$")); assert.ok(!hashes.password_hash.includes("UserDemo2026!"));
});

test("browser auth scopes history, checkout retries, address, payment, messages and reviews to the owner", async () => {
  const first = createBrowserApi(db), second = createBrowserApi(db);
  const a = (await first.request("/auth/register", "POST", registration("002"))).user;
  const b = (await second.request("/auth/register", "POST", registration("003"))).user;
  const oldContact = (await db.query("SELECT id,phone FROM customers ORDER BY id LIMIT 1")).rows[0];
  const payload = checkout("a", { phone: oldContact.phone, customer_id: oldContact.id });
  const { request_key: _unusedKey, ...formBody } = payload;
  payload.request_key = await checkoutKey("shared-cart", formBody, a.id);
  const order = await first.request("/orders/checkout", "POST", payload);
  const saved = await first.request(`/orders/${order.id}`);
  assert.equal(saved.customer_id, a.customer_id); assert.notEqual(saved.customer_id, oldContact.id);
  assert.deepEqual(await first.request("/orders/checkout", "POST", payload), order);
  await assert.rejects(second.request("/orders/checkout", "POST", payload), denied(404));
  const bPayload = { ...payload, request_key: await checkoutKey("shared-cart", formBody, b.id) };
  assert.notEqual(bPayload.request_key, payload.request_key);
  const bOrder = await second.request("/orders/checkout", "POST", bPayload);
  assert.notEqual(bOrder.id, order.id);
  assert.equal((await first.request("/orders/recent")).length, 1);
  assert.deepEqual(await second.request(`/orders/recent?ids=${order.id}`), []);
  for (const [path, method, body] of [
    [`/orders/${order.id}`, "GET"], [`/orders/${order.id}/messages`, "GET"],
    [`/orders/${order.id}/payment`, "POST", { payment_method: "картка" }],
    [`/orders/${order.id}/address`, "PATCH", { expected_version: 0, delivery_address: "Чужа адреса" }],
    ["/reviews", "POST", { order_id: order.id, rating: 5, comment: "Чужий відгук" }],
  ]) await assert.rejects(second.request(path, method, body), denied(404));
  await assert.rejects(first.request(`/orders/${order.id}/status`, "PATCH", { expected_status: "створено", status: "готується" }), denied(403));
  await assert.rejects(first.request(`/orders/${order.id}/messages`, "POST", { sender: "courier", body: "Підміна", request_key: "spoof-message-01" }), denied(403));
  const courier = await admin.request("/couriers", "POST", { full_name: "Кур’єр перевірки", phone: "+380000998812", vehicle_type: "велосипед" });
  await admin.request(`/orders/${order.id}/status`, "PATCH", { expected_status: "створено", status: "готується" });
  await admin.request(`/orders/${order.id}/status`, "PATCH", { expected_status: "готується", status: "в дорозі", courier_id: courier.id });
  const message = { sender: "customer", body: "Біля входу", request_key: "owner-message-01" };
  await first.request(`/orders/${order.id}/messages`, "POST", message);
  await assert.rejects(second.request(`/orders/${order.id}/messages`, "POST", message), denied(404));
  await admin.request(`/orders/${order.id}/status`, "PATCH", { expected_status: "в дорозі", status: "доставлено" });
  const review = await first.request("/reviews", "POST", { order_id: order.id, rating: 5, comment: "Смачно" });
  assert.equal((await first.request("/reviews")).items[0].id, review.id);
  assert.deepEqual((await second.request("/reviews")).items, []);
  await assert.rejects(second.request(`/reviews/${review.id}`, "PATCH", { rating: 1, comment: "Чужий" }), denied(404));
  await assert.rejects(second.request(`/reviews/${review.id}`, "DELETE"), denied(404));
});

test("browser session rotation, expiry and logout revoke replayed tokens", async () => {
  const store = memoryTokenStore(), api = createBrowserApi(db, store);
  await api.request("/auth/login", "POST", { email: "user@demo.test", password: "UserDemo2026!" });
  const old = store.get();
  assert.ok(old);
  const hashes = (await db.query("SELECT token_hash FROM auth_sessions")).rows;
  assert.ok(hashes.every(row => /^[a-f0-9]{64}$/.test(row.token_hash) && row.token_hash !== old));
  await api.request("/auth/login", "POST", { email: "user@demo.test", password: "UserDemo2026!" });
  const fresh = store.get(); assert.notEqual(fresh, old);
  const replayStore = memoryTokenStore(); replayStore.set(old);
  assert.deepEqual(await createBrowserApi(db, replayStore).request("/auth/session"), { user: null });
  await api.request("/auth/logout", "POST", {});
  store.set(fresh);
  assert.deepEqual(await api.request("/auth/session"), { user: null });
  await api.request("/auth/login", "POST", { email: "user@demo.test", password: "UserDemo2026!" });
  const user = (await api.request("/auth/session")).user;
  await db.query("UPDATE auth_sessions SET created_at=CURRENT_TIMESTAMP-INTERVAL '9 hours',expires_at=CURRENT_TIMESTAMP-INTERVAL '1 hour' WHERE user_id=$1", [user.id]);
  assert.deepEqual(await api.request("/auth/session"), { user: null });
  await assert.rejects(api.request("/orders/recent"), denied(401));
});

test("browser v1 upgrade is atomic, retains visitor rows and uses new IDs for demo accounts", async () => {
  const legacy = await PGlite.create();
  try {
    const boundary = schema.indexOf("CREATE TABLE app_users (");
    const seedBoundary = seed.statements.findIndex(statement => statement.sql.includes("718202627"));
    assert.ok(boundary > 0 && seedBoundary > 0 && seed.upgrade);
    await legacy.exec(schema.slice(0, boundary));
    for (const statement of seed.statements.slice(0, seedBoundary)) await legacy.query(statement.sql, statement.params);
    await legacy.exec("CREATE TABLE _browser_demo_metadata(id integer PRIMARY KEY,schema_version integer NOT NULL); INSERT INTO _browser_demo_metadata VALUES(1,1)");
    await legacy.query("INSERT INTO customers(id,full_name,email,phone,default_delivery_address) VALUES(90000,'Відвідувач до оновлення','old-visitor@example.test','+380000987612','Збережена адреса')");
    await legacy.query("INSERT INTO customers(id,full_name,email,phone,default_delivery_address) VALUES(89998,'Контакт зі старої версії','admin@demo.test','+380000000901','Стара адреса'),(89999,'Другий старий контакт','user@demo.test','+380000000902','Інша стара адреса')");
    await legacy.query("SELECT setval('customers_id_seq',90000)");
    const before = (await legacy.query("SELECT md5(string_agg(row_to_json(o)::text,'|' ORDER BY id)) AS hash FROM orders o")).rows[0].hash;
    const bad = { ...seed, upgrade: { ...seed.upgrade, statements: [...seed.upgrade.statements, { sql: "SELECT missing_upgrade_column", params: [] }] } };
    await assert.rejects(initializeDatabase(legacy, schema, bad));
    assert.equal((await legacy.query("SELECT schema_version FROM _browser_demo_metadata")).rows[0].schema_version, 1);
    assert.equal((await legacy.query("SELECT to_regclass('app_users') AS name")).rows[0].name, null);
    await Promise.all([initializeDatabase(legacy, schema, seed), initializeDatabase(legacy, schema, seed)]);
    assert.equal(await isInitialized(legacy), true);
    assert.equal((await legacy.query("SELECT md5(string_agg(row_to_json(o)::text,'|' ORDER BY id)) AS hash FROM orders o")).rows[0].hash, before);
    assert.equal((await legacy.query("SELECT full_name FROM customers WHERE id=90000")).rows[0].full_name, "Відвідувач до оновлення");
    assert.equal((await legacy.query("SELECT full_name FROM customers WHERE id=89998")).rows[0].full_name, "Контакт зі старої версії");
    const demo = (await legacy.query("SELECT u.customer_id,c.full_name FROM app_users u JOIN customers c ON c.id=u.customer_id ORDER BY u.email")).rows;
    assert.equal(demo.length, 2); assert.ok(demo.every(row => row.customer_id > 90000 && row.full_name.startsWith("Демо")));
    const api = createBrowserApi(legacy);
    assert.equal((await api.request("/auth/login", "POST", { email: "admin@demo.test", password: "AdminDemo2026!" })).user.role, "admin");
  } finally { await legacy.close(); }
});
