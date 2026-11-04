import type { Numeric } from "../../shared/lib";
export const cartStorageKey = "susidnia-kukhnia.cart.v1";
export const cartCompletionPrefix = "susidnia-kukhnia.completed-cart.";
interface CartStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export interface CartRestaurant {
  id: number;
  name: string;
}
export interface CartItem {
  id: number;
  name: string;
  quantity: number;
}
export interface CartDraft {
  version: 1;
  id: string;
  revision: string;
  restaurant: CartRestaurant | null;
  items: CartItem[];
}
export interface CartProduct {
  id: number;
  name: string;
  price: Numeric;
  is_available: boolean;
  image_url?: string | null;
  image_alt?: string | null;
  portion?: string | null;
}
export interface CartCatalog extends CartRestaurant {
  is_active: boolean;
  menu: CartProduct[];
}
export interface ContactDraft {
  full_name: string;
  phone: string;
  delivery_address: string;
  delivery_note: string;
  delivery_latitude?: number | null;
  delivery_longitude?: number | null;
  payment_method: "картка" | "готівка";
}
export interface CheckoutPayload extends ContactDraft {
  request_key: string;
  restaurant_id: number;
  expected_total: string;
  items: { menu_item_id: number; quantity: number }[];
}
export interface CheckoutAttempt {
  body: CheckoutPayload;
  revision: string;
  restaurantName: string;
  lines: { name: string; quantity: number; unitPrice: string }[];
}

export function cartDisplayCount(
  cart: CartDraft,
  attempt: CheckoutAttempt | null,
) {
  return (attempt?.body.items ?? cart.items).reduce(
    (sum, item) => sum + item.quantity,
    0,
  );
}

export const defaultContact: ContactDraft = {
  full_name: "",
  phone: "",
  delivery_address: "",
  delivery_note: "",
  payment_method: "картка",
};
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const identifier = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value > 0 &&
  value <= 2147483647;
const token = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);
const shortText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length <= max;

