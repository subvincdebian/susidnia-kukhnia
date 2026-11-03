import { useRef, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { CatalogPhoto, RestaurantPreview } from "../../entities/restaurant";
import type { Restaurant, RestaurantDetail } from "../../entities/restaurant";
import { useResource } from "../../shared/api";
import type { Resource } from "../../shared/api";
import { money, navigate, pageHref } from "../../shared/lib";
import type { Page } from "../../shared/lib";
import { Async, Empty } from "../../shared/ui";
import { featuredDish, featuredRestaurants, heroRestaurants } from "./model";

const cuisines = [
  "Італійська",
  "Українська",
  "Грецька",
  "Американська",
  "Європейська",
];

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path
        d={diagonal ? "M6 18 18 6M6 6h12v12" : "M4 12h16m-6-6 6 6-6 6"}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function openCatalog(query = "") {
  navigate({
    view: "restaurants",
    q: query.trim() || null,
    page: null,
    status: null,
    stage: null,
    query: null,
    from: null,
    to: null,
  });
  window.scrollTo(0, 0);
}

function CatalogLink({
  children,
  query = "",
  className,
}: {
  children: ReactNode;
  query?: string;
  className?: string;
}) {
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.button === 0 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      !event.altKey
    ) {
      event.preventDefault();
      openCatalog(query);
    }
  };
  return (
    <a
      href={pageHref("restaurants", query ? { q: query } : {})}
      onClick={follow}
      className={className}
    >
      {children}
    </a>
  );
}

export function HomePage({ onMenu }: { onMenu: (id: number) => void }) {
  const restaurants = useResource<Page<Restaurant>>("/restaurants?page=1");
  const [first, second, third] = heroRestaurants(restaurants.data?.items ?? []);
  const firstMenu = useResource<RestaurantDetail>(
    first ? `/restaurants/${first.id}` : null,
  );
  const secondMenu = useResource<RestaurantDetail>(
    second ? `/restaurants/${second.id}` : null,
  );
  const thirdMenu = useResource<RestaurantDetail>(
    third ? `/restaurants/${third.id}` : null,
  );
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  return (
    <div className="home-page">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero-copy">
          <p className="home-eyebrow">
            <span aria-hidden="true" />
            Заклади твого міста
          </p>
          <h1 id="home-title">
            Смачне поруч.
            <br />
            <span>Обирай своє.</span>
          </h1>
          <p className="home-intro">
            Обирай страви із закладів Києва.
            Меню, ціни та фото в одному місці.
          </p>
          <form
            className="home-search"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (!composing.current) openCatalog(query);
            }}
          >
            <label htmlFor="home-search" className="sr-only">
              Назва закладу або кухня
            </label>
            <div className="home-search-input">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                aria-hidden="true"
              >
                <circle cx="10.5" cy="10.5" r="6.5" />
                <path d="m16 16 4 4" strokeLinecap="round" />
              </svg>
              <input
                id="home-search"
                ref={searchRef}
                type="search"
                placeholder="Заклад чи кухня"
                maxLength={100}
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                onCompositionStart={() => {
                  composing.current = true;
                }}
                onCompositionEnd={() => {
                  composing.current = false;
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && event.nativeEvent.isComposing)
                    event.preventDefault();
                }}
              />
              {query && (
                <button
                  type="button"
                  className="home-search-clear"
                  aria-label="Очистити пошук"
                  onClick={() => {
                    setQuery("");
                    searchRef.current?.focus();
                  }}
                >
                  ×
                </button>
              )}
            </div>
            <button type="submit" className="primary">
              Знайти <Arrow />
            </button>
          </form>
          <CatalogLink className="home-quiet-link">
            Або переглянути всі заклади <Arrow />
          </CatalogLink>
        </div>
        <div className="home-hero-media" aria-label="Страви з меню закладів">
          {(restaurants.error && !restaurants.data) ||
          (restaurants.data && !first) ? (
            <div className="home-hero-status" role="status">
              <span className="brand-mark" aria-hidden="true">
                ск
              </span>
              <h2>
                {restaurants.error
                  ? "Каталог поки недоступний"
                  : "Доступних закладів поки немає"}
              </h2>
              <p>
                {restaurants.error
                  ? restaurants.error.message
                  : "Переглянь повний каталог або повернися пізніше."}
              </p>
              {restaurants.error ? (
                <button type="button" onClick={restaurants.retry}>
                  Спробувати ще
                </button>
              ) : (
                <CatalogLink className="home-all-link">
                  До каталогу <Arrow />
                </CatalogLink>
              )}
            </div>
          ) : (
            <>
              <HeroFood
                restaurant={first}
                resource={firstMenu}
                preferredName="пепероні"
                variant="main"
                onMenu={onMenu}
              />
              <HeroFood
                restaurant={second}
                resource={secondMenu}
                preferredName="гірос класичний"
                variant="second"
                onMenu={onMenu}
              />
              <HeroFood
                restaurant={third}
                resource={thirdMenu}
                preferredName="тірамісу"
                variant="third"
                onMenu={onMenu}
              />
              <span className="home-photo-note">
                З меню київських закладів
              </span>
            </>
          )}
        </div>
      </section>

      <section className="home-cuisines" aria-labelledby="home-cuisines-title">
        <h2 id="home-cuisines-title">Яка кухня сьогодні?</h2>
        <div className="home-cuisine-links">
          {cuisines.map((cuisine) => (
            <CatalogLink
              key={cuisine}
              query={cuisine}
              className="home-cuisine-link"
            >
              {cuisine}
              <Arrow diagonal />
            </CatalogLink>
          ))}
        </div>
      </section>

      <section
        className="home-restaurants"
        aria-labelledby="home-restaurants-title"
      >
        <div className="home-section-heading">
          <div>
            <h2 id="home-restaurants-title">Що замовиш сьогодні?</h2>
          </div>
          <CatalogLink className="home-all-link">
            Усі заклади <Arrow diagonal />
          </CatalogLink>
        </div>
        <Async resource={restaurants}>
          {(data) => {
            const featured = featuredRestaurants(data.items);
            return featured.length ? (
              <div className="home-restaurant-grid">
                {featured.map((restaurant) => (
                  <RestaurantPreview
                    key={restaurant.id}
                    restaurant={restaurant}
                  />
                ))}
              </div>
            ) : (
              <Empty
                title="Доступних закладів поки немає"
                hint="Перегляньте повний каталог або поверніться пізніше"
              />
            );
          }}
        </Async>
      </section>

    </div>
  );
}

