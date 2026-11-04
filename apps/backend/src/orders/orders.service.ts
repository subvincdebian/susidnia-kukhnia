import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import {
  Prisma,
  type Order,
  type MenuItem,
  type Courier,
} from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  HttpError,
  integer,
  object,
  statuses,
  text,
} from "../common/validation.js";
import {
  checkoutInput,
  minorUnits,
  orderInput,
  type OrderInput,
} from "./order-input.js";
import { coordinates, optionalCoordinates } from "../common/coordinates.js";
@Injectable()
export class OrdersService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}
  list({
    q = "",
    status = "",
    page = 1,
  }: {
    q?: string;
    status?: string;
    page?: number;
  }) {
    if (status && !statuses.includes(status))
      throw new HttpError(400, "Невідомий статус");
    return this.db.page(
      Prisma.sql`SELECT o.*,c.full_name AS customer,r.name AS restaurant,co.full_name AS courier,p.method AS payment_method,p.refunded_at AS payment_refunded_at
      FROM orders o JOIN customers c ON c.id=o.customer_id JOIN restaurants r ON r.id=o.restaurant_id
      LEFT JOIN couriers co ON co.id=o.courier_id LEFT JOIN payments p ON p.order_id=o.id
      WHERE (${status}='' OR o.delivery_status=${status}) AND (c.full_name ILIKE ${"%" + q + "%"} OR r.name ILIKE ${"%" + q + "%"} OR o.id::text ILIKE ${"%" + q + "%"})
      ORDER BY o.order_date DESC,o.id DESC`,
      page,
    );
  }
  async get(id: number) {
    const row = await this.db.order.findUnique({
      where: { id },
      include: {
        customer: true,
        restaurant: true,
        courier: true,
        items: {
          include: { menu_item: { select: { name: true } } },
          orderBy: { id: "asc" },
        },
        payment: true,
        review: true,
      },
    });
    if (!row) throw new HttpError(404, "Замовлення не знайдено");
    return {
      ...row,
      customer: row.customer.full_name,
      customer_phone: row.customer.phone,
      restaurant: row.restaurant.name,
      restaurant_address: row.restaurant.address,
      restaurant_phone: row.restaurant.phone,
      restaurant_latitude: row.restaurant.latitude,
      restaurant_longitude: row.restaurant.longitude,
      restaurant_coordinate_source: row.restaurant.coordinate_source,
      courier: row.courier?.full_name ?? null,
      courier_phone: row.courier?.phone ?? null,
      courier_transport: row.courier?.vehicle_type ?? null,
      items: row.items.map(({ menu_item, ...item }) => ({
        ...item,
        name: menu_item.name,
      })),
    };
  }
  create(input: unknown) {
    const b = object(input),
      customer = integer(b.customer_id, "customer_id");
    const order = orderInput(b);
    return this.db.$transaction(
      (tx) => this.persistOrder(tx, customer, order),
      { maxWait: 10000, timeout: 15000 },
    );
  }
  checkout(input: unknown, customer: number) {
    integer(customer, 'customer_id');
    const { requestKey, ...data } = checkoutInput(input);
    const hash = createHash("sha256")
      .update(JSON.stringify({customer_id:customer,...data}))
      .digest("hex");
    const legacyHash = createHash('sha256').update(JSON.stringify(data)).digest('hex');
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`INSERT INTO _checkout_requests(request_key, request_hash) VALUES (${requestKey}, ${hash}) ON CONFLICT (request_key) DO NOTHING`;
        const [request] = await tx.$queryRaw<
          { request_hash: string; order_id: number | null }[]
        >`SELECT request_hash, order_id FROM _checkout_requests WHERE request_key=${requestKey} FOR UPDATE`;
        const replayOwned = request && request.order_id !== null && Boolean(await tx.order.findFirst({where:{id:request.order_id,customer_id:customer},select:{id:true}}));
        const legacyOwned = request?.request_hash === legacyHash && replayOwned;
        if (!request || (request.request_hash !== hash && !legacyOwned))
          throw new HttpError(
            409,
            "Цей запит уже використано для іншого замовлення. Перевірте історію замовлень",
            { request_key: "Початковий запит уже збережено" },
          );
        if (request.order_id !== null) {
          if (!replayOwned) throw new HttpError(409,'Цей запит уже використано. Перевірте власну історію замовлень');
          return { id: request.order_id };
        }
        const order = await this.persistOrder(
          tx,
          customer,
          data,
          { name: data.fullName, phone: data.phone },
          data.expectedTotal,
        );
        await tx.checkoutRequest.update({
          where: { request_key: requestKey },
          data: { order_id: order.id },
        });
        return { id: order.id };
      },
      { maxWait: 10000, timeout: 15000 },
    );
  }
  async recent(ids: number[], customer: number) {
    return this.db
      .$queryRaw(Prisma.sql`SELECT o.id,o.order_date,o.delivery_status,o.total_amount,r.name AS restaurant,
      p.method AS payment_method,p.refunded_at AS payment_refunded_at
      FROM orders o JOIN restaurants r ON r.id=o.restaurant_id LEFT JOIN payments p ON p.order_id=o.id
      WHERE o.customer_id=${customer} ${ids.length ? Prisma.sql`AND o.id IN (${Prisma.join(ids)})` : Prisma.empty} ORDER BY o.order_date DESC,o.id DESC LIMIT 30`);
  }
  private async persistOrder(
    tx: Prisma.TransactionClient,
    customer: number,
    input: OrderInput,
    recipient?: { name: string; phone: string },
    expectedTotal?: string,
  ) {
    const { restaurant, address, note, items, paymentMethod } = input;
    const [r] = await tx.$queryRaw<
      { is_active: boolean }[]
    >`SELECT is_active FROM restaurants WHERE id=${restaurant} FOR SHARE`;
    if (!r?.is_active)
      throw new HttpError(409, "Заклад зараз не приймає замовлення");
    if (
      !(await tx.customer.findUnique({
        where: { id: customer },
        select: { id: true },
      }))
    )
      throw new HttpError(400, "Клієнта не знайдено");
    const selected: { dish: MenuItem; quantity: number }[] = [];
    let total = 0;
    for (const item of items) {
      const [dish] = await tx.$queryRaw<
        MenuItem[]
      >`SELECT * FROM menu_items WHERE id=${item.id} FOR SHARE`;
      if (!dish || dish.restaurant_id !== restaurant || !dish.is_available)
        throw new HttpError(409, "Одна зі страв недоступна. Перевірте кошик", {
          items: "Приберіть недоступні страви з кошика",
        });
      selected.push({ dish, quantity: item.quantity });
      total += minorUnits(dish.price.toFixed(2)) * item.quantity;
    }
    if (expectedTotal !== undefined && total !== minorUnits(expectedTotal))
      throw new HttpError(
        409,
        "Ціни змінилися. Перевірте оновлену суму кошика",
        { items: "Перевірте актуальні ціни та підтвердьте оформлення ще раз" },
      );
    if (total > 9999999999)
      throw new HttpError(400, "Сума замовлення завелика", {
        items: "Зменште кількість страв",
      });
    const row = await tx.order.create({
      data: {
        customer_id: customer,
        restaurant_id: restaurant,
        delivery_address: address,
        delivery_latitude: input.deliveryLatitude ?? null,
        delivery_longitude: input.deliveryLongitude ?? null,
        delivery_note: note,
        ...(recipient
          ? { recipient_name: recipient.name, recipient_phone: recipient.phone }
          : {}),
      },
    });
    for (const { dish, quantity } of selected)
      await tx.orderItem.create({
        data: {
          order_id: row.id,
          menu_item_id: dish.id,
          quantity,
          unit_price: dish.price,
        },
      });
    if (paymentMethod === "картка")
      await tx.$queryRaw`SELECT record_order_payment(${row.id}::integer,'картка'::text)`;
    return tx.order.findUniqueOrThrow({ where: { id: row.id } });
  }
  changeStatus(id: number, input: unknown) {
    const b = object(input),
      status = text(b.status, "status", 30),
      expected = text(b.expected_status, "expected_status", 30);
    if (!statuses.includes(status) || !statuses.includes(expected))
      throw new HttpError(400, "Невідомий статус");
    return this.db.$transaction(
      async (tx) => {
        const [old] = await tx.$queryRaw<
          Order[]
        >`SELECT * FROM orders WHERE id=${id} FOR UPDATE`;
        if (!old) throw new HttpError(404, "Замовлення не знайдено");
        const complete = async () => {
          const method =
            b.payment_method === undefined
              ? null
              : text(b.payment_method, "payment_method", 20);
          const [payment] = await tx.$queryRaw<
            { payment_id: number }[]
          >`SELECT complete_order(${id}::integer,${method}::text) AS payment_id`;
          return payment;
        };
        if (status === "доставлено" && old.delivery_status === "доставлено")
          return complete();
        if (old.delivery_status !== expected)
          throw new HttpError(409, "Замовлення вже змінено. Оновіть сторінку");
        const allowed: Record<string, string[]> = {
          створено: ["готується", "скасовано"],
          готується: ["в дорозі", "скасовано"],
          "в дорозі": ["доставлено", "скасовано"],
        };
        if (!allowed[old.delivery_status]?.includes(status))
          throw new HttpError(409, "Недопустима зміна статусу замовлення");
        if (status === "доставлено") return complete();
        let courierId = old.courier_id;
        if (status === "в дорозі") {
          courierId = integer(b.courier_id, "courier_id");
          const [courier] = await tx.$queryRaw<
            Courier[]
          >`SELECT * FROM couriers WHERE id=${courierId} FOR UPDATE`;
          if (!courier?.is_active || !courier.is_available)
            throw new HttpError(409, "Кур'єр зараз недоступний");
          await tx.courier.update({
            where: { id: courierId },
            data: { is_available: false },
          });
        }
        const row = await tx.order.update({
          where: { id },
          data: { delivery_status: status, courier_id: courierId },
        });
        if (status === "скасовано" && old.courier_id) {
          await tx.$executeRaw`UPDATE couriers SET is_available=TRUE WHERE id=${old.courier_id} AND NOT EXISTS(SELECT 1 FROM orders WHERE courier_id=${old.courier_id} AND delivery_status='в дорозі')`;
        }
        return row;
      },
      { maxWait: 10000, timeout: 15000 },
    );
  }
  async pay(id: number, input: unknown) {
    const b = object(input),
      method = text(b.payment_method, "payment_method", 20);
    if (method !== "картка")
      throw new HttpError(400, "До отримання доступна лише оплата карткою", {
        payment_method: "Оберіть оплату карткою",
      });
    const [payment] = await this.db.$queryRaw<
      { payment_id: number }[]
    >`SELECT record_order_payment(${id}::integer,${method}::text) AS payment_id`;
    return payment;
  }
  async saveNote(id: number, input: unknown) {
    const b = object(input),
      note = text(b.delivery_note ?? "", "delivery_note", 500, 0);
    const result = await this.db.order.updateMany({
      where: { id, delivery_status: { notIn: ["доставлено", "скасовано"] } },
      data: { delivery_note: note },
    });
    if (!result.count)
      throw new HttpError(
        409,
        "Примітку завершеного замовлення змінювати не можна",
      );
    return { id };
  }
  changeAddress(id: number, input: unknown) {
    const b = object(input);
    const expected = integer(b.expected_version, "expected_version", 0);
    const address = text(b.delivery_address, "delivery_address", 200);
    const position = optionalCoordinates(b);
    return this.db.$transaction(async (tx) => {
      const old = await this.lockOrder(tx, id);
      if (!['створено','готується'].includes(old.delivery_status) || old.courier_id !== null)
        throw new HttpError(409, "Адресу можна змінити лише до передавання кур'єру");
      if (old.address_version !== expected)
        throw new HttpError(409, "Адресу вже змінено. Оновіть замовлення перед редагуванням");
      return tx.order.update({
        where: {id},
        data: {
          delivery_address: address,
          delivery_latitude: position?.latitude ?? null,
          delivery_longitude: position?.longitude ?? null,
          address_version: {increment:1},
        },
        select: {id:true,delivery_address:true,delivery_latitude:true,delivery_longitude:true,address_version:true},
      });
    }, {maxWait:10000,timeout:15000});
  }
  updateCourierLocation(id: number, input: unknown) {
    const b = object(input);
    const courier = integer(b.courier_id, "courier_id");
    const position = coordinates(b);
    const source = text(b.source, "source", 10);
    if (source !== 'gps' && source !== 'manual')
      throw new HttpError(400, "Оберіть джерело координат", {source:"gps або manual"});
    return this.db.$transaction(async (tx) => {
      const old = await this.lockOrder(tx, id);
      this.requireDelivery(old, courier);
      await tx.$executeRaw`UPDATE orders SET courier_latitude=${position.latitude},courier_longitude=${position.longitude},courier_location_at=LOCALTIMESTAMP,courier_location_source=${source} WHERE id=${id}`;
      return tx.order.findUniqueOrThrow({
        where: {id},
        select: {id:true,courier_id:true,courier_latitude:true,courier_longitude:true,courier_location_at:true,courier_location_source:true},
      });
    }, {maxWait:10000,timeout:15000});
  }
  async messages(id: number) {
    if (!await this.db.order.findUnique({where:{id},select:{id:true}}))
      throw new HttpError(404,"Замовлення не знайдено");
    const rows = await this.db.deliveryMessage.findMany({where:{order_id:id},orderBy:{id:'desc'},take:101});
    return {items:rows.slice(0,100).reverse(),has_more:rows.length>100};
  }
  sendMessage(id: number, input: unknown) {
    const b = object(input);
    const sender = text(b.sender,"sender",10);
    if (sender !== 'customer' && sender !== 'courier')
      throw new HttpError(400,"Оберіть відправника",{sender:"customer або courier"});
    const body = text(b.body,"body",1000);
    const requestKey = text(b.request_key,"request_key",64,8);
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(requestKey))
      throw new HttpError(400,"Некоректний ключ повідомлення",{request_key:"Від 8 до 64 літер, цифр, _ або -"});
    const courier = sender === 'courier' ? integer(b.courier_id,"courier_id") : undefined;
    return this.db.$transaction(async (tx) => {
      const old = await this.lockOrder(tx,id);
      // The controller permits courier messages only for authenticated admins.
      if (courier !== undefined && old.courier_id !== courier)
        throw new HttpError(409,"Цей кур'єр не виконує замовлення");
      const existing = await tx.deliveryMessage.findUnique({
        where:{order_id_request_key:{order_id:id,request_key:requestKey}},
      });
      if (existing) {
        if (existing.body !== body || existing.sender !== sender)
          throw new HttpError(409,"Цей ключ уже використано для іншого повідомлення");
        // A response lost just before completion remains safely retryable.
        return existing;
      }
      this.requireDelivery(old,courier);
      return tx.deliveryMessage.create({data:{order_id:id,sender,body,request_key:requestKey}});
    }, {maxWait:10000,timeout:15000});
  }
  private async lockOrder(tx: Prisma.TransactionClient, id: number) {
    const [order] = await tx.$queryRaw<Order[]>`SELECT * FROM orders WHERE id=${id} FOR UPDATE`;
    if (!order) throw new HttpError(404,"Замовлення не знайдено");
    return order;
  }
  private requireDelivery(order: Order, courier?: number) {
    if (order.delivery_status !== 'в дорозі' || order.courier_id === null)
      throw new HttpError(409,"Дія доступна після передавання кур'єру й до завершення доставки");
    if (courier !== undefined && order.courier_id !== courier)
      throw new HttpError(409,"Цей кур'єр не виконує замовлення");
  }
}
