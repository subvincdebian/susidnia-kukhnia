import test from "node:test";
import assert from "node:assert/strict";
import { managementGroups, managementLinks } from "../apps/web/src/widgets/shell/model.ts";
import { isShopView, pageHref } from "../apps/web/src/shared/lib/navigation.ts";

test("navigation: every management destination remains reachable once", () => {
  const views = managementLinks.map((item) => item.view);
  assert.equal(views.length, new Set(views).size);
  assert.deepEqual([...views].sort(), [
    "analytics", "couriers", "customers", "manage", "manage-restaurants", "orders", "reviews",
  ]);
  for (const item of managementLinks) {
    const url = new URL(pageHref(item.view), "http://127.0.0.1:3000");
    assert.equal(url.searchParams.get("view"), item.view);
    assert.equal(url.searchParams.size, 1);
    assert.equal(isShopView(item.view), false);
  }
});

test("navigation: grouped workspace keeps customer ordering separate", () => {
  for (const view of ["home", "restaurants", "menu", "checkout", "order", "history"]) {
    assert.equal(isShopView(view), true);
    assert.equal(managementLinks.some((item) => item.view === view), false);
  }
  for (const group of managementGroups) {
    assert.ok(group.label.trim());
    assert.ok(group.links.length);
    for (const link of group.links) assert.ok(link.description.trim());
  }
});
