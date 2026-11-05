import { PageLink } from "../../shared/ui";
import { CatalogPhoto } from "./catalog";
import type { Restaurant } from "./model";
import { money } from "../../shared/lib";
export function RestaurantPreview({
  restaurant,
  searchQuery = "",
  catalogState = "",
}: {
  restaurant: Restaurant;
  searchQuery?: string;
  catalogState?: string;
}) {
  const matches = searchQuery ? (restaurant.matched_dishes ?? []) : [];
  const context: Record<string, string | number> = searchQuery
    ? { catalog_q: searchQuery }
    : {};
  if (catalogState) context.catalog_state = catalogState;
  return (
    <article
      className={`home-restaurant-card${matches.length ? " has-dish-matches" : ""}`}
    >
      <PageLink
        view="menu"
        params={{
          id: restaurant.id,
          ...context,
          ...(matches.length ? { q: searchQuery } : {}),
        }}
        label={`Переглянути меню ${restaurant.name}`}
        className="restaurant-preview-link"
      >
        <CatalogPhoto
          src={restaurant.image_url}
          alt={restaurant.image_alt || restaurant.name}
          variant="restaurant"
        />
        <span className="home-restaurant-body">
          <span className="home-restaurant-cuisine">
            {restaurant.cuisine_type} кухня
          </span>
          <span className="home-restaurant-name">{restaurant.name}</span>
          <span className="home-restaurant-address">{restaurant.address}</span>
          {!restaurant.is_active && (
            <span className="restaurant-inactive">Замовлення вимкнені</span>
          )}
          <span className="home-restaurant-arrow" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <path
                d="M6 18 18 6M6 6h12v12"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </span>
      </PageLink>
      {matches.length > 0 && (
        <div className="restaurant-search-matches">
          <p className="restaurant-match-count">
            Страв за запитом:{" "}
            {restaurant.matched_dishes_count ?? matches.length}
          </p>
          <ul>
            {matches.map((dish) => (
              <li key={dish.id}>
                <PageLink
                  view="menu"
                  params={{ id: restaurant.id, q: dish.name, ...context }}
                  label={`Переглянути ${dish.name} у ${restaurant.name}`}
                  className="restaurant-dish-match"
                >
                  <CatalogPhoto src={dish.image_url} alt="" />
                  <span>
                    <strong>{dish.name}</strong>
                    <span>{money(dish.price)}</span>
                  </span>
                  <span className="restaurant-match-arrow" aria-hidden="true">
                    ↗
                  </span>
                </PageLink>
              </li>
            ))}
          </ul>
          <PageLink
            view="menu"
            params={{ id: restaurant.id, q: searchQuery, ...context }}
            className="restaurant-all-matches"
          >
            Переглянути всі збіги <span aria-hidden="true">→</span>
          </PageLink>
        </div>
      )}
    </article>
  );
}
