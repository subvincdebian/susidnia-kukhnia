import test from "node:test";
import assert from "node:assert/strict";
import { openPage } from "../apps/web/src/shared/lib/navigation.ts";

test("search navigation: menu context survives explicit return and is cleared for unrelated destinations", () => {
  const keys = ["window", "history", "PopStateEvent"];
  const originals = new Map(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  const browser = {
    location: { href: "https://example.test/?view=restaurants&q=піца" },
    dispatchEvent() {},
    scrollTo() {},
  };
  try {
    Object.defineProperty(globalThis, "window", {
      value: browser,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(globalThis, "history", {
      value: {
        pushState(_state, _title, url) {
          browser.location.href = String(url);
        },
      },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(globalThis, "PopStateEvent", {
      value: class {},
      writable: true,
      configurable: true,
    });
    openPage("menu", { id: 7, q: "Піца Маргарита", catalog_q: "піца" });
    assert.equal(
      new URL(browser.location.href).searchParams.get("catalog_q"),
      "піца",
    );
    openPage("restaurants", { q: "піца" });
    assert.equal(new URL(browser.location.href).searchParams.get("q"), "піца");
    assert.equal(
      new URL(browser.location.href).searchParams.has("catalog_q"),
      false,
    );
    openPage("restaurants");
    openPage("menu", { id: 9 });
    const next = new URL(browser.location.href);
    assert.equal(next.searchParams.get("id"), "9");
    assert.equal(next.searchParams.has("q"), false);
    assert.equal(next.searchParams.has("catalog_q"), false);
  } finally {
    for (const key of keys) {
      const descriptor = originals.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
