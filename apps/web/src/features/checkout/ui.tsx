import { useState } from "react";
import { useCart, checkoutKey, decimal } from "../../entities/cart";
import type { CheckoutAttempt, CheckoutPayload } from "../../entities/cart";
import { api, ApiError, invalidateResources } from "../../shared/api";
import {
  AppForm,
  Field,
  FieldError,
  PageLink,
  useNotify,
  AddressField,
} from "../../shared/ui";
import { openPage, money, geoPoint } from "../../shared/lib";
import { canReleaseAttempt } from "./model";

export function CheckoutForm() {
  const {
    cart,
    catalog,
    resolved,
    contact,
    setContact,
    attempt,
    beginAttempt,
    clearAttempt,
    finish,
  } = useCart();
  const notify = useNotify();
  const values = attempt?.body ?? contact;
  const locked = Boolean(attempt);
  const [noteOpen, setNoteOpen] = useState(Boolean(values.delivery_note));
  const [sessionProblem, setSessionProblem] = useState(false);
  const total =
    attempt?.body.expected_total ??
    (resolved.totalCents === null ? null : decimal(resolved.totalCents));
  return (
    <AppForm
      className="checkout-form"
      hideCancel
      disabled={
        !attempt &&
        (!resolved.ready || catalog.loading || Boolean(catalog.error))
      }
      submitLabel={
        attempt
          ? "Перевірити оформлення"
          : values.payment_method === "картка"
            ? "Оформити та оплатити"
            : "Підтвердити замовлення"
      }
      validate={() => {
        const errors: Record<string, string> = {};
        if (!attempt && !resolved.ready)
          errors.items = "Перевірте склад кошика";
        return errors;
      }}
      onSubmit={async () => {
        setSessionProblem(false);
        let active: CheckoutAttempt;
        if (attempt) active = attempt;
        else {
          if (
            !cart.restaurant ||
            !resolved.ready ||
            resolved.totalCents === null
          )
            throw new ApiError(
              "Перевірте кошик перед оформленням",
              { items: "У кошику є недоступні страви" },
              400,
            );
          const body: Omit<CheckoutPayload, "request_key"> = {
            full_name: contact.full_name.trim(),
            phone: contact.phone.trim(),
            delivery_address: contact.delivery_address.trim(),
            ...(geoPoint(contact.delivery_latitude, contact.delivery_longitude)
              ? {
                  delivery_latitude: contact.delivery_latitude,
                  delivery_longitude: contact.delivery_longitude,
                }
              : {}),
            delivery_note: contact.delivery_note.trim(),
            payment_method: contact.payment_method,
            restaurant_id: cart.restaurant.id,
            expected_total: decimal(resolved.totalCents),
            items: cart.items
              .map((item) => ({
                menu_item_id: item.id,
                quantity: item.quantity,
              }))
              .sort((a, b) => a.menu_item_id - b.menu_item_id),
          };
          active = {
            body: { ...body, request_key: await checkoutKey(cart.id, body) },
            revision: cart.revision,
            restaurantName: catalog.data?.name ?? cart.restaurant.name,
            lines: resolved.lines.flatMap((line) =>
              line.unitCents === null
                ? []
                : [
                    {
                      name: line.product?.name ?? line.name,
                      quantity: line.quantity,
                      unitPrice: decimal(line.unitCents),
                    },
                  ],
            ),
          };
          beginAttempt(active);
        }
        try {
          const result = await api.write<{ id: number }>(
            "/orders/checkout",
            "POST",
            active.body,
          );
          return { ...result, revision: active.revision };
        } catch (error) {
          if (
            error instanceof ApiError &&
            canReleaseAttempt(error.status, error.fields)
          ) {
            clearAttempt();
            if (error.status === 409) invalidateResources();
            throw error;
          }
          if (
            error instanceof ApiError &&
            (error.status === 401 || error.status === 403)
          ) {
            setSessionProblem(true);
            throw new ApiError(
              "Сеанс оновився. Онови сторінку та перевір оформлення ще раз. Початкові дані збережено",
            );
          }
          throw new ApiError(
            "Сервер не підтвердив оформлення. Дані збережено. Натисни «Перевірити оформлення», щоб дізнатися результат",
          );
        }
      }}
      onSuccess={(result) => {
        finish(result.id, result.revision);
        notify("Замовлення оформлено");
        openPage("order", { id: result.id });
      }}
    >
      {attempt && (
        <div className="checkout-pending" role="status">
          <strong>Перевіримо результат оформлення</strong>
          <p>
            Збережено початковий склад і суму. Повторна перевірка поверне це
            саме замовлення.
          </p>
        </div>
      )}
      <section className="checkout-section">
        <div className="checkout-section-heading">
          <span aria-hidden="true">1</span>
          <h2>Контакти одержувача</h2>
        </div>
        <Field
          name="full_name"
          label="Ім’я та прізвище"
          value={values.full_name}
          onChange={(value) => setContact({ full_name: value })}
          maxLength={100}
          autoComplete="name"
          disabled={locked}
        />
        <Field
          name="phone"
          label="Номер телефону"
          type="tel"
          value={values.phone}
          onChange={(value) => setContact({ phone: value })}
          maxLength={30}
          autoComplete="tel"
          hint="Наприклад, +380671234567"
          disabled={locked}
        />
      </section>
      <section className="checkout-section">
        <div className="checkout-section-heading">
          <span aria-hidden="true">2</span>
          <h2>Куди доставити</h2>
        </div>
        <AddressField
          value={{
            address: values.delivery_address,
            latitude: values.delivery_latitude ?? null,
            longitude: values.delivery_longitude ?? null,
          }}
          onChange={(value) =>
            setContact({
              delivery_address: value.address,
              delivery_latitude: value.latitude,
              delivery_longitude: value.longitude,
            })
          }
          disabled={locked}
        />
        <details
          className="checkout-delivery-note"
          open={noteOpen}
          onToggle={(event) => setNoteOpen(event.currentTarget.open)}
        >
          <summary>Додати примітку до доставки</summary>
          <Field
            name="delivery_note"
            label="Примітка (необов’язково)"
            type="textarea"
            value={values.delivery_note}
            onChange={(value) => setContact({ delivery_note: value })}
            maxLength={500}
            required={false}
            disabled={locked}
          />
        </details>
      </section>
      <section className="checkout-section">
        <div className="checkout-section-heading">
          <span aria-hidden="true">3</span>
          <h2>Спосіб оплати</h2>
        </div>
        <Field
          name="payment_method"
          label="Оплата"
          value={values.payment_method}
          disabled={locked}
          options={[
            { value: "картка", label: "Карткою під час оформлення" },
            { value: "готівка", label: "Готівкою при отриманні" },
          ]}
          onChange={(value) => {
            if (value === "картка" || value === "готівка")
              setContact({ payment_method: value });
          }}
        />
        <p className="checkout-demo-note">
          Демонстраційне замовлення. Кошти не списуються, замовлення не надсилається
          закладу.
        </p>
      </section>
      <div id="items" tabIndex={-1}>
        <FieldError name="items" />
      </div>
      {sessionProblem && (
        <button type="button" onClick={() => location.reload()}>
          Оновити сторінку
        </button>
      )}
      <p className="checkout-confirm-total">
        <span>Сума замовлення</span>
        <strong>{total ? money(total) : "Перевірте кошик"}</strong>
      </p>
      {!attempt && (
        <PageLink
          view="menu"
          params={{ id: cart.restaurant?.id ?? 0 }}
          className="checkout-back"
        >
          ← Повернутися до меню
        </PageLink>
      )}
    </AppForm>
  );
}
