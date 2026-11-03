import { api } from "../../shared/api";
import { Field, AppForm, textValue } from "../../shared/ui";

export function CustomerCreate({ onSaved }: { onSaved: () => void }) {
  return (
    <AppForm
      submitLabel="Додати клієнта"
      onSubmit={(data) =>
        api.write("/customers", "POST", {
          full_name: textValue(data, "full_name"),
          email: textValue(data, "email"),
          phone: textValue(data, "phone"),
          default_delivery_address: textValue(data, "default_delivery_address"),
        })
      }
      onSuccess={onSaved}
    >
      <Field
        name="full_name"
        label="Ім'я та прізвище"
        maxLength={100}
        autoComplete="name"
      />
      <Field
        name="email"
        label="Електронна пошта"
        type="email"
        maxLength={100}
        autoComplete="email"
      />
      <Field
        name="phone"
        label="Телефон"
        type="tel"
        maxLength={20}
        autoComplete="tel"
      />
      <Field
        name="default_delivery_address"
        label="Адреса доставки"
        autoComplete="street-address"
      />
    </AppForm>
  );
}
