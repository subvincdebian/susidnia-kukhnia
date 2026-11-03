import type { Restaurant } from "../../entities/restaurant";
import { DishCatalog, RestaurantSources } from "../../entities/restaurant";
import type { Customer } from "../../entities/customer";
import { useState } from "react";
import type { RestaurantDetail } from "../../entities/restaurant";
import { api, useResource } from "../../shared/api";
import { money } from "../../shared/lib";
import {
  Async,
  Empty,
  Field,
  FieldError,
  AppForm,
  numberValue,
  textValue,
  AddressField,
} from "../../shared/ui";

interface Bootstrap {
  restaurants: Pick<Restaurant, "id" | "name" | "is_active">[];
  customers: Pick<Customer, "id" | "full_name" | "default_delivery_address">[];
}

export function OrderCreate({
  restaurantId,
  onSaved,
  onCustomer,
}: {
  restaurantId?: number;
  onSaved: (id: number) => void;
  onCustomer: () => void;
}) {
  const resource = useResource<Bootstrap>("/bootstrap");
  return (
    <Async resource={resource}>
      {(boot) =>
        boot.customers.length ? (
          boot.restaurants.some((item) => item.is_active) ? (
            <OrderForm
              boot={boot}
              restaurantId={restaurantId}
              onSaved={onSaved}
            />
          ) : (
            <Empty
              title="Немає доступних закладів у каталозі"
              hint="Відкрийте заклад у каталозі або додайте новий"
            />
          )
        ) : (
          <div className="state">
            <h3>Спочатку додайте клієнта</h3>
            <p>Для замовлення потрібні його контакти та адреса</p>
            <button className="primary" onClick={onCustomer}>
              Додати клієнта
            </button>
          </div>
        )
      }
    </Async>
  );
}
function OrderForm({
  boot,
  restaurantId,
  onSaved,
}: {
  boot: Bootstrap;
  restaurantId?: number;
  onSaved: (id: number) => void;
}) {
  const available = boot.restaurants.filter((item) => item.is_active);
  const [selectedRestaurant, setRestaurant] = useState(
    restaurantId ?? available[0]?.id ?? 0,
  );
  const [customer, setCustomer] = useState(boot.customers[0]?.id ?? 0);
  const [address, setAddress] = useState(
    boot.customers[0]?.default_delivery_address ?? "",
  );
  const [point, setPoint] = useState<{
    latitude: number | null;
    longitude: number | null;
  }>({ latitude: null, longitude: null });
  const [paymentMethod, setPaymentMethod] = useState("картка");
  const [filterReset, setFilterReset] = useState(0);
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const menu = useResource<RestaurantDetail>(
    `/restaurants/${selectedRestaurant}`,
  );
  const dishes = menu.data?.menu.filter((item) => item.is_available) ?? [];
  const total =
    dishes.reduce((sum, dish) => {
      const quantity = Number(quantities[dish.id] ?? 0);
      return (
        sum +
        (Number.isInteger(quantity) && quantity > 0 && quantity <= 99
          ? Math.round(Number(dish.price) * 100) * quantity
          : 0)
      );
    }, 0) / 100;
  return (
    <AppForm
      submitLabel={
        paymentMethod === "картка"
          ? "Оформити та оплатити"
          : "Оформити замовлення"
      }
      disabled={menu.loading || Boolean(menu.error)}
      validate={() => {
        const fields: Record<string, string> = {};
        for (const dish of dishes) {
          const value = Number(quantities[dish.id] ?? 0);
          if (!Number.isInteger(value) || value < 0 || value > 99)
            fields[`qty-${dish.id}`] =
              "Кількість має бути цілим числом від 0 до 99";
        }
        if (!dishes.some((dish) => Number(quantities[dish.id] ?? 0) > 0))
          fields.items = "Додайте хоча б одну страву";
        if (Object.keys(fields).length) setFilterReset((value) => value + 1);
        return fields;
      }}
      onSubmit={(data) =>
        api.write<{ id: number }>("/orders", "POST", {
          customer_id: numberValue(data, "customer_id"),
          restaurant_id: selectedRestaurant,
          delivery_address: textValue(data, "delivery_address"),
          ...(point.latitude !== null && point.longitude !== null
            ? {
                delivery_latitude: point.latitude,
                delivery_longitude: point.longitude,
              }
            : {}),
          delivery_note: textValue(data, "delivery_note"),
          payment_method: paymentMethod,
          items: dishes
            .filter((dish) => Number(quantities[dish.id] ?? 0) > 0)
            .map((dish) => ({
              menu_item_id: dish.id,
              quantity: Number(quantities[dish.id]),
            })),
        })
      }
      onSuccess={(result) => onSaved(result.id)}
    >
      <div className="field-row">
        <Field
          name="customer_id"
          label="Клієнт"
          value={customer}
          options={boot.customers.map((item) => ({
            value: item.id,
            label: item.full_name,
          }))}
          onChange={(value) => {
            setCustomer(Number(value));
            setPoint({ latitude: null, longitude: null });
            setAddress(
              boot.customers.find((item) => item.id === Number(value))
                ?.default_delivery_address ?? "",
            );
          }}
        />
        <Field
          name="restaurant_id"
          label="Заклад"
          value={selectedRestaurant}
          options={available.map((item) => ({
            value: item.id,
            label: item.name,
          }))}
          onChange={(value) => {
            setRestaurant(Number(value));
            setQuantities({});
          }}
        />
      </div>
      <AddressField
        value={{ address, ...point }}
        onChange={(value) => {
          setAddress(value.address);
          setPoint({ latitude: value.latitude, longitude: value.longitude });
        }}
      />
      <Field
        name="delivery_note"
        label="Примітка до доставки"
        type="textarea"
        maxLength={500}
        required={false}
        hint="Наприклад, зателефонувати перед приїздом"
      />
      <h3>Страви</h3>
      <div id="items" tabIndex={-1} aria-describedby="items-error">
        <Async resource={menu}>
          {(restaurant) => (
            <>
              <RestaurantSources restaurant={restaurant} />
              <DishCatalog
                key={selectedRestaurant}
                dishes={dishes}
                resetFiltersKey={filterReset}
                emptyHint="Доступних страв немає. Оберіть інший заклад."
                renderActions={(dish) => (
                  <div className="dish-order-controls">
                    <Field
                      name={`qty-${dish.id}`}
                      label={`Кількість: ${dish.name}`}
                      type="number"
                      value={quantities[dish.id] ?? "0"}
                      required={false}
                      min={0}
                      max={99}
                      step={1}
                      onChange={(value) =>
                        setQuantities((previous) => ({
                          ...previous,
                          [dish.id]: value,
                        }))
                      }
                    />
                  </div>
                )}
              />
            </>
          )}
        </Async>
      </div>
      <FieldError name="items" />
      <Field
        name="payment_method"
        label="Оплата"
        value={paymentMethod}
        onChange={setPaymentMethod}
        options={[
          { value: "картка", label: "Карткою зараз" },
          { value: "готівка", label: "Готівкою при отриманні" },
        ]}
        hint="Демонстраційна оплата: банківські реквізити не потрібні."
      />
      <div className="cart-total" aria-live="polite">
        <span>До сплати</span>
        <span>{money(total)}</span>
      </div>
    </AppForm>
  );
}
