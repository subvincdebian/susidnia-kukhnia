import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { Worker as NodeWorker } from "node:worker_threads";
import { createBrowserApi, BrowserApiError } from "../apps/web/src/shared/api/browser/core.ts";
import { initializeDatabase, isInitialized, parseSeed, schemaVersion } from "../apps/web/src/shared/api/browser/initialize.ts";
import { checkoutInput } from "../apps/web/src/shared/api/browser/validation.ts";
import { openDatabaseWorker } from "../apps/web/src/shared/api/browser/worker-startup.ts";
import { parseKyivTimestamp } from "../apps/web/src/shared/api/browser/timestamps.ts";

const requireWeb = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { PGlite } = await import(pathToFileURL(requireWeb.resolve("@electric-sql/pglite")).href);
const schema = await readFile(new URL("../apps/web/public/demo/schema.sql", import.meta.url), "utf8");
const seed = parseSeed(JSON.parse(await readFile(new URL("../apps/web/public/demo/seed.json", import.meta.url), "utf8")));

// Exercise the shipped browser worker and installed PGliteWorker transport in
// worker_threads. Only browser events and same-origin asset fetches are adapted.
const workerHarness = `
  const { parentPort, workerData } = require('node:worker_threads');
  globalThis.location = { origin: 'https://browser.test' };
  globalThis.postMessage = data => parentPort.postMessage(data);
  globalThis.addEventListener = (type, listener, options) => {
    if (type !== 'message') return;
    const receive = data => listener({ data });
    options?.once ? parentPort.once('message', receive) : parentPort.on('message', receive);
  };
  globalThis.fetch = async input => {
    if (workerData.mode === 'hang') return new Promise(() => {});
    if (workerData.mode === 'seed-failure') return new Response('Unavailable', { status: 503 });
    const url = new URL(input);
    if (url.origin !== globalThis.location.origin) throw new Error('Unexpected external request');
    return new Response(url.pathname.endsWith('schema.sql') ? workerData.schema : JSON.stringify(workerData.seed));
  };
  if (workerData.mode === 'storage-failure')
    globalThis.indexedDB = { open() { throw new Error('Storage denied'); } };
  if (workerData.mode === 'worker-failure') throw new Error('Worker startup failed');
  import(workerData.module).catch(() => parentPort.postMessage({ type: 'susidnia-browser-startup', state: 'failed' }));
`;
class BrowserWorker extends EventTarget {
  terminated = false;
  messages = [];
  stderr = "";
  constructor(mode = "ready") {
    super();
    this.thread = new NodeWorker(workerHarness, {
      eval: true, execArgv: [], stderr: true,
      workerData: { mode, schema, seed, module: new URL("../apps/web/src/shared/api/browser/database.worker.ts", import.meta.url).href },
    });
    this.exited = new Promise((resolve) => this.thread.once("exit", resolve));
    this.thread.stderr.on("data", (chunk) => { this.stderr = (this.stderr + String(chunk)).slice(-12000); });
    this.thread.on("message", (data) => {
      this.messages.push(data);
      this.dispatchEvent(new MessageEvent("message", { data }));
    });
    this.thread.on("error", () => this.dispatchEvent(new Event("error")));
    this.thread.on("messageerror", () => this.dispatchEvent(new Event("messageerror")));
  }
  postMessage(data) { this.thread.postMessage(data); }
  terminate() { this.terminated = true; void this.thread.terminate(); }
}
function workerOptions(id, dataDir) {
  return { id, ...(dataDir ? { dataDir } : {}), meta: { schemaUrl: "https://browser.test/demo/schema.sql", seedUrl: "https://browser.test/demo/seed.json" } };
}
let db, api, dish, sequence = 0;
before(async () => {
  db = await PGlite.create();
  await initializeDatabase(db, schema, seed);
  api = createBrowserApi(db);
  await api.request("/auth/login", "POST", { email: "admin@demo.test", password: "AdminDemo2026!" });
  dish = (await db.query(`SELECT m.id,m.restaurant_id,m.price FROM menu_items m JOIN restaurants r ON r.id=m.restaurant_id
    WHERE m.is_available AND r.is_active ORDER BY m.id LIMIT 1`)).rows[0];
});
after(async () => { await db?.close(); });
function checkout(overrides = {}) {
  sequence++;
  return {
    request_key: sequence.toString(16).padStart(64, "0"), full_name: "Гість браузера", phone: `+38000091${String(sequence).padStart(4, "0")}`,
    restaurant_id: dish.restaurant_id, delivery_address: "Київ, Хрещатик, 1", delivery_note: "Біля входу",
    delivery_latitude: 50.45, delivery_longitude: 30.52,
    payment_method: "готівка", expected_total: dish.price, items: [{ menu_item_id: dish.id, quantity: 1 }], ...overrides,
  };
}
const request = (path, method = "GET", body) => api.request(path, method, body);
const errorStatus = (status) => (error) => error instanceof BrowserApiError && error.status === status;
async function createOrder(overrides) { return request("/orders/checkout", "POST", checkout(overrides)); }
async function newCourier() {
  sequence++;
  return request("/couriers", "POST", { full_name: "Кур'єр браузера", phone: `+38000092${String(sequence).padStart(4, "0")}`, vehicle_type: "велосипед" });
}
async function status(id, expected_status, nextStatus, extra = {}) {
  return request(`/orders/${id}/status`, "PATCH", { expected_status, status: nextStatus, ...extra });
}

