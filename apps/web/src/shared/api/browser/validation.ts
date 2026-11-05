import { workerSqlState } from "./worker-errors.ts";

export class BrowserApiError extends Error {
  readonly fields: Record<string, string>;
  readonly status: number;
  constructor(message: string, fields: Record<string, string> = {}, status = 0) {
    super(message);
    this.name = "BrowserApiError";
    this.fields = fields;
    this.status = status;
  }
}

export function fail(status: number, message: string, fields: Record<string, string> = {}): never {
  throw new BrowserApiError(message, fields, status);
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(400, "Очікується об'єкт полів");
  return Object.fromEntries(Object.entries(value));
}
export function text(value: unknown, name: string, max = 200, min = 1): string {
  if (typeof value !== "string" || value.trim().length < min || value.trim().length > max)
    fail(400, "Перевірте заповнення полів", { [name]: `Від ${min} до ${max} символів` });
  return value.trim();
}
export function integer(value: unknown, name: string, min = 1, max = 2147483647): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max)
    fail(400, "Перевірте числове поле", { [name]: `Ціле число від ${min} до ${max}` });
  return value;
}
export function money(value: unknown): string {
  if (typeof value !== "string" || !/^\d{1,8}(\.\d{1,2})?$/.test(value) || Number(value) <= 0)
    fail(400, "Перевірте ціну", { price: "Додатна сума, максимум два знаки після крапки" });
  return value;
}
export function flag(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") fail(400, "Перевірте стан поля", { [name]: "Оберіть значення" });
  return value;
}
export function date(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)
    fail(400, "Перевірте період", { [name]: "Вкажіть правильну дату" });
  return value;
}
export const statuses = ["створено", "готується", "в дорозі", "доставлено", "скасовано"];
export function filters(input: Record<string, unknown>) {
  return {
    q: input.q ? text(input.q, "q", 100, 0) : "",
    page: input.page ? integer(Number(input.page), "page", 1, 100000) : 1,
    status: input.status ? text(input.status, "status", 30) : "",
  };
}
export function dishFilters(input: Record<string, unknown>) {
  const base=filters(input);
  const sort=input.sort===undefined||input.sort===''?'price_asc':text(input.sort,'sort',20);
  if(!['price_asc','price_desc','name'].includes(sort))fail(400,'Оберіть сортування',{sort:'Невідомий спосіб сортування'});
  const max_price=input.max_price===undefined||input.max_price===''?null:text(input.max_price,'max_price',11);
  if(max_price!==null&&!/^\d{1,8}(\.\d{1,2})?$/.test(max_price))fail(400,'Перевірте бюджет',{max_price:'Невід’ємна сума, максимум два знаки після крапки'});
  const restaurant_id=input.restaurant_id===undefined||input.restaurant_id===''?null:integer(Number(input.restaurant_id),'restaurant_id');
  const ids=input.ids===undefined||input.ids===''?[]:text(input.ids,'ids',32).split(',').map(id=>integer(Number(id),'ids'));
  if(ids.length>3||new Set(ids).size!==ids.length)fail(400,'Оберіть до трьох різних страв',{ids:'Максимум три різні позиції'});
  return {...base,sort,max_price,restaurant_id,ids};
}
export function phone(value: unknown): string {
  const valueText = text(value, "phone", 20);
  if (!/^\+?[\d ()-]{7,20}$/.test(valueText))
    fail(400, "Перевірте телефон", { phone: "Вкажіть номер телефону" });
  return valueText;
}
export function coordinate(value: unknown, name: string, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > maximum)
    fail(400, "Перевірте координати", { [name]: `Число від ${-maximum} до ${maximum}` });
  return value;
}
export function coordinates(input: Record<string, unknown>, latitudeName = "latitude", longitudeName = "longitude") {
  return {
    latitude: coordinate(input[latitudeName], latitudeName, 90),
    longitude: coordinate(input[longitudeName], longitudeName, 180),
  };
}
export function optionalCoordinates(input: Record<string, unknown>) {
  if (input.delivery_latitude === undefined && input.delivery_longitude === undefined) return undefined;
  return coordinates(input, "delivery_latitude", "delivery_longitude");
}
export function minorUnits(value: string) {
  const [whole = "0", fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
export function orderInput(input: Record<string, unknown>) {
  const restaurant = integer(input.restaurant_id, "restaurant_id");
  const paymentMethod = input.payment_method === undefined ? null : text(input.payment_method, "payment_method", 20);
  if (paymentMethod !== null && !["картка", "готівка"].includes(paymentMethod))
    fail(400, "Оберіть спосіб оплати", { payment_method: "Оберіть значення зі списку" });
  const address = text(input.delivery_address, "delivery_address", 200);
  const note = text(input.delivery_note ?? "", "delivery_note", 500, 0);
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 40)
    fail(400, "Оберіть від 1 до 40 страв", { items: "Додайте від 1 до 40 різних страв" });
  const items = input.items.map((value: unknown) => {
    const item = object(value);
    return { id: integer(item.menu_item_id, "items"), quantity: integer(item.quantity, "items", 1, 99) };
  }).sort((a, b) => a.id - b.id);
  if (new Set(items.map((item) => item.id)).size !== items.length)
    fail(400, "Страва повторюється у замовленні", { items: "Кожна страва має бути одним рядком" });
  const position = optionalCoordinates(input);
  return {
    restaurant, address, note, paymentMethod, items,
    ...(position ? { deliveryLatitude: position.latitude, deliveryLongitude: position.longitude } : {}),
  };
}
export type OrderInput = ReturnType<typeof orderInput>;
export function checkoutInput(value: unknown) {
  const input = object(value), order = orderInput(input);
  const requestKey = text(input.request_key, "request_key", 64);
  if (!/^[a-f0-9]{64}$/.test(requestKey)) fail(400, "Некоректний ключ оформлення");
  const fullName = text(input.full_name, "full_name", 100).replace(/\s+/g, " ");
  const rawPhone = text(input.phone, "phone", 30);
  if (!/^\+?[\d ()-]+$/.test(rawPhone)) fail(400, "Перевірте телефон", { phone: "Вкажіть номер із кодом країни" });
  let digits = rawPhone.replace(/\D/g, "");
  if (/^0\d{9}$/.test(digits)) digits = "38" + digits;
  if (!/^[1-9]\d{6,14}$/.test(digits)) fail(400, "Перевірте телефон", { phone: "Вкажіть номер із кодом країни" });
  const expectedTotal = text(input.expected_total, "expected_total", 14);
  if (!/^\d{1,8}\.\d{2}$/.test(expectedTotal) || minorUnits(expectedTotal) <= 0)
    fail(400, "Перевірте суму кошика", { items: "Оновіть кошик перед оформленням" });
  if (!order.paymentMethod) fail(400, "Оберіть спосіб оплати", { payment_method: "Оберіть значення зі списку" });
  return { requestKey, fullName, phone: "+" + digits, expectedTotal, ...order };
}
export function publicError(error: unknown): BrowserApiError {
  if (error instanceof BrowserApiError) return error;
  const details = error && typeof error === "object" ? Object.fromEntries(Object.entries(error)) : {};
  const code = workerSqlState(error) ?? details.code;
  if (code === "23505") return new BrowserApiError("Такий запис уже існує. Перевірте унікальні поля", {}, 409);
  if (code === "23503") return new BrowserApiError("Пов'язаний запис відсутній або використовується", {}, 409);
  if (code === "23514") return new BrowserApiError("Дані порушують правила цієї операції. Перевірте статус і значення полів", {}, 409);
  if (code === "P0002") return new BrowserApiError("Запис не знайдено", {}, 404);
  if (code === "40001" || code === "40P01") return new BrowserApiError("Дані змінилися одночасно. Оновіть сторінку та повторіть дію", {}, 409);
  return new BrowserApiError("Не вдалося виконати операцію. Повторіть спробу", {}, 500);
}
