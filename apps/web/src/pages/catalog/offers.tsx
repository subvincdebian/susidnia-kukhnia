import { useEffect, useState } from "react";
import {
  compareIds,
  MenuOfferCard,
  MenuOffersSkeleton,
} from "../../entities/restaurant";
import type { MenuOffer, Restaurant } from "../../entities/restaurant";
import { CompareDishes } from "../../features/compare-dishes";
import { useResource } from "../../shared/api";
import { navigate } from "../../shared/lib";
import type { Page } from "../../shared/lib";
import { Async, Empty, Field, Pagination } from "../../shared/ui";

export function OfferResults({ params }: { params: URLSearchParams }) {
  const q = params.get("q") ?? "",
    page = params.get("page") ?? "1",
    sort = params.get("sort") ?? "price_asc",
    budget = params.get("max_price") ?? "",
    restaurant = params.get("restaurant_id") ?? "";
  const selected = compareIds(params.get("compare"));
  const [draft, setDraft] = useState({ budget, restaurant, sort });
  const [error, setError] = useState("");
  useEffect(() => {
    setDraft({ budget, restaurant, sort });
    setError("");
  }, [budget, restaurant, sort]);
  const query = new URLSearchParams({ q, page, sort });
  if (budget) query.set("max_price", budget);
  if (restaurant) query.set("restaurant_id", restaurant);
  const resource = useResource<Page<MenuOffer>>(`/menu?${query}`);
  const venues = useResource<{ items: Restaurant[] }>("/restaurants/map");
  useEffect(() => {
    if (resource.data && Number(page) !== resource.data.page)
      navigate({ page: resource.data.page }, true);
  }, [resource.data, page]);
  const choose = (id: number) => {
    const next = selected.includes(id)
      ? selected.filter((value) => value !== id)
      : selected.length < 3
        ? [...selected, id]
        : selected;
    navigate({ compare: next.join(",") || null }, true);
  };
  const reset = () =>
    navigate(
      { sort: null, max_price: null, restaurant_id: null, page: null },
      true,
    );
  return (
    <div className={`offer-results${selected.length ? " has-comparison" : ""}`}>
      <form
        className="offer-filters"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const budgetInput =
            event.currentTarget.querySelector<HTMLInputElement>(
              '[name="offer-budget"]',
            );
          if (
            budgetInput?.validity.badInput ||
            (draft.budget && !/^\d{1,8}(\.\d{1,2})?$/.test(draft.budget))
          ) {
            setError("Вкажи невід’ємну суму, максимум два знаки після крапки");
            budgetInput?.focus();
            return;
          }
          setError("");
          navigate(
            {
              display: "dishes",
              max_price: draft.budget || null,
              restaurant_id: draft.restaurant || null,
              sort: draft.sort,
              page: null,
            },
            true,
          );
        }}
      >
        <Field
          name="offer-budget"
          label="Бюджет до, грн"
          type="number"
          min={0}
          max={99999999.99}
          step={0.01}
          required={false}
          value={draft.budget}
          error={error}
          onChange={(value) => {
            setDraft((previous) => ({ ...previous, budget: value }));
            setError("");
          }}
        />
        <Field
          name="offer-restaurant"
          label="Заклад"
          required={false}
          value={draft.restaurant}
          onChange={(value) =>
            setDraft((previous) => ({ ...previous, restaurant: value }))
          }
          options={[
            { value: "", label: "Усі заклади" },
            ...(venues.data?.items
              .filter((item) => item.is_active)
              .map((item) => ({ value: item.id, label: item.name })) ?? []),
          ]}
        />
        <Field
          name="offer-sort"
          label="Сортування"
          required={false}
          value={draft.sort}
          onChange={(value) =>
            setDraft((previous) => ({ ...previous, sort: value }))
          }
          options={[
            { value: "price_asc", label: "Від дешевших" },
            { value: "price_desc", label: "Від дорожчих" },
            { value: "name", label: "За назвою страви" },
          ]}
        />
        <button type="submit" className="primary">
          Показати
        </button>
      </form>
      <div className="offer-search-help">
        <p>Обери дві або три страви, щоб порівняти ціни та порції.</p>
        {(budget || restaurant || sort !== "price_asc") && (
          <button type="button" className="text-button" onClick={reset}>
            Скинути фільтри
          </button>
        )}
      </div>
      {venues.error && (
        <p className="small">
          Список закладів не завантажився.{" "}
          <button type="button" className="text-button" onClick={venues.retry}>
            Повторити
          </button>
        </p>
      )}
      <Async resource={resource} fallback={<MenuOffersSkeleton />}>
        {(data) => (
          <>
            <p className="shop-results" role="status">
              Знайдено страв: {data.total}
            </p>
            {data.items.length ? (
              <div className="dish-grid offer-grid">
                {data.items.map((offer) => (
                  <MenuOfferCard
                    key={offer.id}
                    offer={offer}
                    catalogState={params.toString()}
                  >
                    <button
                      type="button"
                      className="offer-compare-choice"
                      aria-pressed={selected.includes(offer.id)}
                      aria-label={`${selected.includes(offer.id) ? "У порівнянні" : "Порівняти"}: ${offer.name}, ${offer.restaurant_name}`}
                      disabled={
                        selected.length >= 3 && !selected.includes(offer.id)
                      }
                      onClick={() => choose(offer.id)}
                    >
                      {selected.includes(offer.id)
                        ? "У порівнянні"
                        : "Порівняти"}
                    </button>
                  </MenuOfferCard>
                ))}
              </div>
            ) : (
              <Empty
                title="Страв не знайдено"
                hint="Зміни запит або збільш бюджет."
                onReset={
                  budget || restaurant || sort !== "price_asc"
                    ? reset
                    : () =>
                        navigate(
                          { q: null, page: null, display: "dishes" },
                          true,
                        )
                }
              />
            )}
            <Pagination
              data={data}
              onPage={(value) => {
                navigate({ page: value });
                window.scrollTo(0, 0);
              }}
            />
          </>
        )}
      </Async>
      <CompareDishes
        ids={selected}
        catalogState={params.toString()}
        onRemove={choose}
        onClear={() => navigate({ compare: null }, true)}
      />
    </div>
  );
}
