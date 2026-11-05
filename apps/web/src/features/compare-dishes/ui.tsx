import { useEffect, useState } from "react";
import { CatalogPhoto, officialUrl } from "../../entities/restaurant";
import type { MenuOffer } from "../../entities/restaurant";
import { useResource } from "../../shared/api";
import { money } from "../../shared/lib";
import type { Page } from "../../shared/lib";
import { Async, Empty, Modal, PageLink } from "../../shared/ui";
import { portionPrice } from "./model";

export function CompareDishes({
  ids,
  onRemove,
  onClear,
  catalogState,
}: {
  ids: number[];
  onRemove: (id: number) => void;
  onClear: () => void;
  catalogState: string;
}) {
  const [open, setOpen] = useState(false);
  const signature = ids.join(",");
  const resource = useResource<Page<MenuOffer>>(
    ids.length ? `/menu?${new URLSearchParams({ ids: signature })}` : null,
  );
  useEffect(() => {
    if (ids.length < 2) setOpen(false);
  }, [ids.length]);
  if (!ids.length) return null;
  const offers = resource.data?.items ?? [];
  return (
    <>
      <aside
        className="offer-compare-tray"
        aria-label="Обрані страви для порівняння"
      >
        <div className="offer-compare-summary">
          <strong>Обрано {ids.length}/3</strong>
          <span role="status">
            {resource.loading
              ? "Оновлення цін..."
              : resource.error
                ? "Не вдалося оновити ціни"
                : offers.length < ids.length
                  ? "Є недоступні позиції"
                  : ids.length < 2
                    ? "Додай ще одну"
                    : "До 3 страв"}
          </span>
        </div>
        <ul>
          {ids.map((id) => {
            const offer = offers.find((item) => item.id === id);
            return (
              <li key={id}>
                <span>
                  <strong>
                    {offer?.restaurant_name ||
                      (resource.loading
                        ? "Завантаження..."
                        : "Недоступна позиція")}
                  </strong>
                  <span>{offer?.name || `Позиція ${id}`}</span>
                </span>
                <button
                  type="button"
                  aria-label={`Прибрати ${offer ? `${offer.name}, ${offer.restaurant_name}` : `позицію ${id}`} з порівняння`}
                  onClick={() => onRemove(id)}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
        <div className="offer-compare-tray-actions">
          {resource.error && (
            <button type="button" onClick={resource.retry}>
              Повторити
            </button>
          )}
          <button
            type="button"
            className="primary"
            onClick={() => setOpen(true)}
            disabled={
              offers.length < 2 || resource.loading || Boolean(resource.error)
            }
          >
            Порівняти
          </button>
          <button type="button" className="text-button" onClick={onClear}>
            Очистити
          </button>
        </div>
      </aside>
      {open && (
        <Modal
          title="Порівняння страв"
          resetKey={signature}
          onClose={() => setOpen(false)}
        >
          <Async resource={resource}>
            {(data) => (
              <DishComparison
                offers={data.items}
                catalogState={catalogState}
                updating={resource.loading}
              />
            )}
          </Async>
        </Modal>
      )}
    </>
  );
}

export function DishComparison({
  offers,
  catalogState,
  updating = false,
}: {
  offers: MenuOffer[];
  catalogState: string;
  updating?: boolean;
}) {
  if (offers.length < 2)
    return (
      <Empty
        title="Недостатньо доступних страв"
        hint="Прибери недоступні позиції та обери інші."
      />
    );
  const date = (value: string | null) =>
    value && Number.isFinite(Date.parse(value))
      ? new Intl.DateTimeFormat("uk-UA", {
          dateStyle: "short",
          timeZone: "Europe/Kyiv",
        }).format(new Date(value))
      : "Не вказана";
  return (
    <section className="dish-comparison" aria-label="Ціни та порції">
      <p className="comparison-note">
        Звір назву, порцію та склад. Схожі назви можуть означати різні рецепти.
        Доставка й додатки не враховані.
      </p>
      {updating && <p role="status">Оновлення цін...</p>}
      <p className="comparison-scroll-hint">
        Прокрути таблицю, щоб побачити всі страви.
      </p>
      <div
        className="comparison-scroll"
        role="region"
        aria-label="Таблиця порівняння страв"
        tabIndex={0}
      >
        <table>
          <caption className="sr-only">
            Порівняння цін, порцій і складу обраних страв
          </caption>
          <thead>
            <tr>
              <th scope="col">Страва</th>
              {offers.map((offer) => (
                <th scope="col" key={offer.id}>
                  <CatalogPhoto src={offer.image_url} alt="" />
                  <h3>{offer.name}</h3>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Заклад</th>
              {offers.map((offer) => (
                <td key={offer.id}>
                  <strong>{offer.restaurant_name}</strong>
                  <p>{offer.restaurant_address}</p>
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">Категорія</th>
              {offers.map((offer) => (
                <td key={offer.id}>{offer.category}</td>
              ))}
            </tr>
            <tr className="comparison-price-row">
              <th scope="row">Ціна порції</th>
              {offers.map((offer) => (
                <td key={offer.id}>{money(offer.price)}</td>
              ))}
            </tr>
            <tr>
              <th scope="row">Порція</th>
              {offers.map((offer) => (
                <td key={offer.id}>{offer.portion || "Не вказана в меню"}</td>
              ))}
            </tr>
            <tr>
              <th scope="row">На 100 г / мл</th>
              {offers.map((offer) => {
                const unit = portionPrice(offer.price, offer.portion);
                return (
                  <td key={offer.id}>
                    {unit
                      ? `${unit.price < 0.01 ? "< " + money(0.01) : money(unit.price)} / 100 ${unit.unit}`
                      : "Не розраховано"}
                  </td>
                );
              })}
            </tr>
            <tr>
              <th scope="row">Склад</th>
              {offers.map((offer) => (
                <td key={offer.id}>
                  {offer.description || "Не вказаний у меню"}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">Джерело ціни</th>
              {offers.map((offer) => {
                const source = officialUrl(
                  offer.source_url ?? offer.restaurant_menu_url,
                );
                return (
                  <td key={offer.id}>
                    {source ? (
                      <a
                        href={source}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Меню закладу
                        <span className="sr-only"> (нова вкладка)</span>
                      </a>
                    ) : (
                      "Не вказане"
                    )}
                    <p>Звірено: {date(offer.source_checked_at)}</p>
                    {offer.source_note && (
                      <details>
                        <summary>Про ціну</summary>
                        <p>{offer.source_note}</p>
                      </details>
                    )}
                  </td>
                );
              })}
            </tr>
            <tr>
              <th scope="row">
                <span className="sr-only">Перейти до меню</span>
              </th>
              {offers.map((offer) => (
                <td key={offer.id}>
                  <PageLink
                    view="menu"
                    params={{
                      id: offer.restaurant_id,
                      q: offer.name,
                      catalog_state: catalogState,
                    }}
                  >
                    Обрати в меню →
                  </PageLink>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="comparison-footnote">
        За 100 г або 100 мл рахуємо лише для однозначно вказаної ваги чи об’єму.
        Для складених порцій і описів варіанта розрахунок не робимо.
      </p>
    </section>
  );
}
