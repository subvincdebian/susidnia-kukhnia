import type { Courier } from "../../entities/courier";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Receipt, Status } from "../../entities/order";
import type { OrderDetail, OrderStatus } from "../../entities/order";
import { api, ApiError, invalidateResources, useResource } from "../../shared/api";
import { dateTime, money } from "../../shared/lib";
import {
  Async,
  AddressField,
  Field,
  AppForm,
  numberValue,
  textValue,
  useModal,
  useNotify,
} from "../../shared/ui";
import type { AddressValue } from "../../shared/ui";

interface Bootstrap {
  couriers: Courier[];
  statuses: OrderStatus[];
}

export function OrderManage({
  id,
  onReview,
  onRemoved,
  renderDelivery,
}: {
  id: number;
  onReview: (orderId: number) => void;
  onRemoved: () => void;
  renderDelivery?: (order: OrderDetail) => ReactNode;
}) {
  const order = useResource<OrderDetail>(`/orders/${id}`);
  const boot = useResource<Bootstrap>("/bootstrap");
  useEffect(() => {
    if (
      order.loading ||
      order.data?.delivery_status === "доставлено" ||
      order.data?.delivery_status === "скасовано"
    )
      return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") order.retry();
    }, 12000);
    return () => clearInterval(timer);
  }, [order.loading, order.data?.delivery_status, order.retry]);
  return (
    <Async resource={order} quiet>
      {(data) => (
        <Async resource={boot}>
          {(bootstrap) => (
            <>
              <OrderContent
                key={`${data.id}-${data.delivery_status}-${data.delivery_note}-${data.payment?.id ?? "unpaid"}-${data.payment?.refunded_at ?? ""}`}
                order={data}
                boot={bootstrap}
                onReview={onReview}
                onRemoved={onRemoved}
              />
              {renderDelivery?.(data)}
            </>
          )}
        </Async>
      )}
    </Async>
  );
}
function OrderContent({
  order: o,
  boot,
  onReview,
  onRemoved,
}: {
  order: OrderDetail;
  boot: Bootstrap;
  onReview: (orderId: number) => void;
  onRemoved: () => void;
}) {
  const [note, setNote] = useState(o.delivery_note ?? "");
  const [cancel, setCancel] = useState(false);
  const [remove, setRemove] = useState(false);
  const [editing, setEditing] = useState(false);
  const notify = useNotify();
  const final =
    o.delivery_status === "доставлено" || o.delivery_status === "скасовано";
  const transitions: Partial<Record<OrderStatus, OrderStatus>> = {
    створено: "готується",
    готується: "в дорозі",
    "в дорозі": "доставлено",
  };
  const next = transitions[o.delivery_status];
  const canEditDelivery =
    (o.delivery_status === "створено" || o.delivery_status === "готується") &&
    o.courier_id === null;
  const labels: Partial<Record<OrderStatus, string>> = {
    готується: "Почати приготування",
    "в дорозі": "Передати кур'єру",
    доставлено: o.payment
      ? "Підтвердити доставку"
      : "Підтвердити доставку та оплату",
  };
  if (cancel)
    return (
      <>
        <h3>Скасувати замовлення № {o.id}</h3>
        <AppForm
          danger
          submitLabel="Скасувати замовлення"
          cancelLabel="Повернутися"
          onCancel={() => setCancel(false)}
          onSubmit={() =>
            api.write(`/orders/${o.id}/status`, "PATCH", {
              status: "скасовано",
              expected_status: o.delivery_status,
            })
          }
          onSuccess={() => {
            setCancel(false);
            notify("Замовлення скасовано");
          }}
        >
          <p>
            Замовлення на {money(o.total_amount)} буде скасовано. Відновлення
            цього замовлення не передбачене.
            {o.payment &&
              !o.payment.refunded_at &&
              " Повернення буде збережено в історії демонстраційних оплат."}
          </p>
        </AppForm>
      </>
    );
  if (remove)
    return (
      <AppForm
        danger
        submitLabel="Видалити замовлення"
        cancelLabel="Повернутися"
        onCancel={() => setRemove(false)}
        onSubmit={() => api.write(`/orders/${o.id}`, "DELETE", {})}
        onSuccess={onRemoved}
      >
        <h3>Видалити замовлення № {o.id}?</h3>
        <p>Замовлення та його позиції буде видалено остаточно.</p>
      </AppForm>
    );
  if (editing && canEditDelivery)
    return (
      <EditDelivery order={o} onClose={() => setEditing(false)} />
    );
  const guardNote = () => {
    if (note !== (o.delivery_note ?? "")) {
      notify("Спочатку збережіть змінену примітку");
      document.getElementById("delivery_note")?.focus();
      return false;
    }
    return true;
  };
  return (
    <>
      <Status value={o.delivery_status} />
      <div className="step-list" aria-label="Етапи доставки">
        {boot.statuses
          .filter((value) => value !== "скасовано")
          .map((value) => (
            <span
              key={value}
              className={value === o.delivery_status ? "current" : ""}
            >
              {value}
            </span>
          ))}
      </div>
      <dl className="detail-list">
        <dt>Клієнт</dt>
        <dd>
          {o.recipient_name ?? o.customer} ·{" "}
          {o.recipient_phone ?? o.customer_phone}
        </dd>
        <dt>Заклад</dt>
        <dd>{o.restaurant}</dd>
        <dt>Створено</dt>
        <dd>{dateTime(o.order_date)}</dd>
        <dt>Адреса</dt>
        <dd>{o.delivery_address}</dd>
        <dt>Кур'єр</dt>
        <dd>{o.courier || "Не призначено"}</dd>
      </dl>
      <Receipt order={o} />
      {(canEditDelivery || o.can_delete) && (
        <div className="actions spaced">
          {canEditDelivery && (
            <button type="button" onClick={() => setEditing(true)}>
              Редагувати замовлення
            </button>
          )}
          {o.can_delete && (
            <button type="button" className="danger" onClick={() => setRemove(true)}>
              Видалити замовлення
            </button>
          )}
        </div>
      )}
      {o.payment && (
        <p className={`status ${o.payment.refunded_at ? "" : "green"} spaced`}>
          {o.payment.refunded_at ? "Оплату повернено" : "Оплачено"}:{" "}
          {money(o.payment.amount)}, {o.payment.method}
        </p>
      )}
      {final || canEditDelivery ? (
        <p className="small spaced">Примітка: {o.delivery_note || "Немає"}</p>
      ) : (
        <AppForm
          className="spaced"
          hideCancel
          submitLabel="Зберегти примітку"
          onSubmit={(data) =>
            api.write(`/orders/${o.id}/note`, "PATCH", {
              delivery_note: textValue(data, "delivery_note"),
            })
          }
          onSuccess={() => notify("Примітку збережено")}
        >
          <Field
            name="delivery_note"
            label="Примітка до доставки"
            type="textarea"
            required={false}
            maxLength={500}
            value={note}
            onChange={setNote}
          />
        </AppForm>
      )}
      {!final && !o.payment && (
        <AppForm
          className="spaced"
          hideCancel
          submitLabel="Оплатити карткою"
          validate={(): Record<string, string> =>
            guardNote()
              ? {}
              : { delivery_note: "Спочатку збережіть змінену примітку" }
          }
          onSubmit={() =>
            api.write(`/orders/${o.id}/payment`, "POST", {
              payment_method: "картка",
            })
          }
          onSuccess={() => notify("Замовлення оплачено")}
        >
          <h3>Оплата</h3>
          <p className="small">
            До сплати {money(o.total_amount)}. Можна оплатити зараз або готівкою
            при отриманні.
          </p>
        </AppForm>
      )}
      {!final && next && (
        <div className="order-actions">
          <AppForm
            hideCancel
            submitLabel={labels[next]}
            disabled={
              next === "в дорозі" &&
              !boot.couriers.some((courier) => courier.is_available)
            }
            validate={(): Record<string, string> =>
              guardNote()
                ? {}
                : { delivery_note: "Спочатку збережіть змінену примітку" }
            }
            onSubmit={(data) =>
              api.write(`/orders/${o.id}/status`, "PATCH", {
                status: next,
                expected_status: o.delivery_status,
                ...(next === "в дорозі"
                  ? { courier_id: numberValue(data, "courier_id") }
                  : {}),
                ...(next === "доставлено" && !o.payment
                  ? { payment_method: textValue(data, "payment_method") }
                  : {}),
              })
            }
            onSuccess={() =>
              notify(
                next === "доставлено"
                  ? o.payment
                    ? "Доставку підтверджено"
                    : "Доставку та оплату підтверджено"
                  : "Статус змінено",
              )
            }
            extraActions={
              <button
                type="button"
                className="danger"
                onClick={() => {
                  if (guardNote()) setCancel(true);
                }}
              >
                Скасувати замовлення
              </button>
            }
          >
            {next === "в дорозі" && (
              <>
                <Field
                  name="courier_id"
                  label="Кур'єр"
                  options={[
                    { value: "", label: "Оберіть доступного кур'єра" },
                    ...boot.couriers
                      .filter((courier) => courier.is_available)
                      .map((courier) => ({
                        value: courier.id,
                        label: `${courier.full_name} · ${courier.vehicle_type}`,
                      })),
                  ]}
                />
                {!boot.couriers.some((courier) => courier.is_available) && (
                  <p className="small">
                    Немає доступних кур'єрів. Додайте кур'єра в розділі Кур'єри
                    або дочекайтеся завершення поточної доставки.
                  </p>
                )}
              </>
            )}
            {next === "доставлено" && !o.payment && (
              <Field
                name="payment_method"
                label="Спосіб оплати"
                defaultValue="готівка"
                options={[
                  { value: "картка", label: "Картка" },
                  { value: "готівка", label: "Готівка" },
                ]}
              />
            )}
          </AppForm>
        </div>
      )}
      {o.delivery_status === "доставлено" && !o.review && (
        <button className="spaced" onClick={() => onReview(o.id)}>
          Залишити відгук
        </button>
      )}
      {o.review && (
        <p className="small spaced">
          Відгук: {o.review.rating} / 5 · {o.review.comment}
        </p>
      )}
    </>
  );
}

