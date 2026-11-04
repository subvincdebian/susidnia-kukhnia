import { Skeleton } from "../../shared/ui";

export function RestaurantGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="home-restaurant-grid" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div className="home-restaurant-card restaurant-skeleton" key={index}>
          <Skeleton className="catalog-photo catalog-photo-restaurant" />
          <div className="home-restaurant-body skeleton-stack">
            <Skeleton className="skeleton-eyebrow" />
            <Skeleton className="skeleton-heading" />
            <Skeleton className="skeleton-address" />
            <Skeleton className="home-restaurant-arrow skeleton-circle" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function MenuSkeleton() {
  return (
    <div className="menu-skeleton" aria-hidden="true">
      <div className="menu-masthead">
        <div className="menu-cover">
          <Skeleton className="catalog-photo catalog-photo-restaurant" />
        </div>
        <div className="menu-heading skeleton-stack">
          <Skeleton className="skeleton-eyebrow" />
          <Skeleton className="skeleton-menu-title" />
          <Skeleton className="skeleton-description" />
        </div>
        <div className="menu-meta">
          <Skeleton className="skeleton-pill" />
          <Skeleton className="skeleton-description" />
        </div>
      </div>
      <div className="menu-layout">
        <div className="menu-content">
          <div className="menu-search-skeleton skeleton-stack">
            <Skeleton className="skeleton-eyebrow" />
            <Skeleton className="skeleton-control" />
            <div className="skeleton-chips">
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton className="skeleton-pill" key={index} />
              ))}
            </div>
          </div>
          <Skeleton className="skeleton-heading skeleton-category" />
          <div className="dish-grid">
            {Array.from({ length: 4 }, (_, index) => (
              <div className="dish-card shop-dish-card" key={index}>
                <Skeleton className="catalog-photo catalog-photo-dish" />
                <div className="dish-card-body skeleton-stack">
                  <Skeleton className="skeleton-heading" />
                  <Skeleton />
                  <Skeleton className="skeleton-description" />
                  <div className="dish-shop-purchase">
                    <Skeleton className="skeleton-price" />
                    <Skeleton className="skeleton-add" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="menu-cart-sidebar menu-cart-skeleton skeleton-stack">
          <Skeleton className="skeleton-heading" />
          <Skeleton />
          <Skeleton className="skeleton-description" />
          <Skeleton className="skeleton-control" />
        </div>
      </div>
    </div>
  );
}
