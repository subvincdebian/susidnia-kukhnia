import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

let server;
let Async,
  HeroFood,
  CatalogPhoto,
  RestaurantGridSkeleton,
  MenuSkeleton,
  RestaurantPreview,
  DishCatalog;
before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("../apps/web/", import.meta.url)),
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "error",
  });
  ({ Async } = await server.ssrLoadModule("/src/shared/ui/primitives.tsx"));
  ({ HeroFood } = await server.ssrLoadModule("/src/pages/home/ui.tsx"));
  ({
    CatalogPhoto,
    RestaurantGridSkeleton,
    MenuSkeleton,
    RestaurantPreview,
    DishCatalog,
  } = await server.ssrLoadModule("/src/entities/restaurant/index.ts"));
});
after(async () => {
  await server?.close();
});

const resource = (data, options = {}) => ({
  data,
  error: null,
  loading: false,
  retry() {},
  ...options,
});
const venue = {
  id: 7,
  name: "Заклад",
  is_active: true,
  image_url: "/media/catalog/venue.webp",
};
test("search UI: matching dishes have separate menu links and preserve the catalog query", () => {
  const dishes = Array.from({ length: 3 }, (_, index) => ({
    id: index + 1,
    restaurant_id: 7,
    name: `Піца ${index}`,
    category: "Піца",
    price: "123.45",
    is_available: true,
  }));
  const html = renderToStaticMarkup(
    h(RestaurantPreview, {
      restaurant: {
        ...venue,
        matched_dishes: dishes,
        matched_dishes_count: 12,
      },
      searchQuery: "піца",
    }),
  );
  const links = [...html.matchAll(/href="([^"]+)"/g)].map(
    (match) =>
      new URL(match[1].replaceAll("&amp;", "&"), "https://example.test"),
  );
  assert.equal(links.length, 5);
  assert(
    links.every(
      (url) =>
        url.searchParams.get("catalog_q") === "піца" &&
        url.searchParams.get("id") === "7",
    ),
  );
  assert.equal(links[1].searchParams.get("q"), "Піца 0");
  assert.equal(links.at(-1).searchParams.get("q"), "піца");
  assert.match(html, /Страв за запитом: 12/);
  const ordinary = renderToStaticMarkup(
    h(RestaurantPreview, { restaurant: { ...venue, matched_dishes: dishes } }),
  );
  assert.doesNotMatch(ordinary, /restaurant-search-matches/);
});
test("search UI: a linked menu opens with the requested dish already filtered", () => {
  const dishes = [
    {
      id: 1,
      restaurant_id: 7,
      name: "Піца Маргарита",
      description: null,
      category: "Піца",
      price: "123.45",
      is_available: true,
    },
    {
      id: 2,
      restaurant_id: 7,
      name: "Борщ",
      description: null,
      category: "Супи",
      price: "89.00",
      is_available: true,
    },
  ];
  const html = renderToStaticMarkup(
    h(DishCatalog, {
      dishes,
      initialQuery: "ПІЦА",
      renderActions: () => null,
      shop: true,
    }),
  );
  assert.match(html, /value="ПІЦА"/);
  assert.match(html, /Піца Маргарита/);
  assert.doesNotMatch(html, />Борщ</);
});
const renderHero = (options = {}) =>
  renderToStaticMarkup(
    h(HeroFood, {
      restaurant: venue,
      resource: resource(undefined, { loading: true }),
      preferredName: "піца",
      variant: "main",
      onMenu() {},
      ...options,
    }),
  );

test("loading UI: initial request announces loading with a non-interactive skeleton", () => {
  const html = renderToStaticMarkup(
    h(Async, {
      resource: resource(undefined, { loading: true }),
      fallback: h(RestaurantGridSkeleton),
      children: () => h("p", null, "Готово"),
    }),
  );
  assert.match(html, /role="status"/);
  assert.match(html, /Завантаження даних/);
  assert.match(html, /home-restaurant-grid/);
  assert.doesNotMatch(html, /<(?:button|a|input)\b/);
  assert.doesNotMatch(html, /Готово/);
});

test("loading UI: background refresh preserves data rather than replacing it with skeletons", () => {
  const html = renderToStaticMarkup(
    h(Async, {
      resource: resource({ name: "Збережений результат" }, { loading: true }),
      fallback: h(RestaurantGridSkeleton),
      children: (data) => h("p", null, data.name),
    }),
  );
  assert.match(html, /Збережений результат/);
  assert.match(html, /Оновлення даних/);
  assert.doesNotMatch(html, /class="skeleton/);
});

test("loading UI: a failed request stops skeletons and exposes recovery", () => {
  const html = renderToStaticMarkup(
    h(Async, {
      resource: resource(undefined, { error: new Error("Немає з'єднання") }),
      children: () => h("p", null, "Приховані дані"),
    }),
  );
  assert.match(html, /role="alert"/);
  assert.match(html, /Повторити/);
  assert.doesNotMatch(html, /class="skeleton|Приховані дані/);
});

test("home loading: missing venues stop being skeletons when the catalog is ready", () => {
  assert.equal(
    renderHero({ restaurant: undefined, catalogLoading: false }),
    "",
  );
  const pending = renderHero({ restaurant: undefined, catalogLoading: true });
  assert.match(pending, /home-food-placeholder/);
  assert.match(pending, /aria-hidden="true"/);
  assert.doesNotMatch(pending, /<button/);
});

test("home loading: menu failure has a retry instead of an endless shimmer", () => {
  const html = renderHero({
    resource: resource(undefined, { error: new Error("Недоступно") }),
  });
  assert.match(html, /Не вдалося завантажити меню/);
  assert.match(html, /Повторити/);
  assert.doesNotMatch(html, /class="skeleton|home-food-placeholder/);
});

test("home loading: a completed menu exposes its dish and starts the separate photo loading state", () => {
  const html = renderHero({
    resource: resource({
      ...venue,
      menu: [
        {
          id: 1,
          name: "Піца",
          price: 150,
          is_available: true,
          image_url: "/media/catalog/pizza.webp",
        },
      ],
    }),
  });
  assert.match(html, /Відкрити меню Заклад: Піца/);
  assert.match(html, /data-state="loading"/);
  assert.match(html, /\/media\/catalog\/pizza.webp/);
  assert.doesNotMatch(html, /home-food-placeholder/);
});

test("photo loading: absent or untrusted photos use the completed fallback without shimmer", () => {
  for (const src of [
    null,
    "https://example.com/image.jpg",
    "/media/catalog/../private.png",
  ]) {
    const html = renderToStaticMarkup(h(CatalogPhoto, { src, alt: "Страва" }));
    assert.match(html, /data-state="unavailable"/);
    assert.match(html, /Фото ще немає/);
    assert.doesNotMatch(html, /<img|class="skeleton/);
  }
});

test("menu loading: placeholders cannot receive focus or pretend to be available actions", () => {
  const html = renderToStaticMarkup(h(MenuSkeleton));
  assert.match(html, /menu-masthead/);
  assert.match(html, /menu-cart-sidebar/);
  assert.doesNotMatch(html, /<(?:button|a|input|select)\b|tabindex=/i);
});
