import { useEffect } from "react";
import { RestaurantCard } from "../../entities/restaurant";
import type { Page } from "../../shared/lib";
import type { Restaurant } from "../../entities/restaurant";
import type { DialogState } from "../../widgets/workspace-dialog";
import { useResource } from "../../shared/api";
import { navigate, useLocationParams } from "../../shared/lib";
import { Async, Empty, Heading, Pagination, Search } from "../../shared/ui";

export function RestaurantsPage({
  onDialog,
}: {
  onDialog: (state: DialogState) => void;
}) {
  const params = useLocationParams(),
    q = params.get("q") ?? "",
    page = params.get("page") ?? "1";
  const resource = useResource<Page<Restaurant>>(
    `/restaurants?${new URLSearchParams({ q, page })}`,
  );
  useEffect(() => {
    if (resource.data && Number(page) !== resource.data.page)
      navigate({ page: resource.data.page }, true);
  }, [resource.data, page]);
  const reset = () => navigate({ q: null, page: null }, true);
  return (
    <>
      <Heading
        title="Заклади й меню"
        description="Контакти закладів, страви, ціни та доступність у каталозі."
      >
        <button
          className="primary"
          onClick={() => onDialog({ type: "restaurant" })}
        >
          Додати заклад
        </button>
      </Heading>
      <div className="toolbar">
        <Search
          value={q}
          placeholder="Назва закладу або кухня"
          onSearch={(value) => navigate({ q: value, page: null }, true)}
          onClear={reset}
        />
      </div>
      <Async resource={resource}>
        {(data) => (
          <>
            <div className="result-info" role="status">
              Знайдено закладів: {data.total}
            </div>
            {data.items.length ? (
              <div className="grid">
                {data.items.map((restaurant) => (
                  <RestaurantCard
                    key={restaurant.id}
                    restaurant={restaurant}
                    onEdit={() =>
                      onDialog({ type: "restaurant", id: restaurant.id })
                    }
                    onMenu={() => onDialog({ type: "menu", id: restaurant.id })}
                  />
                ))}
              </div>
            ) : (
              <Empty
                title="Закладів не знайдено"
                hint="Спробуйте іншу назву або кухню"
                onReset={reset}
              />
            )}
            <Pagination
              data={data}
              onPage={(value) => navigate({ page: value })}
            />
          </>
        )}
      </Async>
    </>
  );
}
