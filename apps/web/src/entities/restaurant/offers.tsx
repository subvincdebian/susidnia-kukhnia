import type { ReactNode } from "react";
import type { MenuOffer } from "./model";
import { CatalogPhoto } from "./catalog";
import { money } from "../../shared/lib";
import { PageLink, Skeleton } from "../../shared/ui";

export function MenuOfferCard({
  offer,
  catalogState,
  children,
}: {
  offer: MenuOffer;
  catalogState: string;
  children: ReactNode;
}) {
  const target = {
    id: offer.restaurant_id,
    q: offer.name,
    catalog_state: catalogState,
  };
  return (
    <article className="dish-card shop-dish-card offer-card">
      <PageLink
        view="menu"
        params={target}
        label={`Переглянути ${offer.name} у ${offer.restaurant_name}`}
        className="offer-photo-link"
      >
        <CatalogPhoto
          src={offer.image_url}
          alt={offer.image_alt || offer.name}
        />
      </PageLink>
      <div className="dish-card-body">
        <p className="offer-restaurant">{offer.restaurant_name}</p>
        <h2>
          <PageLink view="menu" params={target}>
            {offer.name}
          </PageLink>
        </h2>
        <p className="offer-category">{offer.category}</p>
        <div className="offer-price">
          <strong>{money(offer.price)}</strong>
          <span>{offer.portion || "Порція не вказана в меню"}</span>
        </div>
        <div className="offer-actions">
          {children}
          <PageLink view="menu" params={target}>
            До меню <span aria-hidden="true">→</span>
          </PageLink>
        </div>
      </div>
    </article>
  );
}

export function MenuOffersSkeleton() {
  return (
    <div className="dish-grid offer-grid" aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => (
        <div className="dish-card shop-dish-card" key={index}>
          <Skeleton className="catalog-photo catalog-photo-dish" />
          <div className="dish-card-body skeleton-stack">
            <Skeleton className="skeleton-eyebrow" />
            <Skeleton className="skeleton-heading" />
            <Skeleton className="skeleton-description" />
            <Skeleton className="skeleton-price" />
            <Skeleton className="skeleton-control" />
          </div>
        </div>
      ))}
    </div>
  );
}
