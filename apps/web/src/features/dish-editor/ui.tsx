import type { Dish, RestaurantDetail } from "../../entities/restaurant";
import { api, useResource } from "../../shared/api";
import {
  Async,
  CheckField,
  Empty,
  Field,
  AppForm,
  textValue,
} from "../../shared/ui";

export function DishEditor({
  id,
  restaurantId,
  onSaved,
}: {
  id?: number;
  restaurantId: number;
  onSaved: () => void;
}) {
  const resource = useResource<RestaurantDetail>(
    id ? `/restaurants/${restaurantId}` : null,
  );
  if (!id) return <DishForm restaurantId={restaurantId} onSaved={onSaved} />;
  return (
    <Async resource={resource}>
      {(restaurant) => {
        const dish = restaurant.menu.find((item) => item.id === id);
        return dish ? (
          <DishForm
            id={id}
            restaurantId={restaurantId}
            dish={dish}
            onSaved={onSaved}
          />
        ) : (
          <Empty
            title="Страву не знайдено"
            hint="Закрийте діалог та оновіть меню"
          />
        );
      }}
    </Async>
  );
}
function DishForm({
  id,
  restaurantId,
  dish,
  onSaved,
}: {
  id?: number;
  restaurantId: number;
  dish?: Dish;
  onSaved: () => void;
}) {
  return (
    <AppForm
      onSubmit={(data) =>
        api.write(`/menu${id ? `/${id}` : ""}`, id ? "PATCH" : "POST", {
          restaurant_id: restaurantId,
          name: textValue(data, "name"),
          description: textValue(data, "description"),
          category: textValue(data, "category"),
          price: textValue(data, "price"),
          is_available: data.has("is_available"),
        })
      }
      onSuccess={onSaved}
    >
      <Field
        name="name"
        label="Назва страви"
        defaultValue={dish?.name}
        maxLength={100}
      />
      <Field
        name="description"
        label="Опис"
        defaultValue={dish?.description ?? ""}
        type="textarea"
        maxLength={2000}
        required={false}
      />
      <div className="field-row">
        <Field
          name="category"
          label="Категорія"
          defaultValue={dish?.category}
          maxLength={50}
        />
        <Field
          name="price"
          label="Ціна у гривнях"
          defaultValue={dish?.price}
          hint="Крапка відокремлює копійки, наприклад 220.00"
        />
      </div>
      <CheckField
        name="is_available"
        label="Є в наявності"
        defaultChecked={dish?.is_available ?? true}
      />
    </AppForm>
  );
}
