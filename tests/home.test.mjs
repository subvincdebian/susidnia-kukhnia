import test from "node:test";
import assert from "node:assert/strict";
import {
  featuredDish,
  featuredRestaurants,
  heroRestaurants,
} from "../apps/web/src/pages/home/model.ts";

const restaurant = (id, name, is_active = true) => ({ id, name, is_active });
const dish = (id, name, extra = {}) => ({
  id,
  name,
  is_available: true,
  image_url: `/media/catalog/${id}.webp`,
  ...extra,
});

test("home: featured catalog excludes inactive venues and keeps new venues as fallbacks", () => {
  const items = Object.freeze([
    restaurant(1, "Новий заклад"),
    restaurant(2, "Musafir", false),
    restaurant(3, "il Molino"),
    restaurant(4, "Greek House"),
  ]);
  assert.deepEqual(
    featuredRestaurants(items).map((item) => item.id),
    [3, 4, 1],
  );
  assert.deepEqual(
    items.map((item) => item.id),
    [1, 2, 3, 4],
  );
  assert.deepEqual(featuredRestaurants([]), []);
  assert.equal(
    featuredRestaurants(
      Array.from({ length: 10 }, (_, i) => restaurant(i, `Заклад ${i}`)),
    ).length,
    6,
  );
});

test("home: hero has distinct active venues when preferred names are missing", () => {
  const items = [
    restaurant(1, "Musafir"),
    restaurant(2, "Greek House"),
    restaurant(3, "Pesto Cafe", false),
  ];
  assert.deepEqual(
    heroRestaurants(items).map((item) => item.id),
    [1, 2],
  );
  assert.deepEqual(heroRestaurants([]), []);
});

test("home: dish selection uses available menu data and trusted local photos", () => {
  const data = {
    is_active: true,
    menu: [
      dish(1, "Піца Пепероні", { is_available: false }),
      dish(2, "Піца Пепероні", { image_url: "https://example.com/photo.jpg" }),
      dish(3, "Піца Маргарита"),
      dish(4, "Піца Пепероні з руколою"),
      dish(5, "Піца Пепероні", { image_url: "/media/catalog/../secret.webp" }),
    ],
  };
  assert.equal(featuredDish(data, "пепероні")?.id, 4);
  assert.equal(featuredDish(data, "відсутня страва")?.id, 3);
  assert.equal(
    featuredDish({ ...data, is_active: false }, "пепероні"),
    undefined,
  );
  assert.equal(featuredDish({ ...data, menu: [] }, "пепероні"), undefined);
  assert.equal(featuredDish(undefined, "пепероні"), undefined);
});
