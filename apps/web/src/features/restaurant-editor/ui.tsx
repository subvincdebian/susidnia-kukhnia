import { api, useResource } from "../../shared/api";
import { Async, CheckField, Field, AppForm, textValue } from "../../shared/ui";
import type { RestaurantDetail } from "../../entities/restaurant";
import { useState } from "react";
import { AddressField } from "../../shared/ui";
import type { AddressValue } from "../../shared/ui";

export function RestaurantEditor({
  id,
  onSaved,
}: {
  id?: number;
  onSaved: () => void;
}) {
  const resource = useResource<RestaurantDetail>(
    id ? `/restaurants/${id}` : null,
  );
  if (id)
    return (
      <Async resource={resource}>
        {(restaurant) => (
          <RestaurantForm id={id} restaurant={restaurant} onSaved={onSaved} />
        )}
      </Async>
    );
  return <RestaurantForm onSaved={onSaved} />;
}
function RestaurantForm({
  id,
  restaurant,
  onSaved,
}: {
  id?: number;
  restaurant?: RestaurantDetail;
  onSaved: () => void;
}) {
  const [address, setAddress] = useState<AddressValue>({
    address: restaurant?.address ?? "",
    latitude: restaurant?.latitude ?? null,
    longitude: restaurant?.longitude ?? null,
    source_url: restaurant?.coordinate_source ?? null,
  });
  return (
    <AppForm
      onSubmit={(data) =>
        api.write(`/restaurants${id ? `/${id}` : ""}`, id ? "PATCH" : "POST", {
          name: textValue(data, "name"),
          cuisine_type: textValue(data, "cuisine_type"),
          address: textValue(data, "address"),
          latitude: address.latitude,
          longitude: address.longitude,
          coordinate_source: address.source_url ?? null,
          phone: textValue(data, "phone"),
          is_active: data.has("is_active"),
        })
      }
      onSuccess={onSaved}
    >
      <Field
        name="name"
        label="Назва закладу"
        defaultValue={restaurant?.name}
        maxLength={100}
      />
      <Field
        name="cuisine_type"
        label="Кухня"
        defaultValue={restaurant?.cuisine_type}
        maxLength={50}
        hint="Наприклад, Українська або Італійська"
      />
      <AddressField
        name="address"
        label="Адреса закладу"
        value={address}
        onChange={setAddress}
      />
      <Field
        name="phone"
        label="Телефон"
        type="tel"
        defaultValue={restaurant?.phone}
        maxLength={20}
        autoComplete="tel"
      />
      <CheckField
        name="is_active"
        label="Приймає замовлення"
        defaultChecked={restaurant?.is_active ?? true}
      />
    </AppForm>
  );
}
