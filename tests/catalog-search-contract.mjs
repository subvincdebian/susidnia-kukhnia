import assert from "node:assert/strict";

export async function verifyCatalogSearch(query, request) {
  const ids = [];
  const search = (q, page = 1) =>
    request("/restaurants?" + new URLSearchParams({ q, page: String(page) }));
  const map = (q) => request("/restaurants/map?" + new URLSearchParams({ q }));
  try {
    for (let index = 0; index < 13; index++) {
      const {
        rows: [venue],
      } = await query(
        "INSERT INTO restaurants(name,address,phone,cuisine_type,is_active,latitude,longitude,coordinate_source) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
        [
          `Search contract ${index}`,
          "Київ, тестова адреса",
          `+380000803${String(index).padStart(3, "0")}`,
          "Тестова",
          index !== 12,
          index === 0 ? 50.45 : null,
          index === 0 ? 30.52 : null,
          index === 0 ? "https://example.test/location" : null,
        ],
      );
      ids.push(venue.id);
      for (let dish = 0; dish < 5; dish++) {
        await query(
          "INSERT INTO menu_items(restaurant_id,name,category,price,is_available) VALUES($1,$2,$3,$4,$5)",
          [
            venue.id,
            dish === 4 ? "ПрихованаМаякСтрава" : `Сирний Каприз ${dish}`,
            "ПіцаМаяк",
            dish === 4 ? "1.25" : `${(dish + 1) * 10}.25`,
            dish !== 4,
          ],
        );
      }
    }
    await query(
      "INSERT INTO menu_items(restaurant_id,name,category,price) VALUES($1,$2,$3,$4)",
      [ids[0], "Страва 100%_Маяк\\Тест", "Особливе", "2.25"],
    );
    const lower = await search("  піцамаяк  ");
    const upper = await search("ПІЦАМАЯК");
    assert.equal(lower.total, 13);
    assert.equal(lower.size, 10);
    assert.equal(lower.pages, 2);
    assert.deepEqual(
      upper.items.map((row) => row.id),
      lower.items.map((row) => row.id),
    );
    assert.equal(new Set(lower.items.map((row) => row.id)).size, 10);
    for (const venue of lower.items) {
      assert.equal(Number(venue.matched_dishes_count), 4);
      assert.equal(venue.matched_dishes.length, 3);
      assert.deepEqual(
        venue.matched_dishes.map((row) => row.price),
        ["10.25", "20.25", "30.25"],
      );
      assert(
        venue.matched_dishes.every(
          (row) => row.restaurant_id === venue.id && row.is_available,
        ),
      );
    }
    const last = await search("піцамаяк", 999);
    assert.equal(last.page, 2);
    assert.equal(last.items.length, 3);
    assert.equal(last.items.at(-1).is_active, false);
    assert.deepEqual(
      [...lower.items, ...last.items]
        .map((row) => row.id)
        .sort((a, b) => a - b),
      ids.toSorted((a, b) => a - b),
    );
    const named = await search("сирний каприз 2");
    assert.equal(named.total, 13);
    assert(
      named.items.every(
        (row) =>
          Number(row.matched_dishes_count) === 1 &&
          row.matched_dishes[0].name === "Сирний Каприз 2",
      ),
    );
    const pizza = await search("піца");
    assert(pizza.total >= 13);
    const mapped = await map("піцамаяк");
    assert.equal(mapped.total, 13);
    assert.equal(mapped.items.length, 13);
    assert.equal(mapped.missing_coordinates, 12);
    assert.equal(mapped.truncated, false);
    assert.deepEqual(
      mapped.items.map((row) => row.id).sort((a, b) => a - b),
      ids.toSorted((a, b) => a - b),
    );
    const hidden = await search("прихованамаякстрава");
    assert.equal(hidden.total, 0);
    assert.equal(hidden.pages, 1);
    assert.equal((await map("прихованамаякстрава")).total, 0);
    const literal = await search("%_Маяк\\");
    assert.equal(literal.total, 1);
    assert.equal(literal.items[0].id, ids[0]);
    assert.equal((await search("'; DROP TABLE menu_items;--")).total, 0);
    assert.equal((await search("zzzz_неіснуюча_страва")).total, 0);
    const blank = await search("");
    assert(
      blank.items.every(
        (row) =>
          row.matched_dishes.length === 0 &&
          Number(row.matched_dishes_count) === 0,
      ),
    );
    const venue = await search("Search contract 0");
    assert.equal(venue.total, 1);
    assert.equal(venue.items[0].id, ids[0]);
    await verifyMenuSearch(query, request, ids);
  } finally {
    if (ids.length) {
      await query(
        "DELETE FROM menu_items WHERE restaurant_id=ANY($1::integer[])",
        [ids],
      );
      await query("DELETE FROM restaurants WHERE id=ANY($1::integer[])", [ids]);
    }
  }
}

