import test from "node:test";
import assert from "node:assert/strict";
import { portionPrice } from "../apps/web/src/features/compare-dishes/model.ts";
import {
  catalogReturnParams,
  compareIds,
} from "../apps/web/src/entities/restaurant/search-state.ts";

test("comparison: unit prices use only explicit single weights or volumes", () => {
  assert.deepEqual(portionPrice("165.00", "150 г"), { price: 110, unit: "г" });
  assert.deepEqual(portionPrice("40.00", "0,5 л"), { price: 8, unit: "мл" });
  assert.deepEqual(portionPrice("100.00", "1 kg"), { price: 10, unit: "г" });
  assert.deepEqual(portionPrice("99.99", "100 g"), { price: 99.99, unit: "г" });
  for (const portion of [
    null,
    "",
    "120/30/30 г",
    "Стандарт, пухке тісто; 501 г",
    "182 г; без додаткових інгредієнтів",
    "30 см",
    "2 шт",
    "0 г",
    "-1 г",
  ])
    assert.equal(portionPrice("219.00", portion), null);
  assert.equal(portionPrice("invalid", "150 г"), null);
  assert(portionPrice("0.01", "1 кг").price > 0);
});
test("comparison: menu return keeps filters and selection and rejects unrelated URL controls", () => {
  const state = new URLSearchParams({
    q: "сирники",
    display: "dishes",
    sort: "price_desc",
    max_price: "300",
    restaurant_id: "2",
    compare: "1,2,3",
    page: "2",
    view: "orders",
    next: "https://example.test",
    role: "admin",
  });
  assert.deepEqual(catalogReturnParams(state.toString()), {
    q: "сирники",
    display: "dishes",
    sort: "price_desc",
    max_price: "300",
    restaurant_id: "2",
    compare: "1,2,3",
    page: "2",
  });
  assert.deepEqual(catalogReturnParams(null, "піца"), { q: "піца" });
  assert.deepEqual(compareIds("1,2,3"), [1, 2, 3]);
  for (const value of ["1,2,3,4", "0,1", "-1,2", "2147483648", "invalid"])
    assert.deepEqual(compareIds(value), []);
});