test("browser initialization commits seed once and retains edits", async () => {
  assert.equal(await isInitialized(db), true);
  const initial = await request("/bootstrap");
  assert.equal(Number(initial.counts.restaurants), 10);
  assert.equal(Number(initial.counts.orders), 30);
  const customer = await request("/customers", "POST", { full_name: "Збережений клієнт", email: "browser-persist@example.test", phone: "+380000999881", default_delivery_address: "Київ, Поділ, 1" });
  await initializeDatabase(db, schema, seed);
  assert.equal((await db.query("SELECT full_name FROM customers WHERE id=$1", [customer.id])).rows[0].full_name, "Збережений клієнт");
  assert.equal(Number((await request("/bootstrap")).counts.orders), 30);
});

test("a failed first initialization rolls back schema, seed and marker", async () => {
  const empty = await PGlite.create();
  try {
    await assert.rejects(initializeDatabase(empty, "CREATE TABLE atomic_seed(id integer PRIMARY KEY)", {
      schemaVersion,
      statements: [{ sql: "INSERT INTO atomic_seed VALUES($1)", params: [1] }, { sql: "SELECT missing_column FROM atomic_seed", params: [] }],
    }));
    assert.equal(await isInitialized(empty), false);
    assert.equal((await empty.query("SELECT to_regclass('atomic_seed') AS table_name")).rows[0].table_name, null);
    await initializeDatabase(empty, "CREATE TABLE atomic_seed(id integer PRIMARY KEY)", { schemaVersion, statements: [{ sql: "INSERT INTO atomic_seed VALUES($1)", params: [2] }] });
    assert.equal((await empty.query("SELECT id FROM atomic_seed")).rows[0].id, 2);
  } finally { await empty.close(); }
});

