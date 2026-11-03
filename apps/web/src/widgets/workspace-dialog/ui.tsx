import type { RestaurantDetail } from "../../entities/restaurant";
import {
  CatalogPhoto,
  DishCatalog,
  RestaurantSources,
} from "../../entities/restaurant";
import type { Courier } from "../../entities/courier";
import { CourierManage } from "../../features/courier-manage";
import type { Review } from "../../entities/review";
import { RestaurantEditor } from "../../features/restaurant-editor";
import { DishEditor } from "../../features/dish-editor";
import { CustomerCreate } from "../../features/customer-create";
import { CourierEditor } from "../../features/courier-editor";
import { OrderCreate } from "../../features/order-create";
import { OrderManage } from "../../features/order-manage";
import { DeliveryTracking } from "../../features/delivery-tracking";
import { ReviewEditor } from "../../features/review-editor";
import { ReviewDelete } from "../../features/review-delete";
import { useResource } from "../../shared/api";
import { navigate } from "../../shared/lib";
import { Async, Modal, useNotify } from "../../shared/ui";

export type DialogState =
  | { type: "menu"; id: number }
  | { type: "restaurant"; id?: number }
  | { type: "dish"; restaurantId: number; id?: number }
  | { type: "customer"; returnToOrder?: number }
  | { type: "courier"; courier?: Courier }
  | { type: "courier-action"; courier: Courier; action: "remove" | "restore" }
  | { type: "new-order"; restaurantId?: number }
  | { type: "order"; id: number }
  | { type: "review"; review?: Review; orderId?: number }
  | { type: "delete-review"; review: Review };
const title = (state: DialogState) => {
  switch (state.type) {
    case "menu":
      return "Керування меню";
    case "restaurant":
      return state.id ? "Редагування закладу" : "Новий заклад";
    case "dish":
      return state.id ? "Редагування страви" : "Нова страва";
    case "customer":
      return "Новий клієнт";
    case "courier":
      return state.courier ? "Редагування кур'єра" : "Новий кур'єр";
    case "courier-action":
      return state.action === "restore" ? "Відновлення кур’єра" : state.courier.orders_count ? "Деактивація кур’єра" : "Видалення кур’єра";
    case "new-order":
      return "Нове замовлення";
    case "order":
      return `Замовлення № ${state.id}`;
    case "review":
      return state.review ? "Редагування відгуку" : "Новий відгук";
    case "delete-review":
      return "Видалити відгук";
  }
};
export function WorkspaceDialog({
  state,
  onChange,
  onClose,
}: {
  state: DialogState;
  onChange: (state: DialogState) => void;
  onClose: () => void;
}) {
  const notify = useNotify();
  const saved = (message: string, next?: DialogState) => {
    notify(
      message +
        (new URLSearchParams(location.search).get("q")
          ? ". Список показано з поточним пошуком"
          : ""),
    );
    if (next) onChange(next);
    else onClose();
  };
  let body;
  switch (state.type) {
    case "menu":
      body = <RestaurantMenu id={state.id} onChange={onChange} />;
      break;
    case "restaurant":
      body = (
        <RestaurantEditor
          id={state.id}
          onSaved={() => saved("Заклад збережено")}
        />
      );
      break;
    case "dish":
      body = (
        <DishEditor
          id={state.id}
          restaurantId={state.restaurantId}
          onSaved={() =>
            saved("Страву збережено", { type: "menu", id: state.restaurantId })
          }
        />
      );
      break;
    case "customer":
      body = (
        <CustomerCreate
          onSaved={() =>
            saved(
              "Клієнта додано",
              state.returnToOrder === undefined
                ? undefined
                : {
                    type: "new-order",
                    restaurantId: state.returnToOrder || undefined,
                  },
            )
          }
        />
      );
      break;
    case "courier":
      body = <CourierEditor courier={state.courier} onSaved={() => saved(state.courier ? "Дані кур'єра збережено" : "Кур'єра додано")} />;
      break;
    case "courier-action":
      body = <CourierManage courier={state.courier} action={state.action} onSaved={(message) => saved(message)} />;
      break;
    case "new-order":
      body = (
        <OrderCreate
          restaurantId={state.restaurantId}
          onCustomer={() =>
            onChange({
              type: "customer",
              returnToOrder: state.restaurantId ?? 0,
            })
          }
          onSaved={(id) => {
            navigate({ view: "orders", q: null, status: null, page: null });
            saved("Замовлення оформлено", { type: "order", id });
          }}
        />
      );
      break;
    case "order":
      body = (
        <OrderManage
          id={state.id}
          onReview={(orderId) => onChange({ type: "review", orderId })}
          renderDelivery={(order) => <DeliveryTracking order={order} mode="operator" />}
        />
      );
      break;
    case "review":
      body = (
        <ReviewEditor
          review={state.review}
          orderId={state.orderId}
          onSaved={() => saved("Відгук збережено")}
        />
      );
      break;
    case "delete-review":
      body = (
        <ReviewDelete
          review={state.review}
          onSaved={() => saved("Відгук видалено")}
        />
      );
      break;
  }
  const key =
    state.type +
    ("courier" in state
      ? (state.courier?.id ?? "")
      : "id" in state
      ? (state.id ?? "")
      : "review" in state
        ? (state.review?.id ?? "")
        : "restaurantId" in state
          ? (state.restaurantId ?? "")
          : "");
  return (
    <Modal
      title={title(state)}
      resetKey={key}
      onClose={onClose}
    >
      <div key={key}>{body}</div>
    </Modal>
  );
}
function RestaurantMenu({
  id,
  onChange,
}: {
  id: number;
  onChange: (state: DialogState) => void;
}) {
  const resource = useResource<RestaurantDetail>(`/restaurants/${id}`);
  return (
    <Async resource={resource}>
      {(restaurant) => (
        <>
          <div className="menu-restaurant-heading">
            <CatalogPhoto
              src={restaurant.image_url}
              alt={restaurant.image_alt?.trim() || restaurant.name}
              variant="restaurant"
            />
            <div>
              <h3>{restaurant.name}</h3>
              <p className="muted">
                {restaurant.cuisine_type} кухня · {restaurant.address}
                <br />
                  <a href={`tel:${restaurant.phone}`}>{restaurant.phone}</a>
              </p>
              <span className={`status ${restaurant.is_active ? "green" : ""}`}>
                {restaurant.is_active
                  ? "Доступний у каталозі"
                  : "Недоступний у каталозі"}
              </span>
            </div>
          </div>
          <RestaurantSources restaurant={restaurant} />
          <div className="actions">
            <button
              className="primary"
              onClick={() => onChange({ type: "dish", restaurantId: id })}
            >
              Додати страву
            </button>
          </div>
          <div className="spaced">
            <DishCatalog
              dishes={restaurant.menu}
              renderActions={(dish) => (
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    onChange({ type: "dish", restaurantId: id, id: dish.id })
                  }
                >
                  Редагувати страву
                </button>
              )}
            />
          </div>
        </>
      )}
    </Async>
  );
}
