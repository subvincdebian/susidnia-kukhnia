import type { Courier } from "../../entities/courier";
import { api } from "../../shared/api";
import { AppForm, Field, textValue } from "../../shared/ui";

const vehicles = [
  { value: "пішки", label: "Пішки" },
  { value: "велосипед", label: "Велосипед" },
  { value: "скутер", label: "Скутер" },
  { value: "автомобіль", label: "Автомобіль" },
];

export function CourierEditor({
  courier,
  onSaved,
}: {
  courier?: Courier;
  onSaved: (courier: Courier) => void;
}) {
  return (
    <AppForm
      submitLabel={courier ? "Зберегти зміни" : "Додати кур'єра"}
      onSubmit={(data) =>
        api.write<Courier>(courier ? `/couriers/${courier.id}` : "/couriers", courier ? "PATCH" : "POST", {
          full_name: textValue(data, "full_name"),
          phone: textValue(data, "phone"),
          vehicle_type: textValue(data, "vehicle_type"),
        })
      }
      onSuccess={onSaved}
    >
      <Field
        name="full_name"
        label="Ім'я та прізвище кур'єра"
        defaultValue={courier?.full_name}
        maxLength={100}
        autoComplete="name"
      />
      <Field
        name="phone"
        label="Телефон"
        defaultValue={courier?.phone}
        type="tel"
        maxLength={20}
        autoComplete="tel"
      />
      <Field
        name="vehicle_type"
        label="Спосіб пересування"
        defaultValue={courier?.vehicle_type ?? ""}
        options={[
          { value: "", label: "Оберіть спосіб пересування" },
          ...vehicles,
        ]}
      />
    </AppForm>
  );
}