test("checkout retries, canonical hashes, recipient snapshots and failed writes are safe", async () => {
  const input = checkout({ payment_method: "картка" });
  const [first, retry] = await Promise.all([request("/orders/checkout", "POST", input), request("/orders/checkout", "POST", input)]);
  assert.deepEqual(first, retry);
  const order = await request(`/orders/${first.id}`);
  assert.equal(order.total_amount, dish.price);
  assert.equal(typeof order.total_amount, "string");
  assert.equal(order.payment.method, "картка");
  assert.equal(order.recipient_name, input.full_name);
  assert.equal(order.items[0].unit_price, dish.price);
  const { requestKey, ...canonical } = checkoutInput(input);
  const stored = (await db.query("SELECT request_hash FROM _checkout_requests WHERE request_key=$1", [requestKey])).rows[0];
  assert.equal(stored.request_hash, createHash("sha256").update(JSON.stringify({ ...canonical, customer_id: order.customer_id })).digest("hex"));
  await assert.rejects(request("/orders/checkout", "POST", { ...input, delivery_note: "Інше прохання" }), errorStatus(409));
  const second = await createOrder({ phone: input.phone, full_name: "Інший одержувач" });
  const secondOrder = await request(`/orders/${second.id}`);
  assert.equal(secondOrder.customer_id, order.customer_id);
  assert.equal(secondOrder.customer, (await request("/auth/session")).user.full_name);
  assert.equal(secondOrder.recipient_name, "Інший одержувач");
  const failed = checkout({ expected_total: "0.01" });
  await assert.rejects(request("/orders/checkout", "POST", failed), errorStatus(409));
  assert.equal((await db.query("SELECT id FROM customers WHERE phone=$1", [failed.phone])).rows.length, 0);
  assert.equal((await db.query("SELECT request_key FROM _checkout_requests WHERE request_key=$1", [failed.request_key])).rows.length, 0);
  await assert.rejects(createOrder({ items: [{ menu_item_id: dish.id, quantity: 1 }, { menu_item_id: dish.id, quantity: 1 }] }), errorStatus(400));
  const recent = await request(`/orders/recent?ids=${first.id},${second.id},${first.id}`);
  assert.equal(recent.length, 2);
  await assert.rejects(request("/orders/recent?ids=1,no"), errorStatus(400));
});

test("address versions reject stale edits; manual addresses clear previous coordinates", async () => {
  const { id } = await createOrder();
  const changed = await request(`/orders/${id}/address`, "PATCH", { expected_version: 0, delivery_address: "Київ, Контрактова площа, 1", delivery_latitude: 50.46, delivery_longitude: 30.51 });
  assert.equal(changed.address_version, 1);
  await assert.rejects(request(`/orders/${id}/address`, "PATCH", { expected_version: 0, delivery_address: "Застаріла адреса" }), errorStatus(409));
  await assert.rejects(request(`/orders/${id}/address`, "PATCH", { expected_version: 1, delivery_address: "Неповні координати", delivery_latitude: 50.46 }), errorStatus(400));
  const manual = await request(`/orders/${id}/address`, "PATCH", { expected_version: 1, delivery_address: "Київ, адреса вручну, 3" });
  assert.equal(manual.address_version, 2);
  assert.equal(manual.delivery_latitude, null);
  assert.equal(manual.delivery_longitude, null);
  await request(`/orders/${id}/note`, "PATCH", { delivery_note: "Новий орієнтир" });
  assert.equal((await request(`/orders/${id}`)).delivery_note, "Новий орієнтир");
});