function HeroFood({
  restaurant,
  resource,
  preferredName,
  variant,
  onMenu,
}: {
  restaurant: Restaurant | undefined;
  resource: Resource<RestaurantDetail>;
  preferredName: string;
  variant: "main" | "second" | "third";
  onMenu: (id: number) => void;
}) {
  const dish = featuredDish(resource.data, preferredName);
  const className = `home-food home-food-${variant}`;
  if (!restaurant || (!resource.data && !resource.error))
    return (
      <div
        className={`${className} home-food-placeholder`}
        aria-busy={Boolean(restaurant)}
      >
        <div className="home-food-placeholder-image" aria-hidden="true" />
        <span>{restaurant ? "Завантаження меню..." : "Меню твого міста"}</span>
      </div>
    );
  if (resource.error && !resource.data)
    return (
      <div className={`${className} home-food-error`}>
        <span>{restaurant.name}</span>
        <p>Не вдалося завантажити меню</p>
        <button type="button" onClick={resource.retry}>
          Повторити
        </button>
      </div>
    );
  return (
    <button
      type="button"
      className={className}
      onClick={() => onMenu(restaurant.id)}
      aria-label={`Відкрити меню ${restaurant.name}${dish ? `: ${dish.name}, ${money(dish.price)}` : ""}`}
    >
      <CatalogPhoto
        src={dish?.image_url ?? restaurant.image_url}
        alt={
          dish?.image_alt ||
          dish?.name ||
          restaurant.image_alt ||
          restaurant.name
        }
        variant={dish ? "dish" : "restaurant"}
        priority={variant === "main"}
      />
      <span className="home-food-caption">
        <span className="home-food-restaurant">{restaurant.name}</span>
        <span className="home-food-name">
          {dish?.name ?? "Переглянути меню"}
        </span>
        {dish && <span className="home-food-price">{money(dish.price)}</span>}
        <span className="home-food-arrow" aria-hidden="true">
          <Arrow diagonal />
        </span>
      </span>
    </button>
  );
}
