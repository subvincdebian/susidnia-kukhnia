import { useMemo, useState } from "react";
import { useResource } from "../../shared/api";
import { geoPoint, navigationUrl } from "../../shared/lib";
import { Async, Empty, MapCanvas, PageLink } from "../../shared/ui";
import type { MapPin } from "../../shared/ui";
import type { Restaurant } from "./model";
import { CatalogPhoto } from "./catalog";

interface MapCatalog {
  items: Restaurant[];
  total: number;
  missing_coordinates: number;
  truncated: boolean;
}
export function RestaurantMap({ query }: { query: string }) {
  const resource = useResource<MapCatalog>("/restaurants/map");
  return (
    <Async resource={resource}>
      {(data) => <MapCatalogContent data={data} query={query} />}
    </Async>
  );
}
function MapCatalogContent({
  data,
  query,
}: {
  data: MapCatalog;
  query: string;
}) {
  const [selectedId, select] = useState<number | null>(null);
  const [fit, setFit] = useState(0);
  const items = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("uk-UA");
    return data.items.filter((item) =>
      `${item.name} ${item.cuisine_type}`
        .toLocaleLowerCase("uk-UA")
        .includes(needle),
    );
  }, [data.items, query]);
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const selectedPoint = selected
    ? geoPoint(selected.latitude, selected.longitude)
    : null;
  const pins = useMemo<MapPin[]>(
    () =>
      items.flatMap((item) => {
        const point = geoPoint(item.latitude, item.longitude);
        return point
          ? [
              {
                ...point,
                id: String(item.id),
                label: `${item.name}, ${item.address}`,
                kind: "restaurant",
                muted: !item.is_active,
                selected: selectedId === item.id,
              },
            ]
          : [];
      }),
    [items, selectedId],
  );
  if (!items.length)
    return (
      <Empty
        title="Закладів не знайдено"
        hint="Зміни назву або кухню в пошуку"
      />
    );
  return (
    <div className="restaurant-map-layout">
      <section className="restaurant-map-main" aria-label="Карта закладів">
        <div className="restaurant-map-bar">
          <p>
            Закладів на карті: <strong>{pins.length}</strong>
          </p>
          <button
            type="button"
            onClick={() => {
              select(null);
              setFit((value) => value + 1);
            }}
          >
            Показати всі
          </button>
        </div>
        <MapCanvas
          label="Заклади Києва на карті"
          pins={pins}
          fitKey={`${query}:${fit}:${pins.length}`}
          center={selectedPoint}
          onSelect={(id) => select(Number(id))}
        />
        {selected && (
          <div className="map-restaurant-detail">
            <div>
              <h2>{selected.name}</h2>
              <p>{selected.address}</p>
              <a href={`tel:${selected.phone}`}>{selected.phone}</a>
            </div>
            <div className="actions">
              <PageLink
                view="menu"
                params={{ id: selected.id }}
                className="map-menu-link"
              >
                Відкрити меню
              </PageLink>
              {selectedPoint && (
                <a
                  href={navigationUrl(selectedPoint)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Маршрут ↗
                </a>
              )}
            </div>
            {!selected.is_active && (
              <p className="small">
                Замовлення з цього закладу вимкнені в каталозі.
              </p>
            )}
          </div>
        )}
        {data.missing_coordinates > 0 && (
          <p className="small">
            Для {data.missing_coordinates} закладів ще не вказано точку. Їхні
            адреси доступні у списку.
          </p>
        )}
        {data.truncated && (
          <p className="small">
            Карта показує перші 500 закладів. Повний каталог доступний у списку.
          </p>
        )}
      </section>
      <aside className="restaurant-map-list" aria-label="Заклади на карті">
        <h2>Обери заклад</h2>
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                aria-pressed={item.id === selectedId}
                onClick={() => select(item.id)}
              >
                <CatalogPhoto
                  src={item.image_url}
                  alt={item.image_alt || item.name}
                  variant="restaurant"
                />
                <span>
                  <strong>{item.name}</strong>
                  <span>{item.address}</span>
                  <small>
                    {item.is_active
                      ? `${item.cuisine_type} кухня`
                      : "Замовлення вимкнені"}
                  </small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
