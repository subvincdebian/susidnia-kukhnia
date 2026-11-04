import type { PGliteInterface } from "@electric-sql/pglite";
import { one, page, rows, type Row, type SqlClient } from "./sql.ts";
import { checkoutInput, coordinates, fail, filters, integer, minorUnits, object, optionalCoordinates, orderInput, statuses, text, type OrderInput } from "./validation.ts";

interface OrderRow extends Row {
  id: number;
  courier_id: number | null;
  delivery_status: string;
  address_version: number;
}
interface DishRow { id: number; restaurant_id: number; is_available: boolean; price: string }
async function lockOrder(db: SqlClient, id: number) {
  return one<OrderRow>(db, "SELECT * FROM orders WHERE id=$1 FOR UPDATE", [id], "Замовлення не знайдено");
}
function requireDelivery(order: OrderRow, courier?: number) {
  if (order.delivery_status !== "в дорозі" || order.courier_id === null)
    fail(409, "Дія доступна після передавання кур'єру й до завершення доставки");
  if (courier !== undefined && order.courier_id !== courier)
    fail(409, "Цей кур'єр не виконує замовлення");
}
async function persistOrder(db: SqlClient, customer: number, input: OrderInput, recipient?: { name: string; phone: string }, expectedTotal?: string) {
  const restaurant = await rows<{ is_active: boolean }>(db, "SELECT is_active FROM restaurants WHERE id=$1 FOR SHARE", [input.restaurant]);
  if (!restaurant[0]?.is_active) fail(409, "Заклад зараз не приймає замовлення");
  if (!(await rows(db, "SELECT id FROM customers WHERE id=$1", [customer])).length) fail(400, "Клієнта не знайдено");
  const selected: { dish: DishRow; quantity: number }[] = [];
  let total = 0;
  for (const item of input.items) {
    const [dish] = await rows<DishRow>(db, "SELECT id,restaurant_id,is_available,price FROM menu_items WHERE id=$1 FOR SHARE", [item.id]);
    if (!dish || dish.restaurant_id !== input.restaurant || !dish.is_available)
      fail(409, "Одна зі страв недоступна. Перевірте кошик", { items: "Приберіть недоступні страви з кошика" });
    selected.push({ dish, quantity: item.quantity });
    total += minorUnits(dish.price) * item.quantity;
  }
  if (expectedTotal !== undefined && total !== minorUnits(expectedTotal))
    fail(409, "Ціни змінилися. Перевірте оновлену суму кошика", { items: "Перевірте актуальні ціни та підтвердьте оформлення ще раз" });
  if (total > 9999999999) fail(400, "Сума замовлення завелика", { items: "Зменште кількість страв" });
  const order = await one<{ id: number }>(db, `INSERT INTO orders(customer_id,restaurant_id,delivery_address,delivery_latitude,delivery_longitude,delivery_note,recipient_name,recipient_phone)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [customer, input.restaurant, input.address, input.deliveryLatitude ?? null, input.deliveryLongitude ?? null, input.note, recipient?.name ?? null, recipient?.phone ?? null]);
  for (const { dish, quantity } of selected)
    await db.query("INSERT INTO order_items(order_id,menu_item_id,quantity,unit_price) VALUES($1,$2,$3,$4)", [order.id, dish.id, quantity, dish.price]);
  if (input.paymentMethod === "картка")
    await db.query("SELECT record_order_payment($1::integer,'картка'::text)", [order.id]);
  return one<OrderRow>(db, "SELECT * FROM orders WHERE id=$1", [order.id]);
}

export function createOrders(db: PGliteInterface) {
  return {
    list(query: Record<string, unknown>) {
      const { q, status, page: requestedPage } = filters(query);
      if (status && !statuses.includes(status)) fail(400, "Невідомий статус");
      return page(db, `SELECT o.*,c.full_name AS customer,r.name AS restaurant,co.full_name AS courier,p.method AS payment_method,p.refunded_at AS payment_refunded_at
        FROM orders o JOIN customers c ON c.id=o.customer_id JOIN restaurants r ON r.id=o.restaurant_id
        LEFT JOIN couriers co ON co.id=o.courier_id LEFT JOIN payments p ON p.order_id=o.id
        WHERE ($1='' OR o.delivery_status=$1) AND (c.full_name ILIKE $2 OR r.name ILIKE $2 OR o.id::text ILIKE $2)
        ORDER BY o.order_date DESC,o.id DESC`, [status, "%" + q + "%"], requestedPage);
    },
    recent(query: Record<string, unknown>, customerId: number) {
      const raw = text(query.ids ?? "", "ids", 360, 0);
      const values = raw ? raw.split(",") : [];
      if (values.length > 30 || values.some((value) => !/^\d+$/.test(value))) fail(400, "Некоректний список замовлень");
      const ids = [...new Set(values.map((value) => integer(Number(value), "ids")))];
      return rows(db, `SELECT o.id,o.order_date,o.delivery_status,o.total_amount,r.name AS restaurant,p.method AS payment_method,p.refunded_at AS payment_refunded_at
        FROM orders o JOIN restaurants r ON r.id=o.restaurant_id LEFT JOIN payments p ON p.order_id=o.id
        WHERE ($1::integer[] IS NULL OR o.id=ANY($1::integer[])) AND o.customer_id=$2 ORDER BY o.order_date DESC,o.id DESC LIMIT 30`, [ids.length ? ids : null, customerId]);
    },
    async get(id: number) {
      const order = await one<OrderRow>(db, `SELECT o.*,c.full_name AS customer,c.phone AS customer_phone,r.name AS restaurant,
        r.address AS restaurant_address,r.phone AS restaurant_phone,r.latitude AS restaurant_latitude,r.longitude AS restaurant_longitude,
        r.coordinate_source AS restaurant_coordinate_source,co.full_name AS courier,co.phone AS courier_phone,co.vehicle_type AS courier_transport
        FROM orders o JOIN customers c ON c.id=o.customer_id JOIN restaurants r ON r.id=o.restaurant_id
        LEFT JOIN couriers co ON co.id=o.courier_id WHERE o.id=$1`, [id], "Замовлення не знайдено");
      const items = await rows(db, "SELECT i.*,m.name FROM order_items i JOIN menu_items m ON m.id=i.menu_item_id WHERE i.order_id=$1 ORDER BY i.id", [id]);
      const [payment] = await rows(db, "SELECT * FROM payments WHERE order_id=$1", [id]);
      const [review] = await rows(db, "SELECT * FROM reviews WHERE order_id=$1", [id]);
      return { ...order, items, payment: payment ?? null, review: review ?? null };
    },
    create(input: unknown) {
      const body = object(input), customer = integer(body.customer_id, "customer_id"), order = orderInput(body);
      return db.transaction((tx) => persistOrder(tx, customer, order));
    },
    async checkout(input: unknown, customerId: number) {
      const { requestKey, ...data } = checkoutInput(input);
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({ ...data, customer_id: customerId })));
      const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      return db.transaction(async (tx) => {
        await tx.query("INSERT INTO _checkout_requests(request_key,request_hash) VALUES($1,$2) ON CONFLICT(request_key) DO NOTHING", [requestKey, hash]);
        const request = await one<{ request_hash: string; order_id: number | null }>(tx, "SELECT request_hash,order_id FROM _checkout_requests WHERE request_key=$1 FOR UPDATE", [requestKey]);
        if (request.order_id !== null && !(await rows(tx, "SELECT id FROM orders WHERE id=$1 AND customer_id=$2", [request.order_id, customerId])).length)
          fail(404, "Замовлення не знайдено");
        if (request.request_hash !== hash)
          fail(409, "Цей запит уже використано для іншого замовлення. Перевірте історію замовлень", { request_key: "Початковий запит уже збережено" });
        if (request.order_id !== null) return { id: request.order_id };
        const order = await persistOrder(tx, customerId, data, { name: data.fullName, phone: data.phone }, data.expectedTotal);
        await tx.query("UPDATE _checkout_requests SET order_id=$1 WHERE request_key=$2", [order.id, requestKey]);
        return { id: order.id };
      });
    },
    changeStatus(id: number, input: unknown) {
      const body = object(input), status = text(body.status, "status", 30), expected = text(body.expected_status, "expected_status", 30);
      if (!statuses.includes(status) || !statuses.includes(expected)) fail(400, "Невідомий статус");
      return db.transaction(async (tx) => {
        const old = await lockOrder(tx, id);
        const complete = () => {
          const method = body.payment_method === undefined ? null : text(body.payment_method, "payment_method", 20);
          return one(tx, "SELECT complete_order($1::integer,$2::text) AS payment_id", [id, method]);
        };
        if (status === "доставлено" && old.delivery_status === "доставлено") return complete();
        if (old.delivery_status !== expected) fail(409, "Замовлення вже змінено. Оновіть сторінку");
        const allowed: Record<string, string[]> = { "створено": ["готується", "скасовано"], "готується": ["в дорозі", "скасовано"], "в дорозі": ["доставлено", "скасовано"] };
        if (!allowed[old.delivery_status]?.includes(status)) fail(409, "Недопустима зміна статусу замовлення");
        if (status === "доставлено") return complete();
        let courierId = old.courier_id;
        if (status === "в дорозі") {
          courierId = integer(body.courier_id, "courier_id");
          const [courier] = await rows<{ is_active: boolean; is_available: boolean }>(tx, "SELECT is_active,is_available FROM couriers WHERE id=$1 FOR UPDATE", [courierId]);
          if (!courier?.is_active || !courier.is_available) fail(409, "Кур'єр зараз недоступний");
          await tx.query("UPDATE couriers SET is_available=FALSE WHERE id=$1", [courierId]);
        }
        const order = await one(tx, "UPDATE orders SET delivery_status=$1,courier_id=$2 WHERE id=$3 RETURNING *", [status, courierId, id]);
        if (status === "скасовано" && old.courier_id)
          await tx.query("UPDATE couriers SET is_available=TRUE WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM orders WHERE courier_id=$1 AND delivery_status='в дорозі')", [old.courier_id]);
        return order;
      });
    },
    pay(id: number, input: unknown) {
      const method = text(object(input).payment_method, "payment_method", 20);
      if (method !== "картка") fail(400, "До отримання доступна лише оплата карткою", { payment_method: "Оберіть оплату карткою" });
      return one(db, "SELECT record_order_payment($1::integer,$2::text) AS payment_id", [id, method]);
    },
    async saveNote(id: number, input: unknown) {
      const note = text(object(input).delivery_note ?? "", "delivery_note", 500, 0);
      const changed = await rows(db, "UPDATE orders SET delivery_note=$1 WHERE id=$2 AND delivery_status NOT IN ('доставлено','скасовано') RETURNING id", [note, id]);
      if (!changed.length) fail(409, "Примітку завершеного замовлення змінювати не можна");
      return { id };
    },
    changeAddress(id: number, input: unknown) {
      const body = object(input), expected = integer(body.expected_version, "expected_version", 0), address = text(body.delivery_address, "delivery_address", 200), position = optionalCoordinates(body);
      return db.transaction(async (tx) => {
        const old = await lockOrder(tx, id);
        if (!["створено", "готується"].includes(old.delivery_status) || old.courier_id !== null)
          fail(409, "Адресу можна змінити лише до передавання кур'єру");
        if (old.address_version !== expected) fail(409, "Адресу вже змінено. Оновіть замовлення перед редагуванням");
        return one(tx, `UPDATE orders SET delivery_address=$1,delivery_latitude=$2,delivery_longitude=$3,address_version=address_version+1
          WHERE id=$4 RETURNING id,delivery_address,delivery_latitude,delivery_longitude,address_version`, [address, position?.latitude ?? null, position?.longitude ?? null, id]);
      });
    },
    updateCourierLocation(id: number, input: unknown) {
      const body = object(input), courier = integer(body.courier_id, "courier_id"), position = coordinates(body), source = text(body.source, "source", 10);
      if (source !== "gps" && source !== "manual") fail(400, "Оберіть джерело координат", { source: "gps або manual" });
      return db.transaction(async (tx) => {
        requireDelivery(await lockOrder(tx, id), courier);
        return one(tx, `UPDATE orders SET courier_latitude=$1,courier_longitude=$2,courier_location_at=LOCALTIMESTAMP,courier_location_source=$3
          WHERE id=$4 RETURNING id,courier_id,courier_latitude,courier_longitude,courier_location_at,courier_location_source`, [position.latitude, position.longitude, source, id]);
      });
    },
    async messages(id: number) {
      await one(db, "SELECT id FROM orders WHERE id=$1", [id], "Замовлення не знайдено");
      const messages = await rows(db, "SELECT * FROM delivery_messages WHERE order_id=$1 ORDER BY id DESC LIMIT 101", [id]);
      return { items: messages.slice(0, 100).reverse(), has_more: messages.length > 100 };
    },
    sendMessage(id: number, input: unknown) {
      const fields = object(input), sender = text(fields.sender, "sender", 10), body = text(fields.body, "body", 1000), requestKey = text(fields.request_key, "request_key", 64, 8);
      if (sender !== "customer" && sender !== "courier") fail(400, "Оберіть відправника", { sender: "customer або courier" });
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(requestKey)) fail(400, "Некоректний ключ повідомлення", { request_key: "Від 8 до 64 літер, цифр, _ або -" });
      const courier = sender === "courier" ? integer(fields.courier_id, "courier_id") : undefined;
      return db.transaction(async (tx) => {
        const old = await lockOrder(tx, id);
        if (courier !== undefined && old.courier_id !== courier) fail(409, "Цей кур'єр не виконує замовлення");
        const [existing] = await rows<Row & { body: string; sender: string }>(tx, "SELECT * FROM delivery_messages WHERE order_id=$1 AND request_key=$2", [id, requestKey]);
        if (existing) {
          if (existing.body !== body || existing.sender !== sender) fail(409, "Цей ключ уже використано для іншого повідомлення");
          return existing;
        }
        requireDelivery(old, courier);
        return one(tx, "INSERT INTO delivery_messages(order_id,sender,body,request_key) VALUES($1,$2,$3,$4) RETURNING *", [id, sender, body, requestKey]);
      });
    },
  };
}
