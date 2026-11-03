import { forDatabase } from "../scripts/runtime.mjs";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import http from "node:http";
import { localDatabase, root } from "../scripts/database.mjs";
import { createApplication } from "../apps/backend/dist/application.js";
import { RestaurantsService } from "../apps/backend/dist/restaurants/restaurants.service.js";
import { OrdersService } from "../apps/backend/dist/orders/orders.service.js";
import { AnalyticsService } from "../apps/backend/dist/analytics/analytics.service.js";
import { CustomersService } from "../apps/backend/dist/customers/customers.service.js";
import { ReviewsService } from "../apps/backend/dist/reviews/reviews.service.js";
import { serialize } from "../apps/backend/dist/common/serialization.js";
import { publicError } from "../apps/backend/dist/common/api-error.filter.js";
import { migrate, connectionString } from "../scripts/migrations.mjs";

let runtime,
  admin,
  pool,
  service,
  app,
  base,
  cookie,
  preservation,
  migrationPreservation;
const testDatabase = `delivery_test_${process.pid}_${Date.now()}`;
const snapshot = async () => {
  const data = {};
  for (const t of [
    "restaurants",
    "menu_items",
    "customers",
    "couriers",
    "orders",
    "order_items",
  ])
    data[t] = (
      await pool.query(
        `SELECT to_jsonb(t)-'delivery_note' AS row FROM ${t} t ORDER BY id`,
      )
    ).rows;
  return data;
};
const fullSnapshot = async () => {
  const data = {};
  for (const t of [
    "restaurants",
    "menu_items",
    "customers",
    "couriers",
    "orders",
    "order_items",
    "reviews",
    "payments",
  ])
    data[t] = (
      await pool.query(`SELECT row_to_json(t) AS row FROM ${t} t ORDER BY id`)
    ).rows;
  for (const [table, fields] of Object.entries({
    restaurants: [
      "catalog_key",
      "image_url",
      "image_alt",
      "website_url",
      "menu_url",
      "source_checked_at",
      "source_note",
      "latitude",
      "longitude",
      "coordinate_source",
    ],
    menu_items: ["image_url", "image_alt", "source_url", "portion"],
  }))
    for (const item of data[table])
      for (const field of fields) delete item.row[field];
  for (const item of data.couriers) delete item.row.is_active;
  for (const item of data.payments) delete item.row.refunded_at;
  for (const item of data.orders) {
    delete item.row.recipient_name;
    delete item.row.recipient_phone;
    for (const field of ['delivery_latitude','delivery_longitude','address_version','courier_latitude','courier_longitude','courier_location_at','courier_location_source']) delete item.row[field];
  }
  return data;
};
before(async () => {
  runtime = await localDatabase({ test: true });
  admin = new pg.Client(forDatabase(runtime.config, "postgres"));
  await admin.connect();
  await admin.query(`CREATE DATABASE ${testDatabase}`);
  pool = new pg.Pool({ ...forDatabase(runtime.config, testDatabase), max: 8 });
  await pool.query(
    await fs.readFile(path.join(root, "db/fixtures/base.sql"), "utf8"),
  );
  const beforeReviews = await snapshot();
  await pool.query(
    await fs.readFile(path.join(root, "db/fixtures/reviews.sql"), "utf8"),
  );
  preservation = { before: beforeReviews, after: await snapshot() };
  for (const file of ["payments.sql", "integrity.sql"])
    await pool.query(await fs.readFile(path.join(root, "db/fixtures", file), "utf8"));

  const before = await fullSnapshot();
  await migrate(forDatabase(runtime.config, testDatabase));
  migrationPreservation = { before, after: await fullSnapshot() };
  app = await createApplication({
    connectionString: connectionString(
      forDatabase(runtime.config, testDatabase),
    ),
    webRoot: path.join(root, "tests/fixtures/web"),
  });
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
  const orders = app.get(OrdersService),
    restaurants = app.get(RestaurantsService),
    analytics = app.get(AnalyticsService);
  const wrap =
    (fn) =>
    async (...args) =>
      serialize(await fn(...args));
  service = {
    createOrder: wrap(orders.create.bind(orders)),
    changeStatus: wrap(orders.changeStatus.bind(orders)),
    order: wrap(orders.get.bind(orders)),
    saveNote: wrap(orders.saveNote.bind(orders)),
    orders: wrap(orders.list.bind(orders)),
    restaurants: wrap(restaurants.list.bind(restaurants)),
    analytics: wrap(analytics.get.bind(analytics)),
  };
  const response = await fetch(base + "/api/session");
  cookie = response.headers.get("set-cookie").split(";")[0];
});
after(async () => {
  if (app) await app.close();
  if (pool) await pool.end();
  if (admin) {
    if (/^delivery_test_\d+_\d+$/.test(testDatabase))
      await admin.query(`DROP DATABASE ${testDatabase} WITH (FORCE)`);
    await admin.end();
  }
  runtime?.stop();
});
test("Міграція відгуків зберігає всі 70 початкових рядків і значення полів", () => {
  assert.deepEqual(preservation.after, preservation.before);
  assert.equal(
    Object.values(preservation.before).reduce((n, r) => n + r.length, 0),
    70,
  );
});
test("Початкові суми відповідають позиціям; порожні заклади є у рейтингу", async () => {
  const mismatch = await pool.query(
    "SELECT o.id FROM orders o JOIN (SELECT order_id,SUM(quantity*unit_price) amount FROM order_items GROUP BY order_id) i ON i.order_id=o.id WHERE o.total_amount<>i.amount",
  );
  assert.equal(mismatch.rowCount, 0);
  const summary = await service.analytics({
    from: "2026-10-01",
    to: "2026-10-18",
  });
  assert.equal(summary.summary.orders_amount, "4180.00");
  assert.equal(summary.restaurants.length, 10);
  assert(summary.restaurants.some((r) => r.completed_orders === "0"));
});
test("CHECK, FK, UNIQUE та правило доставленого відгуку відхиляють помилки", async () => {
  for (const [sql, code] of [
    [
      "INSERT INTO reviews(order_id,rating,comment) VALUES(7,0,'Тест')",
      "23514",
    ],
    [
      "INSERT INTO reviews(order_id,rating,comment) VALUES(3,5,'Тест')",
      "23514",
    ],
    [
      "INSERT INTO reviews(order_id,rating,comment) VALUES(9999,5,'Тест')",
      "23503",
    ],
    [
      "INSERT INTO reviews(order_id,rating,comment) VALUES(1,5,'Тест')",
      "23505",
    ],
  ])
    await assert.rejects(pool.query(sql), { code });
});
const payload = () => ({
  customer_id: 1,
  restaurant_id: 1,
  delivery_address: "Тестова адреса",
  delivery_note: "Тест",
  items: [{ menu_item_id: 1, quantity: 2 }],
});
test("Помилка під час оформлення відкочує замовлення й позиції", async () => {
  const before = (await pool.query("SELECT COUNT(*) FROM orders")).rows[0]
    .count;
  await assert.rejects(
    service.createOrder({
      ...payload(),
      items: [
        { menu_item_id: 1, quantity: 1 },
        { menu_item_id: 3, quantity: 1 },
      ],
    }),
    { status: 409 },
  );
  assert.equal(
    (await pool.query("SELECT COUNT(*) FROM orders")).rows[0].count,
    before,
  );
});
test("Ціна покупки зберігається після зміни меню; сума захищена", async () => {
  const o = await service.createOrder(payload());
  assert.equal(o.total_amount, "440.00");
  await pool.query("UPDATE menu_items SET price=250 WHERE id=1");
  assert.equal((await service.order(o.id)).items[0].unit_price, "220.00");
  await assert.rejects(
    pool.query("UPDATE orders SET total_amount=1 WHERE id=$1", [o.id]),
    { code: "23514" },
  );
  await pool.query("UPDATE menu_items SET price=220 WHERE id=1");
  await service.changeStatus(o.id, {
    status: "скасовано",
    expected_status: "створено",
  });
});
test("Паралельне призначення одного кур'єра: лише одне замовлення успішне", async () => {
  const a = await service.createOrder(payload()),
    b = await service.createOrder(payload());
  for (const o of [a, b])
    await service.changeStatus(o.id, {
      status: "готується",
      expected_status: "створено",
    });
  const result = await Promise.allSettled(
    [a, b].map((o) =>
      service.changeStatus(o.id, {
        status: "в дорозі",
        expected_status: "готується",
        courier_id: 1,
      }),
    ),
  );
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(result.filter((r) => r.status === "rejected").length, 1);
  const winner = result.find((r) => r.status === "fulfilled").value;
  await assert.rejects(
    service.changeStatus(winner.id, {
      status: "доставлено",
      expected_status: "в дорозі",
      payment_method: "помилка",
    }),
    (error) => publicError(error).status === 409,
  );
  assert.equal((await service.order(winner.id)).delivery_status, "в дорозі");
  assert.equal((await service.order(winner.id)).payment, null);
  const completed = await Promise.all(
    [1, 2].map(() =>
      service.changeStatus(winner.id, {
        status: "доставлено",
        expected_status: "в дорозі",
        payment_method: "картка",
      }),
    ),
  );
  assert.equal(completed[0].payment_id, completed[1].payment_id);
  assert.equal(
    (
      await pool.query("SELECT COUNT(*) FROM payments WHERE order_id=$1", [
        winner.id,
      ])
    ).rows[0].count,
    "1",
  );
  assert.equal(
    (await pool.query("SELECT is_available FROM couriers WHERE id=1")).rows[0]
      .is_available,
    true,
  );
});
test("ROLLBACK скасовує статус і оплату разом; послідовність може мати пропуски", async () => {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT complete_order(3,'картка')");
    assert.equal(
      (await db.query("SELECT delivery_status FROM orders WHERE id=3")).rows[0]
        .delivery_status,
      "доставлено",
    );
    await db.query("ROLLBACK");
  } finally {
    db.release();
  }
  const o = await service.order(3);
  assert.equal(o.delivery_status, "в дорозі");
  assert.equal(o.payment, null);
});
test("Застарілий статус і зміни завершеного замовлення блокуються", async () => {
  await assert.rejects(
    service.changeStatus(11, {
      status: "в дорозі",
      expected_status: "створено",
      courier_id: 4,
    }),
    { status: 409 },
  );
  await assert.rejects(
    pool.query("UPDATE orders SET delivery_status='створено' WHERE id=1"),
    { code: "23514" },
  );
  await assert.rejects(service.saveNote(1, { delivery_note: "Зміна" }), {
    status: 409,
  });
  const before = (
    await pool.query(
      "SELECT id,is_available FROM couriers WHERE id IN (2,4) ORDER BY id",
    )
  ).rows;
  await assert.rejects(
    service.changeStatus(3, {
      status: "в дорозі",
      expected_status: "в дорозі",
      courier_id: 4,
    }),
    { status: 409 },
  );
  assert.deepEqual(
    (
      await pool.query(
        "SELECT id,is_available FROM couriers WHERE id IN (2,4) ORDER BY id",
      )
    ).rows,
    before,
  );
  await assert.rejects(
    pool.query("UPDATE orders SET courier_id=4 WHERE id=3"),
    { code: "23514" },
  );
});
test("Період включає останній день, популярність відокремлює порції від замовлень", async () => {
  const o = await service.createOrder(payload());
  const data = await service.analytics({
    from: new Date().toLocaleDateString("en-CA"),
    to: new Date().toLocaleDateString("en-CA"),
  });
  const dish = data.dishes.find((d) => d.name === "Піца Маргарита");
  assert(dish);
  assert(Number(dish.portions) > Number(dish.orders_count));
  await assert.rejects(
    service.analytics({ from: "2026-02-30", to: "2026-03-01" }),
    { status: 400 },
  );
  const raw = await pool.query(
    "SELECT TIMESTAMP '2026-10-18 23:59:59' >= DATE '2026-10-01' AND TIMESTAMP '2026-10-18 23:59:59' < DATE '2026-10-18'+INTERVAL '1 day' AS included",
  );
  assert.equal(raw.rows[0].included, true);
  await service.changeStatus(o.id, {
    status: "скасовано",
    expected_status: "створено",
  });
});
test("Локальний доступ перевіряється окремо від валідації даних", async () => {
  assert.equal((await fetch(base + "/api/bootstrap")).status, 401);
  assert.equal((await fetch(base + "/%61pi/bootstrap")).status, 401);
  assert.equal(
    (
      await fetch(base + "/%61pi/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(base + "/%61pi/orders", {
        method: "POST",
        headers: { cookie, "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal(
    (await fetch(base + "/api/bootstrap", { headers: { cookie } })).status,
    200,
  );
  assert.equal(
    (
      await fetch(base + "/api/customers", {
        method: "POST",
        headers: { cookie, "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(base + "/api/customers", {
        method: "POST",
        headers: { cookie, Origin: base, "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    400,
  );
  const wrongHost = await new Promise((resolve, reject) => {
    const req = http.get(
      base + "/api/bootstrap",
      { headers: { cookie, Host: "example.test" } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on("error", reject);
  });
  assert.equal(wrongHost, 403);
  const malformed = await new Promise((resolve, reject) => {
    const req = http.get(base, { path: "//[", headers: { cookie } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on("error", reject);
  });
  assert.equal(malformed, 400);
  assert.equal(
    (await fetch(base + "/api/bootstrap", { headers: { cookie } })).status,
    200,
  );
  assert.equal((await fetch(base + "/..%2fsrc/service.mjs")).status, 404);
  const injection = await service.restaurants({
    q: "'; DROP TABLE orders; --",
  });
  assert.equal(injection.items.length, 0);
  assert((await service.orders({})).total > 0);
});
test("Українські символи зберігаються при розділенні UTF-8 між HTTP chunks", async () => {
  const data = {
    full_name: "Тестове ім'я",
    email: "chunks@example.test",
    phone: "+380000800002",
    default_delivery_address: "Тестова адреса",
  };
  const bytes = Buffer.from(JSON.stringify(data)),
    split = bytes.indexOf(Buffer.from("Т")) + 1;
  const response = await new Promise((resolve, reject) => {
    const req = http.request(
      base + "/api/customers",
      {
        method: "POST",
        headers: { cookie, Origin: base, "Content-Type": "application/json" },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            data: JSON.parse(Buffer.concat(chunks).toString("utf8")),
          }),
        );
      },
    );
    req.on("error", reject);
    req.write(bytes.subarray(0, split));
    setImmediate(() => req.end(bytes.subarray(split)));
  });
  assert.equal(response.status, 200);
  assert.equal(response.data.full_name, data.full_name);
  assert.equal(
    (
      await pool.query("SELECT full_name FROM customers WHERE email=$1", [
        data.email,
      ])
    ).rows[0].full_name,
    data.full_name,
  );
});

test("Перехід існуючої БД на Prisma зберігає дані та історію міграцій", async () => {
  assert.deepEqual(migrationPreservation.after, migrationPreservation.before);
  const history = (
    await pool.query(
      "SELECT migration_name,finished_at FROM _prisma_migrations",
    )
  ).rows;
  assert.equal(history.length, 10);
  assert(history.every((r) => r.finished_at));
  await migrate(forDatabase(runtime.config, testDatabase));
  assert.equal(
    (await pool.query("SELECT COUNT(*) FROM _prisma_migrations")).rows[0].count,
    "10",
  );
});
test("JSON, гроші, пагінація та CRUD мають сумісний HTTP-контракт", async () => {
  const headers = { cookie, Origin: base, "Content-Type": "application/json" };
  const response = await fetch(base + "/api/orders/1", { headers: { cookie } }),
    order = await response.json();
  assert.equal(response.status, 200);
  assert.equal(typeof order.total_amount, "string");
  assert.equal(typeof order.items[0].quantity, "number");
  const stored = (await pool.query("SELECT order_date FROM orders WHERE id=1"))
    .rows[0].order_date;
  assert.equal(order.order_date, stored.toISOString());
  const page = await (
    await fetch(base + "/api/restaurants?page=999", { headers: { cookie } })
  ).json();
  assert.equal(page.page, page.pages);
  assert.equal(page.size, 10);
  const duplicate = await fetch(base + "/api/customers", {
    method: "POST",
    headers,
    body: JSON.stringify({
      full_name: "Дубль",
      email: "customer-01@example.test",
      phone: "+380000100001",
      default_delivery_address: "Тестова адреса",
    }),
  });
  assert.equal(duplicate.status, 409);
  const empty = await fetch(base + "/api/orders", {
    method: "POST",
    headers,
    body: "[]",
  });
  assert.equal(empty.status, 400);
  const oversized = await app.inject({
    method: "POST",
    url: "/api/customers",
    headers: { ...headers, host: new URL(base).host },
    payload: { value: "x".repeat(40001) },
  });
  assert.equal(oversized.statusCode, 413);
  const devApp = await createApplication({
    connectionString: connectionString(
      forDatabase(runtime.config, testDatabase),
    ),
    webRoot: path.join(root, "tests/fixtures/web"),
    devOrigin: "http://127.0.0.1:5173",
  });
  try {
    await devApp.listen(0, "127.0.0.1");
    const url = await devApp.getUrl();
    const session = await fetch(url + "/api/session");
    const devCookie = session.headers.get("set-cookie").split(";")[0];
    const devHeaders = {
      cookie: devCookie,
      Origin: "http://127.0.0.1:5173",
      "Content-Type": "application/json",
    };
    const body = JSON.stringify({
      full_name: "Dev клієнт",
      email: "dev@example.test",
      phone: "+380000800004",
      default_delivery_address: "Тестова адреса",
    });
    assert.equal(
      (
        await fetch(url + "/api/customers", {
          method: "POST",
          headers: { ...devHeaders, Origin: "http://example.test" },
          body,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(url + "/api/customers", {
          method: "POST",
          headers: devHeaders,
          body,
        })
      ).status,
      200,
    );
  } finally {
    await devApp.close();
  }
});
test("URL зовнішньої БД не може перекрити назву ізольованої тестової БД", () => {
  const config = forDatabase(
    {
      connectionString:
        "postgresql://test:test@127.0.0.1:9/working_db?application_name=test",
    },
    "delivery_test_isolation",
  );
  assert.equal(
    new pg.Client(config).connectionParameters.database,
    "delivery_test_isolation",
  );
  assert.equal(
    new pg.Client(forDatabase(config, "postgres")).connectionParameters
      .database,
    "postgres",
  );
});
test("Літні та зимові TIMESTAMP з Prisma мають той самий час, що й pg", () => {
  for (const text of ["2026-10-17 14:10:00", "2026-01-17 14:10:00"]) {
    const legacy = pg.types.getTypeParser(1114, "text")(text).toISOString();
    assert.equal(serialize(new Date(text.replace(" ", "T") + "Z")), legacy);
  }
});
test("Нові записи Prisma використовують локальний час БД без зсуву UTC", async () => {
  const restaurant = await app
    .get(RestaurantsService)
    .save(null, {
      name: "Тест часу",
      address: "Тестова адреса",
      phone: "+380000800005",
      cuisine_type: "Українська",
      is_active: true,
    });
  const customer = await app
    .get(CustomersService)
    .create({
      full_name: "Тест часу",
      email: "time@example.test",
      phone: "+380000800003",
      default_delivery_address: "Тестова адреса",
    });
  const order = await service.createOrder(payload());
  await service.changeStatus(order.id, {
    status: "готується",
    expected_status: "створено",
  });
  await service.changeStatus(order.id, {
    status: "в дорозі",
    expected_status: "готується",
    courier_id: 1,
  });
  const payment = await service.changeStatus(order.id, {
    status: "доставлено",
    expected_status: "в дорозі",
    payment_method: "готівка",
  });
  const review = await app
    .get(ReviewsService)
    .save(null, { order_id: order.id, rating: 5, comment: "Перевірка часу" });
  for (const [table, column, id] of [
    ["restaurants", "created_at", restaurant.id],
    ["customers", "created_at", customer.id],
    ["orders", "order_date", order.id],
    ["reviews", "created_at", review.id],
    ["payments", "paid_at", payment.payment_id],
  ]) {
    const result = await pool.query(
      `SELECT ABS(EXTRACT(EPOCH FROM (${column}-LOCALTIMESTAMP)))<60 AS correct FROM ${table} WHERE id=$1`,
      [id],
    );
    assert.equal(result.rows[0].correct, true, `${table}.${column}`);
  }
});

test("Картка оплачується під час оформлення, повторний запит не дублює оплату", async () => {
  const order = await service.createOrder({
    ...payload(),
    payment_method: "картка",
  });
  const paid = await service.order(order.id);
  assert.equal(paid.delivery_status, "створено");
  assert.equal(paid.payment.amount, paid.total_amount);
  assert.equal(paid.payment.method, "картка");
  const headers = { cookie, Origin: base, "Content-Type": "application/json" };
  const repeat = await Promise.all(
    [1, 2].map(() =>
      fetch(`${base}/api/orders/${order.id}/payment`, {
        method: "POST",
        headers,
        body: JSON.stringify({ payment_method: "картка" }),
      }),
    ),
  );
  for (const response of repeat) {
    assert.equal(response.status, 200);
    assert.equal((await response.json()).payment_id, paid.payment.id);
  }
  assert.equal(
    (
      await pool.query("SELECT COUNT(*) FROM payments WHERE order_id=$1", [
        order.id,
      ])
    ).rows[0].count,
    "1",
  );
  await assert.rejects(
    pool.query("UPDATE order_items SET quantity=3 WHERE order_id=$1", [
      order.id,
    ]),
    { code: "23514" },
  );
  await service.changeStatus(order.id, {
    status: "готується",
    expected_status: "створено",
  });
  await service.changeStatus(order.id, {
    status: "в дорозі",
    expected_status: "готується",
    courier_id: 1,
  });
  const complete = await service.changeStatus(order.id, {
    status: "доставлено",
    expected_status: "в дорозі",
  });
  assert.equal(complete.payment_id, paid.payment.id);
  assert.equal((await service.order(order.id)).payment.refunded_at, null);
});

test("Готівка лишається при отриманні, неоплачене замовлення можна оплатити раніше", async () => {
  const order = await service.createOrder({
    ...payload(),
    payment_method: "готівка",
  });
  assert.equal((await service.order(order.id)).payment, null);
  const headers = { cookie, Origin: base, "Content-Type": "application/json" };
  const path = `${base}/api/orders/${order.id}/payment`;
  assert.equal(
    (
      await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(path, {
        method: "POST",
        headers: { cookie, "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(path, {
        method: "POST",
        headers,
        body: JSON.stringify({ payment_method: "готівка" }),
      })
    ).status,
    400,
  );
  const response = await fetch(path, {
    method: "POST",
    headers,
    body: JSON.stringify({ payment_method: "картка" }),
  });
  assert.equal(response.status, 200);
  assert.equal((await service.order(order.id)).delivery_status, "створено");
  await service.changeStatus(order.id, {
    status: "скасовано",
    expected_status: "створено",
  });
  const cancelled = await service.order(order.id);
  assert(cancelled.payment.refunded_at);
  const again = await fetch(path, {
    method: "POST",
    headers,
    body: JSON.stringify({ payment_method: "картка" }),
  });
  assert.equal(again.status, 409);
  await assert.rejects(
    pool.query("UPDATE payments SET refunded_at=NULL WHERE order_id=$1", [
      order.id,
    ]),
    { code: "23514" },
  );
});

test("Хибний спосіб оплати не створює замовлення; оплата і скасування без гонки", async () => {
  const before = (await pool.query("SELECT COUNT(*) FROM orders")).rows[0]
    .count;
  await assert.rejects(
    service.createOrder({ ...payload(), payment_method: "невідомо" }),
    { status: 400 },
  );
  assert.equal(
    (await pool.query("SELECT COUNT(*) FROM orders")).rows[0].count,
    before,
  );
  const order = await service.createOrder(payload());
  const result = await Promise.allSettled([
    app.get(OrdersService).pay(order.id, { payment_method: "картка" }),
    service.changeStatus(order.id, {
      status: "скасовано",
      expected_status: "створено",
    }),
  ]);
  assert.equal(result[1].status, "fulfilled");
  const final = await service.order(order.id);
  assert.equal(final.delivery_status, "скасовано");
  assert(!final.payment || final.payment.refunded_at);
});

test("Кур’єри: список, видалення нового, історія, відновлення й зайнята доставка", async () => {
  const headers = { cookie, Origin: base, "Content-Type": "application/json" };
  const request = (path, method = "GET", body = {}) =>
    fetch(base + "/api/couriers" + path, {
      method,
      headers,
      ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
    });
  assert.equal((await fetch(base + "/api/couriers")).status, 401);
  const denied = await fetch(base + "/api/couriers/1", {
    method: "DELETE",
    headers: { cookie, "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(denied.status, 403);
  const added = await request("", "POST", {
    full_name: "Тестовий кур’єр",
    phone: "+380000000998",
    vehicle_type: "велосипед",
  });
  assert.equal(added.status, 200);
  const courier = await added.json();
  const duplicate = await request("", "POST", {
    full_name: "Дубль",
    phone: courier.phone,
    vehicle_type: "пішки",
  });
  assert.equal(duplicate.status, 409);
  const list = await (
    await request("?q=" + encodeURIComponent(courier.phone))
  ).json();
  assert.equal(list.total, 1);
  const changes = {
    full_name: "Оновлений кур’єр",
    phone: "+380000000997",
    vehicle_type: "автомобіль",
  };
  assert.equal(
    (
      await fetch(base + "/api/couriers/" + courier.id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(base + "/api/couriers/" + courier.id, {
        method: "PATCH",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      })
    ).status,
    403,
  );
  const edited = await request("/" + courier.id, "PATCH", {
    ...changes,
    is_active: false,
    is_available: false,
  });
  assert.equal(edited.status, 200);
  const updated = await edited.json();
  assert.equal(updated.id, courier.id);
  assert.equal(updated.full_name, changes.full_name);
  assert.equal(updated.phone, changes.phone);
  assert.equal(updated.vehicle_type, changes.vehicle_type);
  assert.equal(updated.is_active, true);
  assert.equal(updated.is_available, true);
  assert.equal(
    (
      await request("/" + courier.id, "PATCH", {
        ...changes,
        vehicle_type: "невідомо",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("/" + courier.id, "PATCH", {
        ...changes,
        phone: "+380000200001",
      })
    ).status,
    409,
  );
  assert.equal((await request("/999999", "PATCH", changes)).status, 404);
  const unchanged = await (
    await request("?q=" + encodeURIComponent(changes.phone))
  ).json();
  assert.equal(unchanged.items[0].full_name, changes.full_name);
  const busy = (await pool.query("SELECT * FROM couriers WHERE id=2")).rows[0];
  const assigned = (
    await pool.query(
      "SELECT id,courier_id FROM orders WHERE courier_id=2 ORDER BY id",
    )
  ).rows;
  const busyEdit = await request("/2", "PATCH", {
    full_name: busy.full_name,
    phone: busy.phone,
    vehicle_type: busy.vehicle_type,
    is_available: true,
  });
  assert.equal(busyEdit.status, 200);
  assert.equal((await busyEdit.json()).is_available, false);
  assert.deepEqual(
    (
      await pool.query(
        "SELECT id,courier_id FROM orders WHERE courier_id=2 ORDER BY id",
      )
    ).rows,
    assigned,
  );
  const removed = await request("/" + courier.id, "DELETE");
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).archived, false);
  assert.equal((await request("/" + courier.id, "DELETE")).status, 404);
  const order = await service.createOrder(payload());
  await service.changeStatus(order.id, {
    status: "готується",
    expected_status: "створено",
  });
  await service.changeStatus(order.id, {
    status: "в дорозі",
    expected_status: "готується",
    courier_id: 1,
  });
  assert.equal((await request("/1", "DELETE")).status, 409);
  await service.changeStatus(order.id, {
    status: "скасовано",
    expected_status: "в дорозі",
  });
  const archive = await request("/1", "DELETE");
  assert.equal(archive.status, 200);
  assert.equal((await archive.json()).archived, true);
  assert.equal((await service.order(order.id)).courier, "Кур’єр 01");
  const bootstrap = await (
    await fetch(base + "/api/bootstrap", { headers: { cookie } })
  ).json();
  assert(!bootstrap.couriers.some((c) => c.id === 1));
  const unavailable = await service.createOrder(payload());
  await service.changeStatus(unavailable.id, {
    status: "готується",
    expected_status: "створено",
  });
  await assert.rejects(
    service.changeStatus(unavailable.id, {
      status: "в дорозі",
      expected_status: "готується",
      courier_id: 1,
    }),
    { status: 409 },
  );
  assert.equal((await request("/1/restore", "PATCH")).status, 200);
  await service.changeStatus(unavailable.id, {
    status: "в дорозі",
    expected_status: "готується",
    courier_id: 1,
  });
  await service.changeStatus(unavailable.id, {
    status: "скасовано",
    expected_status: "в дорозі",
  });
  const empty = await (await request("?q=немає_такого_курєра")).json();
  assert.equal(empty.total, 0);
  const legacy = await (
    await request("?q=" + encodeURIComponent("+380000200005"))
  ).json();
  assert.equal(legacy.items[0].is_available, false);
  assert.equal(legacy.items[0].active_orders_count, 0);
  assert.equal((await request("/5", "DELETE")).status, 200);
  assert.equal((await request("/5/restore", "PATCH")).status, 200);
  const restored = await (
    await fetch(base + "/api/bootstrap", { headers: { cookie } })
  ).json();
  assert.equal(restored.couriers.find((c) => c.id === 5).is_available, true);
});
