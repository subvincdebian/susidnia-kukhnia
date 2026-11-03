import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Dish, Restaurant } from "./model";
import { assetHref, money } from "../../shared/lib";
import { Empty, Field } from "../../shared/ui";

function officialUrl(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function CatalogPhoto({
  src,
  alt,
  variant = "dish",
  priority = false,
}: {
  src?: string | null;
  alt: string;
  variant?: "dish" | "restaurant";
  priority?: boolean;
}) {
  const localSrc =
    src?.startsWith("/media/catalog/") && !src.includes("..") ? src : null;
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const available = localSrc && failedSource !== localSrc;
  return (
    <div className={`catalog-photo catalog-photo-${variant}`}>
      {available ? (
        <img
          src={assetHref(localSrc)}
          alt={alt}
          width={variant === "restaurant" ? 640 : 480}
          height={variant === "restaurant" ? 360 : 320}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : undefined}
          decoding="async"
          onError={() => setFailedSource(localSrc)}
        />
      ) : (
        <div className="catalog-photo-fallback">
          <svg
            viewBox="0 0 32 32"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path
              d="M5 21h22M8 21a8 8 0 0 1 16 0M16 10V7m-2 0h4M4 25h24"
              strokeLinecap="round"
            />
          </svg>
          <span>Фото ще немає</span>
        </div>
      )}
    </div>
  );
}

export function RestaurantSources({
  restaurant,
  compact = false,
}: {
  restaurant: Restaurant;
  compact?: boolean;
}) {
  const website = officialUrl(restaurant.website_url),
    menu = officialUrl(restaurant.menu_url);
  const checked = restaurant.source_checked_at
    ? new Date(restaurant.source_checked_at)
    : null;
  const date =
    checked && Number.isFinite(checked.getTime())
      ? new Intl.DateTimeFormat("uk-UA", {
          dateStyle: "short",
          timeZone: "Europe/Kyiv",
        }).format(checked)
      : null;
  const note = !compact ? restaurant.source_note?.trim() : null;
  if (!website && !menu && !date && !note) return null;
  return (
    <div
      className={`catalog-sources ${compact ? "catalog-sources-compact" : ""}`}
    >
      <div className="catalog-source-links">
        {website && (
          <a href={website} target="_blank" rel="noopener noreferrer">
            Офіційний сайт<span className="sr-only"> (нова вкладка)</span>
          </a>
        )}
        {menu && (
          <a href={menu} target="_blank" rel="noopener noreferrer">
            Повне меню закладу<span className="sr-only"> (нова вкладка)</span>
          </a>
        )}
      </div>
      {date && (
        <p>
          Ціни звірено{" "}
          <time dateTime={restaurant.source_checked_at ?? undefined}>
            {date}
          </time>
        </p>
      )}
      {note && <p>{note}</p>}
    </div>
  );
}

