import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyCart,
  cartDisplayCount,
  addCartItem,
  setCartQuantity,
  decodeCart,
  resolveCart,
  decimal,
  checkoutKey,
  decodeAttempt,
  readCartFromStorage,
  completeCartInStorage,
  cartStorageKey,
} from "../apps/web/src/entities/cart/model.ts";
import { canReleaseAttempt } from "../apps/web/src/features/checkout/model.ts";
const restaurant = { id: 1, name: "Заклад" };
const one = () =>
  addCartItem(emptyCart(), restaurant, { id: 1, name: "Страва" });
const payload = {
  full_name: "Одержувач",
  phone: "+380000000001",
  delivery_address: "Демонстраційна адреса",
  delivery_note: "",
  payment_method: "картка",
  restaurant_id: 1,
  expected_total: "0.87",
  items: [{ menu_item_id: 1, quantity: 3 }],
};
test("cart: незавершене оформлення показує свою кількість після зміни кошика іншою вкладкою", () => {
  const original = one();
  const anotherTab = setCartQuantity(original, 1, 7);
  const attempt = {
    body: { ...payload, items: [{ menu_item_id: 1, quantity: 3 }] },
    revision: original.revision,
    restaurantName: restaurant.name,
    lines: [{ name: "Страва", quantity: 3, unitPrice: "0.29" }],
  };
  assert.equal(cartDisplayCount(anotherTab, attempt), 3);
  assert.equal(cartDisplayCount(emptyCart(), attempt), 3);
  assert.equal(cartDisplayCount(anotherTab, null), 7);
  assert.equal(anotherTab.items[0].quantity, 7);
});
test("cart: вибір зберігається після серіалізації, інший заклад потребує явної заміни", () => {
  const cart = one();
  assert.deepEqual(decodeCart(JSON.stringify(cart)), cart);
  assert.throws(() =>
    addCartItem(
      cart,
      { id: 2, name: "Інший заклад" },
      { id: 2, name: "Інша страва" },
    ),
  );
  const updated = addCartItem(cart, restaurant, { id: 1, name: "Страва" });
  assert.equal(updated.items[0].quantity, 2);
  assert.notEqual(updated.revision, cart.revision);
  const removed = setCartQuantity(updated, 1, 0);
  assert.equal(removed.restaurant, null);
  assert.deepEqual(removed.items, []);
  assert.notEqual(removed.id, cart.id);
});
test("cart: межі кількості та кількості позицій відповідають API", () => {
  let cart = one();
  cart = setCartQuantity(cart, 1, 99);
  assert.throws(() => addCartItem(cart, restaurant, { id: 1, name: "Страва" }));
  assert.equal(setCartQuantity(cart, 1, 100), cart);
  for (let id = 2; id <= 40; id++)
    cart = addCartItem(cart, restaurant, { id, name: "Страва " + id });
  assert.throws(() =>
    addCartItem(cart, restaurant, { id: 41, name: "Зайва страва" }),
  );
});
test("cart: некоректне сховище не відновлює хибні ID або повторні позиції", () => {
  assert.equal(decodeCart("{bad json"), null);
  const cart = one();
  assert.equal(
    decodeCart(
      JSON.stringify({ ...cart, items: [...cart.items, ...cart.items] }),
    ),
    null,
  );
  assert.equal(
    decodeCart(
      JSON.stringify({
        ...cart,
        items: [{ id: -1, name: "Неправильна", quantity: 1 }],
      }),
    ),
    null,
  );
});
test("cart: сума рахується у копійках, недоступні та видалені страви блокують оформлення", () => {
  const cart = setCartQuantity(one(), 1, 3);
  const catalog = {
    ...restaurant,
    is_active: true,
    menu: [{ id: 1, name: "Страва", price: "0.29", is_available: true }],
  };
  const result = resolveCart(cart, catalog);
  assert.equal(result.totalCents, 87);
  assert.equal(decimal(result.totalCents), "0.87");
  assert.equal(result.ready, true);
  assert.equal(
    resolveCart(cart, { ...catalog, is_active: false }).ready,
    false,
  );
  assert.equal(resolveCart(cart, { ...catalog, menu: [] }).totalCents, null);
  assert.equal(resolveCart(cart, undefined).ready, false);
});
test("cart: завершення не перезаписує нові дані вкладки до отримання storage event", () => {
  const old = one(),
    newer = addCartItem(old, restaurant, { id: 2, name: "Нова страва" });
  const values = new Map([[cartStorageKey, JSON.stringify(newer)]]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const after = completeCartInStorage(storage, old, old.revision);
  assert.deepEqual(after, newer);
  assert.deepEqual(JSON.parse(values.get(cartStorageKey)), newer);
  assert.deepEqual(readCartFromStorage(storage), newer);
});
test("cart: запис нової вкладки під час завершення не знищується навіть між читаннями", () => {
  const old = one(),
    newer = addCartItem(old, restaurant, { id: 2, name: "Нова страва" });
  const values = new Map([[cartStorageKey, JSON.stringify(old)]]);
  let injected = false;
  const storage = {
    getItem: (key) => {
      const value = values.get(key) ?? null;
      if (key === cartStorageKey && !injected) {
        injected = true;
        values.set(cartStorageKey, JSON.stringify(newer));
      }
      return value;
    },
    setItem: (key, value) => values.set(key, value),
  };
  completeCartInStorage(storage, old, old.revision);
  assert.deepEqual(JSON.parse(values.get(cartStorageKey)), newer);
  assert.deepEqual(readCartFromStorage(storage), newer);
});
test("cart: завершений кошик не повертається після оновлення сторінки", () => {
  const cart = one(),
    values = new Map([[cartStorageKey, JSON.stringify(cart)]]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  assert.equal(
    completeCartInStorage(storage, cart, cart.revision).items.length,
    0,
  );
  assert.equal(readCartFromStorage(storage), null);
});
test("checkout draft: повтор зберігає ключ і початковий payload після перезавантаження", async () => {
  const cart = one(),
    key = await checkoutKey(cart.id, payload, 1);
  assert.equal(
    await checkoutKey(cart.id, JSON.parse(JSON.stringify(payload)), 1),
    key,
  );
  assert.notEqual(await checkoutKey(emptyCart().id, payload, 1), key);
  assert.notEqual(await checkoutKey(cart.id, payload, 2), key);
  const attempt = {
    body: { ...payload, request_key: key },
    revision: cart.revision,
    restaurantName: restaurant.name,
    lines: [{ name: "Страва", quantity: 3, unitPrice: "0.29" }],
  };
  assert.deepEqual(decodeAttempt(JSON.stringify(attempt)), attempt);
});
test("checkout draft: протокольна помилка не скидає невідомий результат оформлення", () => {
  for (const status of [0, 401, 403, 404, 408, 429, 500, 502])
    assert.equal(canReleaseAttempt(status, {}), false, status);
  assert.equal(canReleaseAttempt(409, { request_key: "Вже збережено" }), false);
  assert.equal(canReleaseAttempt(409, { items: "Ціна змінилася" }), true);
  assert.equal(canReleaseAttempt(400, { phone: "Невірний номер" }), true);
});