test("courier exclusivity, payment completion, closed chat and history follow one lifecycle", async () => {
  const first = await createOrder(), second = await createOrder(), courier = await newCourier(), other = await newCourier();
  await assert.rejects(request(`/orders/${first.id}/payment`, "POST", { payment_method: "готівка" }), errorStatus(400));
  await status(first.id, "створено", "готується");
  await assert.rejects(status(first.id, "створено", "скасовано"), errorStatus(409));
  await status(first.id, "готується", "в дорозі", { courier_id: courier.id });
  await status(second.id, "створено", "готується");
  await assert.rejects(status(second.id, "готується", "в дорозі", { courier_id: courier.id }), errorStatus(409));
  assert.equal((await request(`/orders/${second.id}`)).delivery_status, "готується");
  assert.equal((await request(`/orders/${second.id}`)).courier_id, null);
  assert.equal((await request(`/couriers/${courier.id}/delivery`)).order_id, first.id);
  await assert.rejects(request(`/couriers/${courier.id}`, "DELETE"), errorStatus(409));
  await assert.rejects(request(`/orders/${first.id}/address`, "PATCH", { expected_version: 0, delivery_address: "Пізня адреса" }), errorStatus(409));
  const location = { courier_id: other.id, latitude: 50.4502, longitude: 30.5235, source: "manual" };
  await assert.rejects(request(`/orders/${first.id}/courier-location`, "POST", location), errorStatus(409));
  const updatedLocation = await request(`/orders/${first.id}/courier-location`, "POST", { ...location, courier_id: courier.id });
  assert.equal(updatedLocation.courier_location_source, "manual");
  const message = { sender: "courier", courier_id: courier.id, body: "Біля входу", request_key: "browser-message-001" };
  const sent = await request(`/orders/${first.id}/messages`, "POST", message);
  assert.deepEqual(await request(`/orders/${first.id}/messages`, "POST", message), sent);
  await assert.rejects(request(`/orders/${first.id}/messages`, "POST", { ...message, body: "Інший текст" }), errorStatus(409));
  await assert.rejects(request(`/orders/${first.id}/messages`, "POST", { ...message, courier_id: other.id }), errorStatus(409));
  await assert.rejects(status(first.id, "в дорозі", "доставлено"), errorStatus(409));
  assert.equal((await request(`/orders/${first.id}`)).delivery_status, "в дорозі");
  assert.equal((await request(`/orders/${first.id}`)).payment, null);
  const payment = await status(first.id, "в дорозі", "доставлено", { payment_method: "готівка" });
  assert.deepEqual(await status(first.id, "в дорозі", "доставлено"), payment);
  assert.equal((await request(`/couriers/${courier.id}/delivery`)).courier.is_available, true);
  assert.equal((await request(`/couriers/${courier.id}/delivery`)).order_id, null);
  assert.deepEqual(await request(`/orders/${first.id}/messages`, "POST", message), sent);
  await assert.rejects(request(`/orders/${first.id}/messages`, "POST", { sender: "customer", body: "Нове повідомлення", request_key: "browser-message-002" }), errorStatus(409));
  await assert.rejects(request(`/orders/${first.id}/note`, "PATCH", { delivery_note: "Пізня примітка" }), errorStatus(409));
  await assert.rejects(request(`/orders/${first.id}/courier-location`, "POST", { ...location, courier_id: courier.id }), errorStatus(409));
  const history = await request(`/orders/${first.id}/messages`);
  assert.equal(history.items.length, 1);
  assert.equal(history.items[0].body, message.body);
  assert.equal(history.has_more, false);
  assert.deepEqual(await request(`/couriers/${courier.id}`, "DELETE"), { id: courier.id, archived: true });
  assert.equal((await request(`/couriers/${courier.id}/restore`, "PATCH", {})).is_active, true);
  assert.deepEqual(await request(`/couriers/${other.id}`, "DELETE"), { id: other.id, archived: false });
});

test("card payment retries once and cancellation refunds without deleting history", async () => {
  const { id } = await createOrder();
  const first = await request(`/orders/${id}/payment`, "POST", { payment_method: "картка" });
  assert.deepEqual(await request(`/orders/${id}/payment`, "POST", { payment_method: "картка" }), first);
  await status(id, "створено", "скасовано");
  const order = await request(`/orders/${id}`);
  assert.equal(order.payment.id, first.payment_id);
  assert.equal(order.payment.amount, dish.price);
  assert.equal(typeof order.payment.refunded_at, "string");
  await assert.rejects(request(`/orders/${id}/payment`, "POST", { payment_method: "картка" }), errorStatus(409));
  const prepaid = await createOrder({ payment_method: "картка" }), courier = await newCourier();
  const originalPayment = (await request(`/orders/${prepaid.id}`)).payment;
  await status(prepaid.id, "створено", "готується");
  await status(prepaid.id, "готується", "в дорозі", { courier_id: courier.id });
  assert.deepEqual(await status(prepaid.id, "в дорозі", "доставлено"), { payment_id: originalPayment.id });
  assert.equal((await request(`/orders/${prepaid.id}`)).payment.method, "картка");
});

test("chat history returns the latest hundred messages in chronological order", async () => {
  const { id } = await createOrder(), courier = await newCourier();
  await status(id, "створено", "готується");
  await status(id, "готується", "в дорозі", { courier_id: courier.id });
  for (let index = 0; index < 101; index++)
    await request(`/orders/${id}/messages`, "POST", { sender: "customer", body: `Повідомлення ${index}`, request_key: `history-${String(index).padStart(3, "0")}` });
  const history = await request(`/orders/${id}/messages`);
  assert.equal(history.items.length, 100);
  assert.equal(history.has_more, true);
  assert.equal(history.items[0].body, "Повідомлення 1");
  assert.equal(history.items.at(-1).body, "Повідомлення 100");
  await status(id, "в дорозі", "скасовано");
  assert.equal((await request(`/couriers/${courier.id}/delivery`)).courier.is_available, true);
  assert.deepEqual(await request(`/orders/${id}/messages`), history);
});