function EditDelivery({ order, onClose }: { order: OrderDetail; onClose: () => void }) {
  const [version] = useState(order.address_version);
  const [initialNote] = useState(() => (order.delivery_note ?? "").trim());
  const [address, setAddress] = useState<AddressValue>({
    address: order.delivery_address,
    latitude: order.delivery_latitude,
    longitude: order.delivery_longitude,
  });
  const notify = useNotify();
  const modal = useModal();
  return (
    <AppForm
      onCancel={() => {
        modal?.setDirty(false);
        onClose();
      }}
      onSubmit={async (data) => {
        try {
          const note = textValue(data, "delivery_note");
          return await api.write(`/orders/${order.id}`, "PATCH", {
            expected_version: version,
            delivery_address: textValue(data, "delivery_address"),
            ...(note !== initialNote ? { delivery_note: note, expected_note: initialNote } : {}),
            ...(address.latitude !== null && address.longitude !== null
              ? { delivery_latitude: address.latitude, delivery_longitude: address.longitude }
              : {}),
          });
        } catch (error) {
          if (error instanceof ApiError && error.status === 409) invalidateResources();
          throw error;
        }
      }}
      onSuccess={() => {
        notify("Замовлення збережено");
        onClose();
      }}
    >
      <h3>Редагувати замовлення № {order.id}</h3>
      {version !== order.address_version && (
        <p className="inline-alert" role="status">
          Поточна адреса змінилася. Поверніться до замовлення й відкрийте редагування ще раз.
        </p>
      )}
      <AddressField value={address} onChange={setAddress} />
      <Field
        name="delivery_note"
        label="Примітка до доставки"
        type="textarea"
        maxLength={500}
        required={false}
        defaultValue={order.delivery_note}
      />
    </AppForm>
  );
}
