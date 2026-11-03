import { HttpError, integer, object, text } from "../common/validation.js";
import { optionalCoordinates } from "../common/coordinates.js";

export interface OrderInput {
  restaurant: number;
  address: string;
  note: string;
  paymentMethod: string | null;
  items: { id: number; quantity: number }[];
  deliveryLatitude?: number;
  deliveryLongitude?: number;
}

export function orderInput(b: Record<string, unknown>): OrderInput {
  const restaurant = integer(b.restaurant_id, "restaurant_id");
  const paymentMethod =
    b.payment_method === undefined
      ? null
      : text(b.payment_method, "payment_method", 20);
  if (paymentMethod !== null && !["картка", "готівка"].includes(paymentMethod))
    throw new HttpError(400, "Оберіть спосіб оплати", {
      payment_method: "Оберіть значення зі списку",
    });
  const address = text(b.delivery_address, "delivery_address", 200);
  const note = text(b.delivery_note ?? "", "delivery_note", 500, 0);
  if (!Array.isArray(b.items) || b.items.length < 1 || b.items.length > 40)
    throw new HttpError(400, "Оберіть від 1 до 40 страв", {
      items: "Додайте від 1 до 40 різних страв",
    });
  const items = b.items
    .map((value: unknown) => {
      const item = object(value);
      return {
        id: integer(item.menu_item_id, "items"),
        quantity: integer(item.quantity, "items", 1, 99),
      };
    })
    .sort((a, other) => a.id - other.id);
  if (new Set(items.map((item) => item.id)).size !== items.length)
    throw new HttpError(400, "Страва повторюється у замовленні", {
      items: "Кожна страва має бути одним рядком",
    });
  const position = optionalCoordinates(b);
  // Keep the original property order and omit absent coordinates: old checkout
  // request hashes must remain valid after this additive migration.
  return {
    restaurant, address, note, paymentMethod, items,
    ...(position ? { deliveryLatitude: position.latitude, deliveryLongitude: position.longitude } : {}),
  };
}

export function checkoutPhone(value: unknown) {
  const raw = text(value, "phone", 30);
  if (!/^\+?[\d ()-]+$/.test(raw))
    throw new HttpError(400, "Перевірте телефон", {
      phone: "Наприклад, +380000800001",
    });
  let digits = raw.replace(/\D/g, "");
  if (/^0\d{9}$/.test(digits)) digits = "38" + digits;
  if (!/^[1-9]\d{6,14}$/.test(digits))
    throw new HttpError(400, "Перевірте телефон", {
      phone: "Вкажіть номер із кодом країни",
    });
  return "+" + digits;
}

export function minorUnits(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export function checkoutInput(value: unknown) {
  const b = object(value);
  const order = orderInput(b);
  const requestKey = text(b.request_key, "request_key", 64);
  if (!/^[a-f0-9]{64}$/.test(requestKey))
    throw new HttpError(400, "Некоректний ключ оформлення");
  const fullName = text(b.full_name, "full_name", 100).replace(/\s+/g, " ");
  const phone = checkoutPhone(b.phone);
  const expectedTotal = text(b.expected_total, "expected_total", 14);
  if (!/^\d{1,8}\.\d{2}$/.test(expectedTotal) || minorUnits(expectedTotal) <= 0)
    throw new HttpError(400, "Перевірте суму кошика", {
      items: "Оновіть кошик перед оформленням",
    });
  if (!order.paymentMethod)
    throw new HttpError(400, "Оберіть спосіб оплати", {
      payment_method: "Оберіть значення зі списку",
    });
  return { requestKey, fullName, phone, expectedTotal, ...order };
}