export function emptyCart(): CartDraft {
  return {
    version: 1,
    id: crypto.randomUUID(),
    revision: crypto.randomUUID(),
    restaurant: null,
    items: [],
  };
}
export function readCartFromStorage(storage: Pick<CartStorage, "getItem">) {
  const cart = decodeCart(storage.getItem(cartStorageKey));
  return cart && !storage.getItem(cartCompletionPrefix + cart.revision)
    ? cart
    : null;
}
export function completeCartInStorage(
  storage: CartStorage,
  current: CartDraft,
  submittedRevision: string,
) {
  storage.setItem(cartCompletionPrefix + submittedRevision, "1");
  const latest = readCartFromStorage(storage);
  if (latest && latest.revision !== submittedRevision) return latest;
  return current.revision !== submittedRevision ? current : emptyCart();
}
export function decodeCart(raw: string | null): CartDraft | null {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (
      !record(value) ||
      value.version !== 1 ||
      !token(value.id) ||
      !token(value.revision) ||
      !Array.isArray(value.items) ||
      value.items.length > 40
    )
      return null;
    const items: CartItem[] = [];
    for (const item of value.items) {
      if (
        !record(item) ||
        !identifier(item.id) ||
        !shortText(item.name, 100) ||
        !item.name.trim() ||
        !identifier(item.quantity) ||
        item.quantity > 99
      )
        return null;
      items.push({ id: item.id, name: item.name, quantity: item.quantity });
    }
    if (new Set(items.map((item) => item.id)).size !== items.length)
      return null;
    if (!items.length && value.restaurant === null)
      return {
        version: 1,
        id: value.id,
        revision: value.revision,
        restaurant: null,
        items,
      };
    if (
      !items.length ||
      !record(value.restaurant) ||
      !identifier(value.restaurant.id) ||
      !shortText(value.restaurant.name, 100) ||
      !value.restaurant.name.trim()
    )
      return null;
    return {
      version: 1,
      id: value.id,
      revision: value.revision,
      restaurant: { id: value.restaurant.id, name: value.restaurant.name },
      items,
    };
  } catch {
    return null;
  }
}
export function addCartItem(
  cart: CartDraft,
  restaurant: CartRestaurant,
  item: { id: number; name: string },
): CartDraft {
  if (cart.restaurant && cart.restaurant.id !== restaurant.id)
    throw new Error(
      "В одному замовленні можуть бути страви лише одного закладу",
    );
  const previous = cart.items.find((line) => line.id === item.id);
  if (previous && previous.quantity >= 99)
    throw new Error("Максимальна кількість однієї страви: 99");
  if (!previous && cart.items.length >= 40)
    throw new Error("В одному замовленні може бути до 40 різних страв");
  return {
    ...cart,
    revision: crypto.randomUUID(),
    restaurant,
    items: previous
      ? cart.items.map((line) =>
          line.id === item.id ? { ...line, quantity: line.quantity + 1 } : line,
        )
      : [...cart.items, { ...item, quantity: 1 }],
  };
}
export function setCartQuantity(
  cart: CartDraft,
  id: number,
  quantity: number,
): CartDraft {
  if (
    !Number.isSafeInteger(quantity) ||
    quantity < 0 ||
    quantity > 99 ||
    !cart.items.some((item) => item.id === id)
  )
    return cart;
  const items = cart.items.flatMap((item) =>
    item.id !== id ? [item] : quantity ? [{ ...item, quantity }] : [],
  );
  return items.length
    ? { ...cart, items, revision: crypto.randomUUID() }
    : emptyCart();
}
export function cents(value: Numeric): number | null {
  const string = String(value);
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(string)) return null;
  const [whole, fraction = ""] = string.split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return amount > 0 ? amount : null;
}
export const decimal = (value: number) => (value / 100).toFixed(2);
export function resolveCart(cart: CartDraft, catalog: CartCatalog | undefined) {
  const matches = Boolean(
    catalog && cart.restaurant && catalog.id === cart.restaurant.id,
  );
  const lines = cart.items.map((item) => {
    const product =
      catalog && matches
        ? catalog.menu.find((dish) => dish.id === item.id)
        : undefined;
    const unitCents = product ? cents(product.price) : null;
    return {
      ...item,
      product,
      unitCents,
      available: Boolean(
        matches &&
          catalog?.is_active &&
          product?.is_available &&
          unitCents !== null,
      ),
    };
  });
  const totalCents = lines.some((line) => line.unitCents === null)
    ? null
    : lines.reduce(
        (sum, line) => sum + (line.unitCents ?? 0) * line.quantity,
        0,
      );
  return {
    lines,
    totalCents,
    ready: Boolean(
      cart.items.length && matches && lines.every((line) => line.available),
    ),
  };
}
function contactPoint(value: Record<string, unknown>) {
  const latitude = value.delivery_latitude,
    longitude = value.delivery_longitude;
  return typeof latitude === "number" &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    typeof longitude === "number" &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180
    ? { delivery_latitude: latitude, delivery_longitude: longitude }
    : null;
}
export function decodeContact(raw: string | null): ContactDraft {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (
      record(value) &&
      shortText(value.full_name, 100) &&
      shortText(value.phone, 30) &&
      shortText(value.delivery_address, 200) &&
      shortText(value.delivery_note, 500) &&
      (value.payment_method === "картка" || value.payment_method === "готівка")
    )
      return {
        full_name: value.full_name,
        phone: value.phone,
        delivery_address: value.delivery_address,
        delivery_note: value.delivery_note,
        payment_method: value.payment_method,
        ...(contactPoint(value) ?? {}),
      };
  } catch {}
  return { ...defaultContact };
}
export function decodeAttempt(raw: string | null): CheckoutAttempt | null {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (
      !record(value) ||
      !record(value.body) ||
      !token(value.revision) ||
      !shortText(value.restaurantName, 100) ||
      !Array.isArray(value.lines)
    )
      return null;
    const body = value.body;
    if (
      (body.delivery_latitude != null || body.delivery_longitude != null) &&
      !contactPoint(body)
    )
      return null;
    const contact = decodeContact(JSON.stringify(body));
    if (
      !contact.full_name ||
      !contact.phone ||
      !contact.delivery_address ||
      typeof body.request_key !== "string" ||
      !/^[a-f0-9]{64}$/.test(body.request_key) ||
      !identifier(body.restaurant_id) ||
      typeof body.expected_total !== "string" ||
      !/^\d{1,8}\.\d{2}$/.test(body.expected_total) ||
      !Array.isArray(body.items) ||
      !body.items.length ||
      body.items.length > 40
    )
      return null;
    const items: CheckoutPayload["items"] = [];
    for (const item of body.items) {
      if (
        !record(item) ||
        !identifier(item.menu_item_id) ||
        !identifier(item.quantity) ||
        item.quantity > 99
      )
        return null;
      items.push({ menu_item_id: item.menu_item_id, quantity: item.quantity });
    }
    const lines: CheckoutAttempt["lines"] = [];
    for (const line of value.lines) {
      if (
        !record(line) ||
        !shortText(line.name, 100) ||
        !identifier(line.quantity) ||
        line.quantity > 99 ||
        typeof line.unitPrice !== "string" ||
        cents(line.unitPrice) === null
      )
        return null;
      lines.push({
        name: line.name,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
      });
    }
    if (
      lines.length !== items.length ||
      new Set(items.map((item) => item.menu_item_id)).size !== items.length
    )
      return null;
    return {
      revision: value.revision,
      restaurantName: value.restaurantName,
      lines,
      body: {
        ...contact,
        request_key: body.request_key,
        restaurant_id: body.restaurant_id,
        expected_total: body.expected_total,
        items,
      },
    };
  } catch {
    return null;
  }
}
export function decodeHistory(raw: string | null): number[] {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    return Array.isArray(value)
      ? [...new Set(value.filter(identifier))].slice(0, 30)
      : [];
  } catch {
    return [];
  }
}
export async function checkoutKey(
  cartId: string,
  body: Omit<CheckoutPayload, "request_key">,
  accountId: number,
) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify({ accountId, cartId, ...body })),
  );
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
