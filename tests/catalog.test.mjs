import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import pg from "pg";
import { localDatabase, root } from "../scripts/database.mjs";
import { forDatabase } from "../scripts/runtime.mjs";
import { migrate, connectionString } from "../scripts/migrations.mjs";
import { schemaSignature } from "../scripts/schema-signature.mjs";
import {
  appendCatalog,
  importEmptyCatalog,
  validateCatalog,
} from "../scripts/catalog.mjs";
import { createApplication } from "../apps/backend/dist/application.js";
const name = `delivery_test_${process.pid}_${Date.now()}`;
const catalog = JSON.parse(
  await fs.readFile(path.join(root, "data/catalog.json"), "utf8"),
);
let runtime, admin, db, app, base, cookie;
before(async () => {
  runtime = await localDatabase({ test: true });
  admin = new pg.Client(forDatabase(runtime.config, "postgres"));
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  db = new pg.Client(forDatabase(runtime.config, name));
  await db.connect();
});
after(async () => {
  if (app) await app.close();
  if (db) await db.end();
  if (admin) {
    await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
    await admin.end();
  }
  runtime?.stop();
});

test("Каталог: валідні ціни, унікальні назви, походження й локальні фото без підміни", async () => {
  validateCatalog(catalog);
  const invalid = structuredClone(catalog);
  invalid.restaurants[0].menu.push(invalid.restaurants[0].menu[0]);
  assert.throws(() => validateCatalog(invalid), /Некоректні дані страви/);
  for (const r of catalog.restaurants)
    for (const obj of [r, ...r.menu]) {
      assert.equal(new URL(obj.image_source_url).protocol, "https:");
      const raw = await fs.readFile(
        path.join(root, "apps/web/public", obj.image_url),
      );
      assert.equal(
        createHash("sha256").update(raw).digest("hex"),
        obj.image_sha256,
      );
      assert(raw.length > 100);
    }
});
test("Порожня схема тотожна демонстраційній, міграції не додають вигадану історію", async () => {
  await db.query(
    await fs.readFile(path.join(root, "db/catalog-schema.sql"), "utf8"),
  );
  assert.deepEqual(
    await schemaSignature(db),
    JSON.parse(
      await fs.readFile(
        path.join(root, "apps/backend/prisma/migrations/baseline-schema.json"),
        "utf8",
      ),
    ),
  );
  await migrate(forDatabase(runtime.config, name));
  for (const table of [
    "restaurants",
    "menu_items",
    "customers",
    "couriers",
    "orders",
    "order_items",
    "reviews",
    "payments",
  ])
    assert.equal(
      (await db.query(`SELECT COUNT(*) FROM ${table}`)).rows[0].count,
      "0",
    );
  assert.equal(
    (await db.query("SELECT COUNT(*) FROM _prisma_migrations")).rows[0].count,
    "10",
  );
});
test("Імпорт атомарний, повторний імпорт не очищає жоден запис", async () => {
  const broken = structuredClone(catalog);
  broken.restaurants[1].name += "\0";
  await assert.rejects(importEmptyCatalog(db, broken));
  assert.equal(
    (await db.query("SELECT COUNT(*) FROM restaurants")).rows[0].count,
    "0",
  );
  await importEmptyCatalog(db, catalog);
  const expected = catalog.restaurants.flatMap((r) => r.menu).length;
  assert.equal(
    Number((await db.query("SELECT COUNT(*) FROM menu_items")).rows[0].count),
    expected,
  );
  await assert.rejects(
    importEmptyCatalog(db, catalog),
    /лише в порожню нову БД/,
  );
  assert.equal(
    Number((await db.query("SELECT COUNT(*) FROM menu_items")).rows[0].count),
    expected,
  );
  for (const table of [
    "customers",
    "couriers",
    "orders",
    "order_items",
    "reviews",
    "payments",
  ])
    assert.equal(
      (await db.query(`SELECT COUNT(*) FROM ${table}`)).rows[0].count,
      "0",
    );
});
const write = async (route, data, method = "POST") =>
  fetch(base + route, {
    method,
    headers: {
      Cookie: cookie,
      Origin: base,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
test("Нова база: авторизація кур’єра окрема від валідації, повний цикл доставки", async () => {
  app = await createApplication({
    connectionString: connectionString(forDatabase(runtime.config, name)),
    webRoot: path.join(root, "tests/fixtures/web"),
  });
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
  cookie = (await fetch(base + "/api/session")).headers
    .get("set-cookie")
    .split(";")[0];
  const courier = {
    full_name: "Контрольний кур’єр",
    phone: "+380000800002",
    vehicle_type: "автомобіль",
  };
  assert.equal(
    (
      await fetch(base + "/api/couriers", {
        method: "POST",
        headers: { Origin: base, "Content-Type": "application/json" },
        body: JSON.stringify(courier),
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(base + "/api/couriers", {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: "https://example.com",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(courier),
      })
    ).status,
    403,
  );
  assert.equal(
    (await write("/api/couriers", { ...courier, vehicle_type: "авто" })).status,
    400,
  );
  const cr = await write("/api/couriers", courier);
  assert.equal(cr.status, 200);
  const co = await cr.json();
  assert.equal((await write("/api/couriers", courier)).status, 409);
  const cu = await write("/api/customers", {
    full_name: "Контрольний клієнт",
    phone: "+380000800003",
    email: "fixture-002@example.test",
    default_delivery_address: "Тестова адреса",
  });
  assert.equal(cu.status, 200);
  const customer = await cu.json();
  const dish = (await db.query("SELECT * FROM menu_items ORDER BY id LIMIT 1"))
    .rows[0];
  const response = await write("/api/orders", {
    restaurant_id: dish.restaurant_id,
    customer_id: customer.id,
    delivery_address: "Тестова адреса",
    delivery_note: "Перевірка каталогу",
    items: [{ menu_item_id: dish.id, quantity: 2 }],
  });
  assert.equal(response.status, 200);
  const order = await response.json();
  assert.equal(Number(order.total_amount), Number(dish.price) * 2);
  for (const [expected_status, status, extra] of [
    ["створено", "готується", {}],
    ["готується", "в дорозі", { courier_id: co.id }],
    ["в дорозі", "доставлено", { payment_method: "картка" }],
  ])
    assert.equal(
      (
        await write(
          `/api/orders/${order.id}/status`,
          { expected_status, status, ...extra },
          "PATCH",
        )
      ).status,
      200,
    );
  assert.equal(
    (
      await db.query("SELECT COUNT(*) FROM payments WHERE order_id=$1", [
        order.id,
      ])
    ).rows[0].count,
    "1",
  );
});
test("Ручна зміна ціни скидає позначку перевірки, перейменування прибирає старе фото", async () => {
  const dish = (await db.query("SELECT * FROM menu_items ORDER BY id LIMIT 1"))
    .rows[0];
  const changed = await write(
    `/api/menu/${dish.id}`,
    {
      name: dish.name,
      description: "",
      category: dish.category,
      price: "1.00",
      is_available: true,
    },
    "PATCH",
  );
  assert.equal(changed.status, 200);
  const first = (
    await db.query("SELECT * FROM menu_items WHERE id=$1", [dish.id])
  ).rows[0];
  assert.equal(first.source_url, null);
  assert.equal(first.image_url, dish.image_url);
  assert.equal(
    (
      await db.query("SELECT source_checked_at FROM restaurants WHERE id=$1", [
        dish.restaurant_id,
      ])
    ).rows[0].source_checked_at,
    null,
  );
  assert.equal(
    (
      await write(
        `/api/menu/${dish.id}`,
        {
          name: "Контрольна страва",
          description: "",
          category: dish.category,
          price: "1.00",
          is_available: true,
        },
        "PATCH",
      )
    ).status,
    200,
  );
  assert.equal(
    (await db.query("SELECT image_url FROM menu_items WHERE id=$1", [dish.id]))
      .rows[0].image_url,
    null,
  );
  assert.equal(
    (await db.query("SELECT portion FROM menu_items WHERE id=$1", [dish.id]))
      .rows[0].portion,
    null,
  );
});

const allRows = async () => {
  const rows = {};
  for (const table of [
    "restaurants",
    "menu_items",
    "customers",
    "couriers",
    "orders",
    "order_items",
    "reviews",
    "payments",
  ])
    rows[table] = (await db.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
  return rows;
};
test("Зміна старого закладу до першого розширення не створює дублікат зі старим меню", async () => {
  const source = catalog.restaurants[0];
  const original = (
    await db.query("SELECT * FROM restaurants WHERE catalog_key=$1", [
      source.catalog_key,
    ])
  ).rows[0];
  await db.query(
    "UPDATE restaurants SET catalog_key=NULL,name=$1,address=$2 WHERE id=$3",
    ["Нова назва старої філії", "Змінена стара адреса", original.id],
  );
  const before = await allRows();
  await assert.rejects(
    appendCatalog(db, { ...catalog, restaurants: [source] }),
    /однозначно зіставити/,
  );
  assert.deepEqual(await allRows(), before);
  await db.query(
    "UPDATE restaurants SET catalog_key=$1,name=$2,address=$3 WHERE id=$4",
    [source.catalog_key, original.name, original.address, original.id],
  );
});
test("Розширення каталогу зберігає історію, ручні правки й прив’язує старий запис без дубля", async () => {
  const first = catalog.restaurants[0];
  const {
    rows: [legacy],
  } = await db.query(
    "UPDATE restaurants SET catalog_key=NULL WHERE catalog_key=$1 RETURNING id",
    [first.catalog_key],
  );
  const before = await allRows();
  const fresh = {
    ...structuredClone(first),
    legacy: false,
    catalog_key: "expansion-regression",
    name: "Доданий заклад",
    address: "Контрольна адреса",
    is_active: false,
    menu: [structuredClone(first.menu[0])],
  };
  const addition = { ...catalog, restaurants: [first, fresh] };
  assert.equal(await appendCatalog(db, addition), 1);
  before.restaurants.find((r) => r.id === legacy.id).catalog_key =
    first.catalog_key;
  const added = (
    await db.query("SELECT id FROM restaurants WHERE catalog_key=$1", [
      fresh.catalog_key,
    ])
  ).rows[0];
  assert.equal(
    (
      await db.query("SELECT is_active FROM restaurants WHERE id=$1", [
        added.id,
      ])
    ).rows[0].is_active,
    false,
  );
  const after = await allRows();
  for (const table of Object.keys(before))
    assert.deepEqual(
      after[table].filter((r) => before[table].some((b) => b.id === r.id)),
      before[table],
    );
  await db.query("UPDATE restaurants SET name=$1,address=$2 WHERE id=$3", [
    "Перейменований заклад",
    "Змінена адреса",
    added.id,
  ]);
  await db.query("UPDATE menu_items SET price=1 WHERE restaurant_id=$1", [
    added.id,
  ]);
  const edited = await allRows();
  assert.equal(await appendCatalog(db, addition), 0);
  assert.deepEqual(await allRows(), edited);
});
test("Помилка посеред розширення відкочує всі додані записи", async () => {
  const before = await allRows(),
    first = structuredClone(catalog.restaurants[0]);
  const addition = {
    ...catalog,
    restaurants: [
      {
        ...first,
        legacy: false,
        catalog_key: "expansion-rollback-first",
        name: "Перша нова філія",
      },
      {
        ...first,
        legacy: false,
        catalog_key: "expansion-rollback-broken",
        name: "Некоректний\0заклад",
      },
    ],
  };
  await assert.rejects(appendCatalog(db, addition));
  assert.deepEqual(await allRows(), before);
});
test("Каталог відхиляє повторний ключ джерела до будь-якого запису", () => {
  const duplicate = structuredClone(catalog);
  duplicate.restaurants[1].catalog_key = duplicate.restaurants[0].catalog_key;
  assert.throws(() => validateCatalog(duplicate), /Некоректні джерела закладу/);
});
test("Скорочені назви сумісні зі старим каталогом без дублювання та втрати меню", async () => {
  const source = catalog.restaurants.find((r) => r.legacy_name);
  assert(source);
  const {
    rows: [original],
  } = await db.query("SELECT * FROM restaurants WHERE catalog_key=$1", [
    source.catalog_key,
  ]);
  await db.query(
    "UPDATE restaurants SET catalog_key=NULL,name=$1 WHERE id=$2",
    [source.legacy_name, original.id],
  );
  const before = await allRows();
  assert.equal(
    await appendCatalog(db, { ...catalog, restaurants: [source] }),
    0,
  );
  before.restaurants.find((r) => r.id === original.id).catalog_key =
    source.catalog_key;
  assert.deepEqual(await allRows(), before);
  await db.query("UPDATE restaurants SET name=$1 WHERE id=$2", [
    original.name,
    original.id,
  ]);
});