test("catalog CRUD clears stale provenance; reviews and analytics reflect committed data", async () => {
  const map = await request("/restaurants/map");
  assert.equal(map.total, 10);
  assert.equal(map.truncated, false);
  assert.equal(typeof map.items[0].latitude, "number");
  const restaurant = await request(`/restaurants/${dish.restaurant_id}`);
  assert.ok(restaurant.menu.length > 0);
  assert.equal(typeof restaurant.menu[0].price, "string");
  const createdRestaurant = await request("/restaurants", "POST", { name: "Новий заклад", address: "Київ, Нова, 1", phone: "+380000777001", cuisine_type: "Українська", is_active: true });
  const createdDish = await request("/menu", "POST", { restaurant_id: createdRestaurant.id, name: "Тестова страва", description: "Опис", price: "123.45", category: "Основне", is_available: true });
  await db.query("UPDATE menu_items SET source_url='https://example.test/menu',image_url='/media/test.webp',image_alt='Фото',portion='100 г' WHERE id=$1", [createdDish.id]);
  const renamed = await request(`/menu/${createdDish.id}`, "PATCH", { name: "Інша назва", description: "Опис", price: "123.45", category: "Основне", is_available: true });
  assert.equal(renamed.source_url, null);
  assert.equal(renamed.image_url, null);
  assert.equal(renamed.portion, null);
  await assert.rejects(request(`/menu/${createdDish.id}`, "PATCH", { name: "Страва", description: "", price: "2.001", category: "Основне", is_available: true }), errorStatus(400));
  const inactive = await request(`/restaurants/${createdRestaurant.id}`, "PATCH", { name: "Новий заклад", address: "Київ, Нова, 1", phone: "+380000777001", cuisine_type: "Українська", is_active: false });
  assert.equal(inactive.is_active, false);
  await assert.rejects(createOrder({ restaurant_id: createdRestaurant.id, expected_total: "123.45", items: [{ menu_item_id: createdDish.id, quantity: 1 }] }), errorStatus(409));
  const option = (await request("/review-options"))[0];
  assert.ok(option);
  const review = await request("/reviews", "POST", { order_id: option.id, rating: 5, comment: "Смачно та швидко" });
  await assert.rejects(request("/reviews", "POST", { order_id: option.id, rating: 4, comment: "Повторний відгук" }), errorStatus(409));
  assert.equal((await request(`/reviews/${review.id}`, "PATCH", { rating: 4, comment: "Оновлений відгук" })).rating, 4);
  const analytics = await request("/analytics?from=2000-01-01&to=2099-12-31");
  assert.ok(Number(analytics.summary.orders_count) > 30);
  assert.equal(typeof analytics.summary.orders_amount, "string");
  assert.ok(analytics.dishes.length);
  assert.ok(analytics.ratings.length);
  await request(`/reviews/${review.id}`, "DELETE");
  assert.ok((await request("/review-options")).some((item) => item.id === option.id));
  assert.equal((await request("/customers?q=Збережений")).items[0].email, "browser-persist@example.test");
  await assert.rejects(request("/analytics?from=2026-11-31"), errorStatus(400));
  assert.equal((await request("/restaurants?q=%27%3BDROP%20TABLE%20orders%3B--")).total, 0);
  await assert.rejects(request("/missing"), errorStatus(404));
  assert.ok(Number((await request("/bootstrap")).counts.orders) > 30);
});

