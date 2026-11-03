import { forDatabase } from "../scripts/runtime.mjs";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import fs from "node:fs/promises";
import path from "node:path";
import { localDatabase, root } from "../scripts/database.mjs";
import { migrate, prisma } from "../scripts/migrations.mjs";
import { schemaSignature } from "../scripts/schema-signature.mjs";
async function revertLatest(db) {
  await db.query(
    "DROP TABLE delivery_messages;DROP FUNCTION guard_delivery_message();DROP TRIGGER order_address_guard ON orders;DROP FUNCTION guard_order_address();DROP TRIGGER order_courier_location_guard ON orders;DROP FUNCTION guard_courier_location();ALTER TABLE restaurants DROP COLUMN latitude,DROP COLUMN longitude,DROP COLUMN coordinate_source;ALTER TABLE orders DROP COLUMN delivery_latitude,DROP COLUMN delivery_longitude,DROP COLUMN address_version,DROP COLUMN courier_latitude,DROP COLUMN courier_longitude,DROP COLUMN courier_location_at,DROP COLUMN courier_location_source",
  );
  await db.query(
    "DROP TABLE _checkout_requests;DROP TRIGGER order_recipient_guard ON orders;DROP FUNCTION guard_order_recipient();ALTER TABLE orders DROP COLUMN recipient_name,DROP COLUMN recipient_phone;ALTER TABLE customers ALTER COLUMN email SET NOT NULL",
  );
  await db.query(
    "DROP TRIGGER order_payment_refund ON orders;DROP FUNCTION refund_cancelled_order();DROP FUNCTION record_order_payment(integer,text);ALTER TABLE couriers DROP COLUMN is_active;ALTER TABLE payments DROP COLUMN refunded_at",
  );
  const integrity = await fs.readFile(
    path.join(root, "db/fixtures/integrity.sql"),
    "utf8",
  );
  for (const name of ["guard_order_item", "guard_payment"]) {
    const start = integrity.indexOf("CREATE FUNCTION " + name);
    const end = integrity.indexOf("CREATE TRIGGER ", start);
    await db.query(
      integrity
        .slice(start, end)
        .replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION"),
    );
  }
  const payments = await fs.readFile(
    path.join(root, "db/fixtures/payments.sql"),
    "utf8",
  );
  await db.query(
    payments
      .slice(
        payments.indexOf("CREATE FUNCTION complete_order"),
        payments.indexOf("\nCOMMIT;"),
      )
      .replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION"),
  );
}
let runtime, admin;
const database = `delivery_test_${process.pid}_${Date.now()}`;
before(async () => {
  runtime = await localDatabase({ test: true });
  admin = new pg.Client(forDatabase(runtime.config, "postgres"));
  await admin.connect();
  await admin.query(`CREATE DATABASE ${database}`);
});
after(async () => {
  if (admin) {
    if (/^delivery_test_\d+_\d+$/.test(database))
      await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    await admin.end();
  }
  runtime?.stop();
});
test("Prisma deploy з порожньої БД відтворює всі дані, функції та обмеження", async () => {
  const config = forDatabase(runtime.config, database);
  await migrate(config);
  const db = new pg.Client(config);
  await db.connect();
  try {
    const signature = await schemaSignature(db);
    const mapColumns = signature.columns.filter((c) =>
      (c.table_name === 'restaurants' && ['latitude','longitude','coordinate_source'].includes(c.column_name)) ||
      (c.table_name === 'orders' && ['delivery_latitude','delivery_longitude','address_version','courier_latitude','courier_longitude','courier_location_at','courier_location_source'].includes(c.column_name)),
    );
    assert.equal(mapColumns.length,10);
    assert(mapColumns.every((c) => c.column_name === 'address_version' ? c.is_nullable === 'NO' && c.column_default === '0' : c.is_nullable === 'YES'));
    signature.columns = signature.columns.filter((c) => !mapColumns.includes(c));
    for (const name of ['restaurant_coordinate_pair','order_delivery_coordinate_pair','order_address_version_nonnegative','order_courier_coordinate_pair']) {
      assert(signature.constraints.some((c) => c.conname === name));
      signature.constraints = signature.constraints.filter((c) => c.conname !== name);
    }
    for (const name of ['order_address_guard','order_courier_location_guard']) {
      assert(signature.triggers.some((t) => t.tgname === name));
      signature.triggers = signature.triggers.filter((t) => t.tgname !== name);
    }
    assert.equal((await db.query('SELECT COUNT(*) FROM delivery_messages')).rows[0].count,'0');
    assert.equal((await db.query('SELECT COUNT(*) FROM orders WHERE delivery_latitude IS NOT NULL OR delivery_longitude IS NOT NULL OR address_version<>0 OR courier_latitude IS NOT NULL OR courier_longitude IS NOT NULL OR courier_location_at IS NOT NULL OR courier_location_source IS NOT NULL')).rows[0].count,'0');
    assert.equal((await db.query('SELECT COUNT(*) FROM restaurants WHERE latitude IS NOT NULL OR longitude IS NOT NULL OR coordinate_source IS NOT NULL')).rows[0].count,'0');
    const recipient = signature.columns.filter(
      (c) =>
        c.table_name === "orders" &&
        ["recipient_name", "recipient_phone"].includes(c.column_name),
    );
    assert.equal(recipient.length, 2);
    assert(recipient.every((c) => c.is_nullable === "YES"));
    signature.columns = signature.columns.filter((c) => !recipient.includes(c));
    const email = signature.columns.find(
      (c) => c.table_name === "customers" && c.column_name === "email",
    );
    assert.equal(email.is_nullable, "YES");
    email.is_nullable = "NO";
    assert(
      signature.constraints.some((c) => c.conname === "order_recipient_pair"),
    );
    signature.constraints = signature.constraints.filter(
      (c) => c.conname !== "order_recipient_pair",
    );
    assert(
      signature.triggers.some((t) => t.tgname === "order_recipient_guard"),
    );
    signature.triggers = signature.triggers.filter(
      (t) => t.tgname !== "order_recipient_guard",
    );
    assert.equal(
      (
        await db.query(
          "SELECT COUNT(*) FROM orders WHERE recipient_name IS NOT NULL OR recipient_phone IS NOT NULL",
        )
      ).rows[0].count,
      "0",
    );
    assert.equal(
      (await db.query("SELECT COUNT(*) FROM _checkout_requests")).rows[0].count,
      "0",
    );
    const checkoutConstraints = (
      await db.query(
        "SELECT contype FROM pg_constraint WHERE conrelid='public._checkout_requests'::regclass",
      )
    ).rows
      .map((c) => c.contype)
      .sort();
    assert.deepEqual(checkoutConstraints, ["f", "p", "u"]);
    const metadata = signature.columns.filter(
      (c) =>
        (c.table_name === "restaurants" && c.ordinal_position > 8) ||
        (c.table_name === "menu_items" && c.ordinal_position > 7),
    );
    assert.equal(metadata.length, 11);
    assert(metadata.every((c) => c.is_nullable === "YES"));
    signature.columns = signature.columns.filter((c) => !metadata.includes(c));
    assert(
      signature.indexes.some(
        (i) =>
          i.indexname === "restaurants_catalog_key_key" &&
          i.indexdef.includes("UNIQUE"),
      ),
    );
    signature.indexes = signature.indexes.filter(
      (i) => i.indexname !== "restaurants_catalog_key_key",
    );
    const rating = signature.columns.find(
      (c) => c.table_name === "restaurants" && c.column_name === "rating",
    );
    assert.equal(rating.is_nullable, "YES");
    assert.equal(rating.column_default, null);
    Object.assign(rating, { is_nullable: "NO", column_default: "5.0" });
    const baseline = JSON.parse(
      await fs.readFile(
        path.join(root, "apps/backend/prisma/migrations/baseline-schema.json"),
        "utf8",
      ),
    );
    const active = signature.columns.find(
      (c) => c.table_name === "couriers" && c.column_name === "is_active",
    );
    assert.equal(active.is_nullable, "NO");
    assert.equal(active.column_default, "true");
    const refunded = signature.columns.find(
      (c) => c.table_name === "payments" && c.column_name === "refunded_at",
    );
    assert.equal(refunded.is_nullable, "YES");
    signature.columns = signature.columns.filter(
      (c) => c !== active && c !== refunded,
    );
    assert(
      signature.constraints.some((c) => c.conname === "payment_refund_time"),
    );
    signature.constraints = signature.constraints.filter(
      (c) => c.conname !== "payment_refund_time",
    );
    assert(signature.triggers.some((t) => t.tgname === "order_payment_refund"));
    signature.triggers = signature.triggers.filter(
      (t) => t.tgname !== "order_payment_refund",
    );
    for (const name of [
      "guard_payment",
      "guard_order_item",
      "complete_order",
    ]) {
      const actual = signature.functions.find((f) => f.proname === name);
      assert(
        actual.definition.includes(
          name === "guard_payment"
            ? "refunded_at"
            : name === "guard_order_item"
              ? "FROM payments"
              : "IF payment_id IS NULL",
        ),
      );
      actual.definition = baseline.functions.find(
        (f) => f.proname === name,
      ).definition;
    }
    assert.equal(
      (
        await db.query(
          "SELECT COUNT(*) FROM pg_proc WHERE proname IN ('record_order_payment','refund_cancelled_order')",
        )
      ).rows[0].count,
      "2",
    );
    assert.deepEqual(signature, baseline);
    assert.equal(
      (await db.query("SELECT COUNT(*) FROM orders")).rows[0].count,
      "12",
    );
    assert.equal(
      (
        await db.query(
          "SELECT COUNT(*) FROM pg_trigger WHERE tgname='order_update_guard'",
        )
      ).rows[0].count,
      "1",
    );
    assert.equal(
      (await db.query("SELECT SUM(total_amount)::text AS amount FROM orders"))
        .rows[0].amount,
      "4180.00",
    );
  } finally {
    await db.end();
  }
});
test("Перервана реєстрація старої схеми продовжується; drift відхиляється", async () => {
  const config = forDatabase(runtime.config, database);
  const db = new pg.Client(config);
  await db.connect();
  try {
    await revertLatest(db);
    await db.query(
      "ALTER TABLE restaurants DROP COLUMN image_url,DROP COLUMN image_alt,DROP COLUMN website_url,DROP COLUMN menu_url,DROP COLUMN source_checked_at,DROP COLUMN source_note,DROP COLUMN catalog_key",
    );
    await db.query(
      "ALTER TABLE menu_items DROP COLUMN image_url,DROP COLUMN image_alt,DROP COLUMN source_url,DROP COLUMN portion",
    );
    await db.query(
      "ALTER TABLE restaurants ALTER COLUMN rating SET NOT NULL,ALTER COLUMN rating SET DEFAULT 5.0",
    );
    await db.query("DROP TABLE _app_data_seeds");
    await db.query("DROP TABLE _prisma_migrations");
    const definition = (
      await db.query(
        "SELECT pg_get_functiondef('complete_order(integer,text)'::regprocedure) AS sql",
      )
    ).rows[0].sql;
    await db.query(
      definition.replace(
        "        RETURN payment_id;",
        "        -- Повторне натискання не додає другу оплату.\n        RETURN payment_id;",
      ),
    );
    await prisma(
      ["migrate", "resolve", "--applied", "202610010005_base"],
      config,
    );
    await migrate(config);
    assert.equal(
      (await db.query("SELECT COUNT(*) FROM _prisma_migrations")).rows[0].count,
      "10",
    );
    await revertLatest(db);
    await db.query(
      "ALTER TABLE restaurants DROP COLUMN image_url,DROP COLUMN image_alt,DROP COLUMN website_url,DROP COLUMN menu_url,DROP COLUMN source_checked_at,DROP COLUMN source_note,DROP COLUMN catalog_key",
    );
    await db.query(
      "ALTER TABLE menu_items DROP COLUMN image_url,DROP COLUMN image_alt,DROP COLUMN source_url,DROP COLUMN portion",
    );
    await db.query(
      "ALTER TABLE restaurants ALTER COLUMN rating SET NOT NULL,ALTER COLUMN rating SET DEFAULT 5.0",
    );
    await db.query("DROP TABLE _app_data_seeds");
    await db.query("DROP TABLE _prisma_migrations");
    await db.query("ALTER TABLE customers ADD COLUMN unexpected TEXT");
    await assert.rejects(migrate(config), /Схема наявної БД відрізняється/);
    assert.equal(
      (await db.query("SELECT COUNT(*) FROM customers")).rows[0].count,
      "10",
    );
    assert.equal(
      (
        await db.query(
          "SELECT to_regclass('public._prisma_migrations') AS name",
        )
      ).rows[0].name,
      null,
    );
  } finally {
    await db.end();
  }
});
