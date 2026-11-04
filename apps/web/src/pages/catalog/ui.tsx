import { useEffect } from "react";
import {
  RestaurantPreview,
  RestaurantMap,
  RestaurantGridSkeleton,
} from "../../entities/restaurant";
import type { Restaurant } from "../../entities/restaurant";
import { useResource } from "../../shared/api";
import { navigate, useLocationParams } from "../../shared/lib";
import type { Page } from "../../shared/lib";
import { Async, Empty, Pagination, Search } from "../../shared/ui";

const cuisines = [
  "Італійська",
  "Українська",
  "Грецька",
  "Американська",
  "Європейська",
  "Кримськотатарська",
];
export function CatalogPage() {
  const params = useLocationParams(),
    q = params.get("q") ?? "",
    page = params.get("page") ?? "1";
  const map = params.get("display") === "map";
  const resource = useResource<Page<Restaurant>>(
    map ? null : `/restaurants?${new URLSearchParams({ q, page })}`,
  );
  useEffect(() => {
    if (!map && resource.data && Number(page) !== resource.data.page)
      navigate({ page: resource.data.page }, true);
  }, [resource.data, page, map]);
  const search = (value: string) =>
    navigate({ q: value.trim() || null, page: null }, true);
  return (
    <div className={`shop-page shop-catalog${map ? " is-map-view" : ""}`}>
      <header className="shop-page-heading">
        <div>
          {!map && <p className="home-eyebrow">Знайди свій смак</p>}
          <h1 tabIndex={-1}>Заклади Києва</h1>
          <p>
            {map
              ? "Обери заклад на карті або у списку поруч."
              : "Обери заклад, відкрий меню та додай улюблені страви до кошика."}
          </p>
        </div>
        <div
          className="catalog-view-switch"
          role="group"
          aria-label="Вигляд каталогу"
        >
          <button
            type="button"
            aria-pressed={!map}
            onClick={() => navigate({ display: null, page: null })}
          >
            Список
          </button>
          <button
            type="button"
            aria-pressed={map}
            onClick={() => navigate({ display: "map", page: null })}
          >
            Карта
          </button>
        </div>
      </header>
      <div className="shop-catalog-search">
        <Search
          value={q}
          placeholder="Назва закладу або кухня"
          onSearch={search}
          onClear={() => search("")}
        />
      </div>
      <div className="shop-cuisine-filter" role="group" aria-label="Кухня">
        <button type="button" aria-pressed={!q} onClick={() => search("")}>
          Усі заклади
        </button>
        {cuisines.map((cuisine) => (
          <button
            type="button"
            key={cuisine}
            aria-pressed={q === cuisine}
            onClick={() => search(cuisine)}
          >
            {cuisine}
          </button>
        ))}
      </div>
      {map ? (
        <RestaurantMap query={q} />
      ) : (
        <Async
          resource={resource}
          fallback={
            <>
              <div className="shop-results" aria-hidden="true" />
              <RestaurantGridSkeleton />
            </>
          }
        >
          {(data) => (
            <>
              <p className="shop-results" role="status">
                Знайдено закладів: {data.total}
                {q && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => search("")}
                  >
                    Скинути пошук
                  </button>
                )}
              </p>
              {data.items.length ? (
                <div className="home-restaurant-grid">
                  {data.items.map((restaurant) => (
                    <RestaurantPreview
                      key={restaurant.id}
                      restaurant={restaurant}
                    />
                  ))}
                </div>
              ) : (
                <Empty
                  title="Закладів не знайдено"
                  hint="Спробуй іншу назву або кухню"
                  onReset={() => search("")}
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
      )}
    </div>
  );
}