test("worker startup errors and stalled initialization reject, clean up and allow retry", async () => {
  const id = `browser-startup-test-${process.pid}-${Date.now()}`;
  for (const mode of ["storage-failure", "seed-failure", "worker-failure", "hang"]) {
    const worker = new BrowserWorker(mode);
    const options = workerOptions(id, mode === "storage-failure" ? `idb://${id}` : undefined);
    await assert.rejects(openDatabaseWorker(worker, options, mode === "hang" ? 10000 : 15000), errorStatus(503));
    assert.equal(worker.terminated, true);
    await worker.exited;
    if (mode !== "worker-failure" && mode !== "hang")
      assert.ok(worker.messages.some((message) => message.type === "susidnia-browser-startup" && message.state === "failed"));
    if (mode === "hang") assert.ok(worker.messages.some((message) => message.type === "ready"));
  }
  const worker = new BrowserWorker();
  const client = await openDatabaseWorker(worker, workerOptions(id), 15000);
  try {
    assert.equal((await createBrowserApi(client).request("/bootstrap")).restaurants.length, 10);
  } finally { await client.close(); await worker.exited; }
});

test("real worker RPC retains constraint status, serves late followers and decodes Kyiv timestamps for a UTC visitor", async () => {
  const originalZone = process.env.TZ;
  process.env.TZ = "UTC";
  const id = `browser-rpc-test-${process.pid}-${Date.now()}`, worker = new BrowserWorker();
  let client, follower, followerWorker;
  try {
    client = await openDatabaseWorker(worker, workerOptions(id), 15000);
    assert.equal(client.isLeader, true);
    const workerApi = createBrowserApi(client);
    await workerApi.request("/auth/login", "POST", { email: "admin@demo.test", password: "AdminDemo2026!" });
    const customer = { full_name: "Гість worker", email: "worker@example.test", phone: "+380000999891", default_delivery_address: "Київ, Поділ, 1" };
    await workerApi.request("/customers", "POST", customer);
    await assert.rejects(workerApi.request("/customers", "POST", customer), errorStatus(409));
    await assert.rejects(workerApi.request("/menu", "POST", { restaurant_id: 2147483647, name: "Страва", description: "", price: "10.00", category: "Основне", is_available: true }), errorStatus(409));
    const active = (await client.query("SELECT id FROM orders WHERE delivery_status<>'доставлено' LIMIT 1")).rows[0];
    await assert.rejects(workerApi.request("/reviews", "POST", { order_id: active.id, rating: 5, comment: "Передчасний відгук" }), errorStatus(409));
    await assert.rejects(workerApi.request("/orders/2147483647/payment", "POST", { payment_method: "картка" }), errorStatus(404));
    assert.ok(!worker.stderr.includes(customer.email));
    assert.ok(!worker.stderr.includes(customer.phone));
    const times = (await client.query(`SELECT LOCALTIMESTAMP AS local_time,CURRENT_TIMESTAMP AS actual_time,
      '2026-07-15 12:30'::timestamp AS summer,'2026-11-03 12:30'::timestamp AS winter,
      '2026-03-29 03:30'::timestamp AS spring_gap,'2026-10-25 03:30'::timestamp AS autumn_overlap`)).rows[0];
    assert.ok(Math.abs(times.local_time.getTime() - times.actual_time.getTime()) < 2);
    assert.equal(times.summer.toISOString(), "2026-07-15T09:30:00.000Z");
    assert.equal(times.winter.toISOString(), "2026-11-03T10:30:00.000Z");
    assert.equal(times.spring_gap.toISOString(), "2026-03-29T01:30:00.000Z");
    assert.equal(times.autumn_overlap.toISOString(), "2026-10-25T01:30:00.000Z");
    assert.equal(parseKyivTimestamp("2026-11-03 12:30:00.123456").toISOString(), "2026-11-03T10:30:00.123Z");
    followerWorker = new BrowserWorker();
    follower = await openDatabaseWorker(followerWorker, workerOptions(id), 15000);
    assert.equal(follower.isLeader, false);
    const followerApi = createBrowserApi(follower);
    await followerApi.request("/auth/login", "POST", { email: "admin@demo.test", password: "AdminDemo2026!" });
    const shared = await followerApi.request("/customers?q=worker%40example.test");
    assert.equal(shared.items[0].email, customer.email);
  } finally {
    if (follower) await follower.close();
    else followerWorker?.terminate();
    if (followerWorker) await followerWorker.exited;
    if (client) await client.close();
    else worker.terminate();
    await worker.exited;
    if (originalZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalZone;
  }
});
