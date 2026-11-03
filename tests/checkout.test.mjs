import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import pg from "pg";
import { forDatabase } from "../scripts/runtime.mjs";
import { localDatabase } from "../scripts/database.mjs";
import { migrate, connectionString } from "../scripts/migrations.mjs";
import { createApplication } from "../apps/backend/dist/application.js";
import { OrdersService } from "../apps/backend/dist/orders/orders.service.js";

let runtime,
  admin,
  pool,
  app,
  orders,
  base,
  cookie,
  dish,
  sequence = 0;
const database = `delivery_test_${process.pid}_${Date.now()}`;
before(async () => {
  runtime = await localDatabase({ test: true });
  admin = new pg.Client(forDatabase(runtime.config, "postgres"));
  await admin.connect();
  await admin.query(`CREATE DATABASE ${database}`);
  const config = forDatabase(runtime.config, database);
  await migrate(config);
  pool = new pg.Pool({ ...config, max: 8 });
  dish = (
    await pool.query(
      "SELECT m.id,m.restaurant_id,m.price::text FROM menu_items m JOIN restaurants r ON r.id=m.restaurant_id WHERE m.is_available AND r.is_active ORDER BY m.id LIMIT 1",
    )
  ).rows[0];
  app = await createApplication({ connectionString: connectionString(config) });
  await app.listen(0, "127.0.0.1");
  orders = app.get(OrdersService);
  base = await app.getUrl();
  cookie = (await fetch(base + "/api/session")).headers
    .get("set-cookie")
    .split(";")[0];
});
after(async () => {
  if (app) await app.close();
  if (pool) await pool.end();
  if (admin) {
    if (/^delivery_test_\d+_\d+$/.test(database))
      await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    await admin.end();
  }
  runtime?.stop();
});
const draft = (extra = {}) => {
  sequence++;
  return {
    request_key: createHash("sha256")
      .update("checkout-test-" + sequence)
      .digest("hex"),
    full_name: "Тестовий одержувач",
    phone: "+380000" + String(sequence).padStart(6, "0"),
    restaurant_id: dish.restaurant_id,
    delivery_address: "Демонстраційна адреса, 1",
    delivery_note: "",
    payment_method: "картка",
    expected_total: (Number(dish.price) * 2).toFixed(2),
    items: [{ menu_item_id: dish.id, quantity: 2 }],
    ...extra,
  };
};
const counts = async () => {
  const result = {};
  for (const table of [
    "customers",
    "orders",
    "order_items",
    "payments",
    "_checkout_requests",
  ])
    result[table] = Number(
      (await pool.query(`SELECT COUNT(*) FROM ${table}`)).rows[0].count,
    );
  return result;
};
test("checkout: повтор після втрати відповіді повертає те саме замовлення навіть після зміни меню", async () => {
  const input = draft(),
    before = await counts();
  const first = await orders.checkout(input);
  await pool.query("UPDATE menu_items SET price=price+1 WHERE id=$1", [
    dish.id,
  ]);
  try {
    assert.deepEqual(await orders.checkout(input), first);
  } finally {
    await pool.query("UPDATE menu_items SET price=$2 WHERE id=$1", [
      dish.id,
      dish.price,
    ]);
  }
  const after = await counts();
  for (const table of Object.keys(before))
    assert.equal(after[table] - before[table], 1, table);
  assert.equal(
    (
      await pool.query("SELECT email FROM customers WHERE phone=$1", [
        input.phone,
      ])
    ).rows[0].email,
    null,
  );
  const order = await orders.get(first.id);
  assert.equal(order.payment.method, "картка");
  assert.equal(order.recipient_name, input.full_name);
});
test("checkout: одночасні повтори створюють один контакт, чек і платіж", async () => {
  const input = draft(),
    before = await counts();
  const results = await Promise.all([
    orders.checkout(input),
    orders.checkout(input),
    orders.checkout(input),
  ]);
  assert.equal(new Set(results.map((item) => item.id)).size, 1);
  const after = await counts();
  for (const table of Object.keys(before))
    assert.equal(after[table] - before[table], 1, table);
  assert.equal(
    (
      await pool.query(
        "SELECT COUNT(*) FROM _checkout_requests WHERE order_id IS NULL",
      )
    ).rows[0].count,
    "0",
  );
});
test("checkout: інший payload з тим самим ключем відхиляється без змін", async () => {
  const input = draft();
  await orders.checkout(input);
  const before = await counts();
  await assert.rejects(
    orders.checkout({ ...input, delivery_address: "Інша демонстраційна адреса" }),
    (error) => error.status === 409,
  );
  assert.deepEqual(await counts(), before);
});
test("checkout: недоступна страва й змінена сума не лишають контактів або платежів", async () => {
  const input = draft(),
    before = await counts();
  await assert.rejects(
    orders.checkout({
      ...input,
      items: [...input.items, { menu_item_id: 2147483647, quantity: 1 }],
    }),
    (error) => error.status === 409,
  );
  assert.deepEqual(await counts(), before);
  await assert.rejects(
    orders.checkout({ ...input, expected_total: "0.01" }),
    (error) => error.status === 409,
  );
  assert.deepEqual(await counts(), before);
});
test("checkout: помилка після платежу відкочує весь запит", async () => {
  const input = draft(),
    before = await counts();
  await pool.query(
    "CREATE FUNCTION checkout_test_failure() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'test failure'; END; $$ LANGUAGE plpgsql; CREATE TRIGGER checkout_test_failure BEFORE UPDATE ON _checkout_requests FOR EACH ROW EXECUTE FUNCTION checkout_test_failure()",
  );
  try {
    await assert.rejects(orders.checkout(input));
  } finally {
    await pool.query(
      "DROP TRIGGER checkout_test_failure ON _checkout_requests;DROP FUNCTION checkout_test_failure()",
    );
  }
  assert.deepEqual(await counts(), before);
});
test("checkout: повторний телефон не переписує CRM, одержувач зберігається окремо", async () => {
  const customer = (
    await pool.query("SELECT * FROM customers ORDER BY id LIMIT 1")
  ).rows[0];
  const input = draft({
    phone: customer.phone,
    full_name: "Інший одержувач доставки",
    delivery_address: "Інша адреса одержувача",
  });
  const created = await orders.checkout(input),
    order = await orders.get(created.id);
  assert.equal(order.customer_id, customer.id);
  assert.equal(order.customer, customer.full_name);
  assert.equal(order.recipient_name, input.full_name);
  assert.equal(order.delivery_address, input.delivery_address);
  assert.deepEqual(
    (await pool.query("SELECT * FROM customers WHERE id=$1", [customer.id]))
      .rows[0],
    customer,
  );
  await assert.rejects(
    pool.query("UPDATE orders SET recipient_name='Змінено' WHERE id=$1", [
      created.id,
    ]),
    (error) => error.code === "23514",
  );
});
test("checkout: різні запити з одним новим телефоном не дублюють контакт", async () => {
  const first = draft(),
    second = draft({ phone: first.phone }),
    before = await counts();
  const results = await Promise.all([
    orders.checkout(first),
    orders.checkout(second),
  ]);
  assert.notEqual(results[0].id, results[1].id);
  const after = await counts();
  assert.equal(after.customers - before.customers, 1);
  assert.equal(after.orders - before.orders, 2);
});
test("checkout: HTTP авторизація окрема від валідації, recent повертає тільки запитані ID", async () => {
  const input = draft();
  const post = (body, headers = {}) =>
    fetch(base + "/api/orders/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  assert.equal((await post(input)).status, 401);
  assert.equal((await post(input, { cookie })).status, 403);
  assert.equal(
    (await post({ ...input, phone: "wrong" }, { cookie, Origin: base })).status,
    400,
  );
  const response = await post(input, { cookie, Origin: base });
  assert.equal(response.status, 200);
  const created = await response.json();
  const replay = await post(input, { cookie, Origin: base });
  assert.deepEqual(await replay.json(), created);
  const list = await fetch(base + `/api/orders/recent?ids=${created.id}`, {
    headers: { cookie },
  });
  assert.equal(list.status, 200);
  assert.deepEqual(
    (await list.json()).map((item) => item.id),
    [created.id],
  );
  const contacts = await fetch(
    base + "/api/customers?q=" + encodeURIComponent(input.phone),
    { headers: { cookie } },
  );
  assert.equal(contacts.status, 200);
  const customerPage = await contacts.json();
  assert.equal(customerPage.total, 1);
  assert.equal(customerPage.items[0].email, null);
  assert.equal(
    (
      await fetch(base + "/api/orders/recent?ids=1%3BDELETE", {
        headers: { cookie },
      })
    ).status,
    400,
  );
});
