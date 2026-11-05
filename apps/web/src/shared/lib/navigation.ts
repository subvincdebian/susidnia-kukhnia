import { useSyncExternalStore } from "react";

function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener);
  return () => window.removeEventListener("popstate", listener);
}
export const useLocationParams = () =>
  new URLSearchParams(
    useSyncExternalStore(subscribe, () => window.location.search),
  );
export function navigate(
  changes: Record<string, string | number | null>,
  replace = false,
) {
  const url = new URL(window.location.href);
  if ("view" in changes) url.hash = "";
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === "") url.searchParams.delete(key);
    else url.searchParams.set(key, String(value));
  }
  history[replace ? "replaceState" : "pushState"]({}, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
export function pageHref(
  view: string,
  params: Record<string, string | number> = {},
) {
  const query = new URLSearchParams();
  if (view !== "home") query.set("view", view);
  for (const [key, value] of Object.entries(params))
    query.set(key, String(value));
  return `${import.meta.env?.BASE_URL ?? "/"}${query.size ? "?" + query.toString() : ""}`;
}
export const isShopView = (view: string) =>
  ["home", "restaurants", "menu", "checkout", "order", "history", "account"].includes(
    view,
  );
export function openPage(
  view: string,
  params: Record<string, string | number> = {},
) {
  navigate({
    view: view === "home" ? null : view,
    id: null,
    q: null,
    catalog_q: null,
    catalog_state: null,
    sort: null,
    max_price: null,
    restaurant_id: null,
    compare: null,
    status: null,
    page: null,
    stage: null,
    query: null,
    from: null,
    to: null,
    display: null,
    next: null,
    ...params,
  });
  window.scrollTo(0, 0);
}
