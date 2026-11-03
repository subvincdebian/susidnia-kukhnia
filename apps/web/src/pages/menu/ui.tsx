import { useEffect } from "react";
import {
  CatalogPhoto,
  DishCatalog,
  RestaurantSources,
} from "../../entities/restaurant";
import type { RestaurantDetail } from "../../entities/restaurant";
import { AddToCart } from "../../features/add-to-cart";
import { CartPanel } from "../../widgets/cart";
import { useResource } from "../../shared/api";
import { Async, Empty, PageLink } from "../../shared/ui";

export function MenuPage({ id }: { id: number | null }) {
  const resource = useResource<RestaurantDetail>(
    id ? `/restaurants/${id}` : null,
  );
  useEffect(() => {
    if (resource.data) document.title = `${resource.data.name} | Сусідня кухня`;
  }, [resource.data]);
  if (!id)
    return (
      <>
        <Empty title="Заклад не знайдено" hint="Обери заклад із каталогу" />
        <PageLink view="restaurants">До закладів</PageLink>
      </>
    );
  return (
    <div className="shop-page menu-page">
      <PageLink view="restaurants" className="shop-back-link">
        ← Усі заклади
      </PageLink>
      <Async resource={resource}>
        {(restaurant) => (
          <>
            <div className="menu-masthead">
              <div className="menu-cover">
                <CatalogPhoto
                  src={restaurant.image_url}
                  alt={restaurant.image_alt || restaurant.name}
                  variant="restaurant"
                  priority
                />
              </div>
              <header className="menu-heading">
                <div>
                  <p className="home-eyebrow">
                    {restaurant.cuisine_type} кухня
                  </p>
                  <h1 tabIndex={-1}>{restaurant.name}</h1>
                  <p className="menu-address">{restaurant.address}</p>
                </div>
              </header>
              <div className="menu-meta">
                <span
                  className={`menu-availability${restaurant.is_active ? "" : " unavailable"}`}
                >
                  {restaurant.is_active
                    ? "Доступний для замовлень"
                    : "Замовлення зараз вимкнені"}
                </span>
                <details className="menu-restaurant-info">
                  <summary>Інформація про заклад</summary>
                  <div>
                    <p>{restaurant.address}</p>
                    <a href={`tel:${restaurant.phone.replace(/[^\d+]/g, "")}`}>
                      {restaurant.phone}
                    </a>
                    <RestaurantSources restaurant={restaurant} />
                  </div>
                </details>
              </div>
            </div>
            <div className="menu-layout">
              <div className="menu-content">
                <h2 className="sr-only">Меню закладу</h2>
                <DishCatalog
                  shop
                  dishes={restaurant.menu}
                  emptyHint="Спробуй обрати інший заклад"
                  renderActions={(dish) => (
                    <AddToCart restaurant={restaurant} dish={dish} />
                  )}
                />
              </div>
              <aside className="menu-cart-sidebar">
                <CartPanel />
              </aside>
            </div>
          </>
        )}
      </Async>
    </div>
  );
}
