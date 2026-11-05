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
