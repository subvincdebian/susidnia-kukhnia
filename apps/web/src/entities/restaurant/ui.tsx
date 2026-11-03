import type { Restaurant } from "./model";
import { CatalogPhoto, RestaurantSources } from "./catalog";
export function RestaurantCard({
  restaurant: r,
  onEdit,
  onMenu,
}: {
  restaurant: Restaurant;
  onEdit: () => void;
  onMenu: () => void;
}) {
  return (
    <article className="restaurant-card">
      <CatalogPhoto
        src={r.image_url}
        alt={r.image_alt?.trim() || r.name}
        variant="restaurant"
      />
      <div className="card-top">
        <div>
          <h2>{r.name}</h2>
          <span className="cuisine">{r.cuisine_type} кухня</span>
        </div>
      </div>
      <div className="card-details">
        <p>{r.address}</p>
        <p>
          <a href={`tel:${r.phone}`}>{r.phone}</a>
        </p>
        <div>
          <span className={`status ${r.is_active ? "green" : ""}`}>
            {r.is_active ? "Доступний у каталозі" : "Недоступний у каталозі"}
          </span>
        </div>
        <p>
          Позицій у меню: {r.dishes_count} ·{" "}
          {r.review_rating
            ? `Оцінка відгуків ${r.review_rating} / 5`
            : "Відгуків ще немає"}
        </p>
        <RestaurantSources restaurant={r} compact />
      </div>
      <div className="card-bottom">
        <button onClick={onEdit} className="text-button">
          Редагувати
        </button>
        <button onClick={onMenu}>Керувати меню</button>
      </div>
    </article>
  );
}
