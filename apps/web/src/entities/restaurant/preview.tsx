import { PageLink } from "../../shared/ui";
import { CatalogPhoto } from "./catalog";
import type { Restaurant } from "./model";
export function RestaurantPreview({ restaurant }: { restaurant: Restaurant }) {
  return (
    <article className="home-restaurant-card">
      <PageLink
        view="menu"
        params={{ id: restaurant.id }}
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
    </article>
  );
}