async function verifyMenuSearch(query, request, ids) {
  const offers = (extras = {}) =>
    request("/menu?" + new URLSearchParams({ q: "піцамаяк", ...extras }));
  const first = await offers();
  assert.equal(first.total, 48);
  assert.equal(first.size, 10);
  assert.equal(first.pages, 5);
  const all = [];
  for (let page = 1; page <= first.pages; page++)
    all.push(
      ...(page === 1 ? first : await offers({ page: String(page) })).items,
    );
  assert.equal(new Set(all.map((row) => row.id)).size, 48);
  assert.deepEqual(
    all.map((row) => Number(row.price)),
    all.map((row) => Number(row.price)).toSorted((a, b) => a - b),
  );
  assert(
    all.every(
      (row) =>
        row.restaurant_id !== ids.at(-1) &&
        row.is_available &&
        typeof row.price === "string" &&
        typeof row.restaurant_name === "string",
    ),
  );
  const last = await offers({ page: "999" });
  assert.equal(last.page, 5);
  assert.equal(last.items.length, 8);
  const descending = await offers({ sort: "price_desc" });
  assert(descending.items.every((row) => row.price === "40.25"));
  const budget = await offers({ max_price: "20.25" });
  assert.equal(budget.total, 24);
  assert(budget.items.every((row) => Number(row.price) <= 20.25));
  assert.equal((await offers({ max_price: "0" })).total, 0);
  assert.equal((await offers({ restaurant_id: String(ids[0]) })).total, 4);
  assert.equal((await offers({ restaurant_id: String(ids.at(-1)) })).total, 0);
  assert.equal((await offers({ q: "прихованамаякстрава" })).total, 0);
  assert.equal((await offers({ q: "ПІЦАМАЯК" })).total, 48);
  assert.equal((await offers({ q: "%_Маяк\\" })).total, 1);
  const chosen = all.slice(0, 2);
  await query("UPDATE menu_items SET portion=$1 WHERE id=$2", [
    "120/30/30 г",
    chosen[0].id,
  ]);
  const selected = await request(
    "/menu?" +
      new URLSearchParams({ ids: chosen.map((row) => row.id).join(",") }),
  );
  assert.equal(selected.total, 2);
  assert.deepEqual(
    selected.items.map((row) => row.id).sort((a, b) => a - b),
    chosen.map((row) => row.id).sort((a, b) => a - b),
  );
  assert.equal(
    selected.items.find((row) => row.id === chosen[0].id).portion,
    "120/30/30 г",
  );
}

export const invalidMenuSearches = [
  "/menu?max_price=-1",
  "/menu?max_price=1.001",
  "/menu?max_price=100000000",
  "/menu?max_price=NaN",
  "/menu?sort=unknown",
  "/menu?restaurant_id=0",
  "/menu?ids=1,2,3,4",
  "/menu?ids=1,1",
  "/menu?ids=-1",
];