export function DishCatalog({
  dishes,
  renderActions,
  resetFiltersKey = 0,
  emptyHint = "Додайте першу страву",
  shop = false,
}: {
  dishes: Dish[];
  renderActions: (dish: Dish) => ReactNode;
  resetFiltersKey?: number;
  emptyHint?: string;
  shop?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const id = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setQuery("");
    setCategory("");
  }, [resetFiltersKey]);
  const categories = [
    ...new Set(dishes.map((dish) => dish.category || "Інше")),
  ];
  const needle = query.trim().toLocaleLowerCase("uk-UA");
  const filtered = dishes.filter(
    (dish) =>
      (!category || (dish.category || "Інше") === category) &&
      (!needle ||
        `${dish.name} ${dish.description ?? ""} ${dish.category}`
          .toLocaleLowerCase("uk-UA")
          .includes(needle)),
  );
  const groups = categories
    .map((name) => ({
      name,
      dishes: filtered.filter((dish) => (dish.category || "Інше") === name),
    }))
    .filter((group) => group.dishes.length);
  const clear = () => {
    setQuery("");
    setCategory("");
    searchRef.current?.focus();
  };
  if (!dishes.length)
    return <Empty title="Страв поки немає" hint={emptyHint} />;
  return (
    <div className="dish-catalog">
      <div
        className="catalog-toolbar"
        onChange={(event) => event.stopPropagation()}
      >
        <div className="catalog-search">
          <label htmlFor={`${id}-search`}>Пошук у меню</label>
          <div className="catalog-search-control">
            <input
              ref={searchRef}
              id={`${id}-search`}
              type="search"
              value={query}
              placeholder="Назва або склад страви"
              maxLength={100}
              onChange={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.preventDefault();
              }}
            />
            {query && (
              <button
                type="button"
                aria-label="Очистити пошук у меню"
                onClick={() => {
                  setQuery("");
                  searchRef.current?.focus();
                }}
              >
                ×
              </button>
            )}
          </div>
        </div>
        {!shop && (
          <Field
            name={`${id}-category`}
            label="Категорія"
            required={false}
            value={category}
            options={[
              { value: "", label: "Усі категорії" },
              ...categories.map((name) => ({ value: name, label: name })),
            ]}
            onChange={setCategory}
          />
        )}
      </div>
      {shop && (
        <nav className="menu-category-nav" aria-label="Категорії меню">
          {["", ...categories].map((name) => (
            <button
              type="button"
              key={name}
              aria-pressed={category === name}
              onClick={() => setCategory(name)}
            >
              {name || "Усе меню"}
            </button>
          ))}
        </nav>
      )}
      {(!shop || query) && (
        <p className="catalog-result-count" role="status">
          Показано {filtered.length} із {dishes.length} позицій
          {(query || category) && (
            <button type="button" className="text-button" onClick={clear}>
              Скинути фільтри
            </button>
          )}
        </p>
      )}
      {groups.length ? (
        groups.map((group) => (
          <section className="dish-category" key={group.name}>
            <h3 className="dish-category-title">
              {group.name}
              <span>{group.dishes.length}</span>
            </h3>
            <div className="dish-grid">
              {group.dishes.map((dish) => (
                <DishCard key={dish.id} dish={dish} shop={shop}>
                  {renderActions(dish)}
                </DishCard>
              ))}
            </div>
          </section>
        ))
      ) : (
        <Empty
          title="Страв не знайдено"
          hint="Спробуйте іншу назву або категорію"
          onReset={clear}
        />
      )}
    </div>
  );
}

function DishCard({
  dish,
  children,
  shop = false,
}: {
  dish: Dish;
  children: ReactNode;
  shop?: boolean;
}) {
  const source = officialUrl(dish.source_url);
  return (
    <article className={`dish-card${shop ? " shop-dish-card" : ""}`}>
      <CatalogPhoto
        src={dish.image_url}
        alt={dish.image_alt?.trim() || dish.name}
      />
      <div className="dish-card-body">
        <div className="dish-card-heading">
          <h4>{dish.name}</h4>
          {dish.portion && <span className="dish-portion">{dish.portion}</span>}
        </div>
        {dish.description && (
          <p className="dish-description">{dish.description}</p>
        )}
        {!shop && (
          <div className="dish-card-meta">
            <span className="price">{money(dish.price)}</span>
            {!dish.is_available && (
              <span className="status">Недоступна в каталозі</span>
            )}
          </div>
        )}
        {source && !shop && (
          <a
            className="dish-source"
            href={source}
            target="_blank"
            rel="noopener noreferrer"
          >
            Страва в офіційному меню
            <span className="sr-only"> (нова вкладка)</span>
          </a>
        )}
        {shop ? (
          <>
            {(source || dish.description) && (
              <details className="dish-info">
                <summary>Про страву</summary>
                {dish.description && <p>{dish.description}</p>}
                {source && (
                  <a href={source} target="_blank" rel="noopener noreferrer">
                    В офіційному меню
                    <span className="sr-only"> (нова вкладка)</span>
                  </a>
                )}
              </details>
            )}
            <div className="dish-shop-purchase">
              <span className="price">{money(dish.price)}</span>
              <div className="dish-card-actions">{children}</div>
            </div>
            {!dish.is_available && (
              <span className="cart-unavailable-label">Зараз недоступна</span>
            )}
          </>
        ) : (
          <div className="dish-card-actions">{children}</div>
        )}
      </div>
    </article>
  );
}
