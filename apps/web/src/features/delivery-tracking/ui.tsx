import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { OrderDetail } from "../../entities/order";
import {
  api,
  ApiError,
  invalidateResources,
  useResource,
} from "../../shared/api";
import {
  dateTime,
  geoPoint,
  navigationUrl,
  pageHref,
  routeDistance,
} from "../../shared/lib";
import type { GeoRoute } from "../../shared/lib";
import {
  AddressField,
  AppForm,
  Async,
  Field,
  MapCanvas,
  Modal,
  useNotify,
} from "../../shared/ui";
import type { AddressValue, MapPin } from "../../shared/ui";
import {
  addressUpdate,
  canChangeDeliveryAddress,
  canPublishLocation,
  decodeMessageAttempt,
  locationFreshness,
} from "./model";
import type { MessageAttempt } from "./model";

type Mode = "customer" | "operator" | "courier";
export function DeliveryTracking({
  order,
  mode = "customer",
}: {
  order: OrderDetail;
  mode?: Mode;
}) {
  const [editing, setEditing] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [fit, setFit] = useState(0);
  const pickup = geoPoint(
    order.restaurant_latitude,
    order.restaurant_longitude,
  );
  const destination = geoPoint(
    order.delivery_latitude,
    order.delivery_longitude,
  );
  const courier = geoPoint(order.courier_latitude, order.courier_longitude);
  const active =
    order.delivery_status === "в дорозі" && order.courier_id !== null;
  const canEdit = canChangeDeliveryAddress(
    order.delivery_status,
    order.courier_id,
  );
  const freshness = locationFreshness(order.courier_location_at);
  const origin =
    active &&
    courier &&
    order.courier_location_source === "gps" &&
    freshness === "fresh"
      ? courier
      : pickup;
  const path =
    origin && destination
      ? `/geo/route?${new URLSearchParams({
          from_latitude: origin.latitude.toFixed(5),
          from_longitude: origin.longitude.toFixed(5),
          to_latitude: destination.latitude.toFixed(5),
          to_longitude: destination.longitude.toFixed(5),
        })}`
      : null;
  const route = useResource<GeoRoute>(path);
  const pins = useMemo<MapPin[]>(() => {
    const points: MapPin[] = [];
    const restaurant = geoPoint(
      order.restaurant_latitude,
      order.restaurant_longitude,
    );
    const delivery = geoPoint(
      order.delivery_latitude,
      order.delivery_longitude,
    );
    const courierPoint = geoPoint(
      order.courier_latitude,
      order.courier_longitude,
    );
    if (restaurant)
      points.push({
        ...restaurant,
        id: "restaurant",
        label: order.restaurant,
        kind: "restaurant",
      });
    if (delivery)
      points.push({
        ...delivery,
        id: "destination",
        label: order.delivery_address,
        kind: "destination",
      });
    if (active && courierPoint)
      points.push({
        ...courierPoint,
        id: "courier",
        label:
          order.courier_location_source === "manual"
            ? "Демонстраційна позиція кур’єра"
            : "Позиція кур’єра",
        kind: "courier",
      });
    return points;
  }, [
    order.restaurant_latitude,
    order.restaurant_longitude,
    order.restaurant,
    order.delivery_latitude,
    order.delivery_longitude,
    order.delivery_address,
    order.courier_latitude,
    order.courier_longitude,
    order.courier_location_source,
    active,
  ]);
  return (
    <section className="delivery-tracking" aria-label="Доставка на карті">
      <div className="delivery-map-heading">
        <div>
          <span className="delivery-eyebrow">Від закладу до дверей</span>
          <h2>Доставка на карті</h2>
        </div>
        <button type="button" onClick={() => setFit((value) => value + 1)}>
          Увесь маршрут
        </button>
      </div>
      <MapCanvas
        label="Маршрут доставки замовлення"
        pins={pins}
        route={route.data?.coordinates}
        fitKey={`${order.id}:${order.address_version}:${Boolean(active && courier)}:${fit}`}
      />
      <div className="delivery-map-legend">
        <span>
          <i className="map-dot restaurant" />
          Заклад
        </span>
        <span>
          <i className="map-dot destination" />
          Адреса доставки
        </span>
        {active && courier && (
          <span>
            <i className="map-dot courier" />
            Кур’єр
          </span>
        )}
      </div>
      <div className="delivery-route-summary" aria-live="polite">
        {route.data && (
          <p>
            <strong>{routeDistance(route.data.distance_meters)}</strong> ·
            приблизно{" "}
            {Math.max(1, Math.round(route.data.duration_seconds / 60))} хв
            автомобілем. Без урахування приготування й заторів.
          </p>
        )}
        {route.loading && !route.data && <p>Побудова маршруту...</p>}
        {route.error && (
          <p>
            Маршрут тимчасово недоступний. Точки залишилися на карті.{" "}
            <button type="button" className="text-button" onClick={route.retry}>
              Спробувати ще
            </button>
          </p>
        )}
        {!destination && (
          <p>
            Для цієї адреси ще немає точки на карті.
            {canEdit
              ? " Уточни будинок, щоб побачити маршрут."
              : " Адресу можна уточнити в повідомленні кур’єру."}
          </p>
        )}
        {active && (
          <p className="courier-location-status">
            {!courier || freshness === "missing"
              ? "Кур’єр ще не передав свою геопозицію."
              : order.courier_location_source === "manual"
                ? "На карті позначено демонстраційну позицію кур’єра."
                : freshness === "stale"
                  ? "Позиція кур’єра застаріла. Очікуємо нове оновлення."
                  : "Позиція кур’єра оновлюється з його пристрою."}
            {courier && order.courier_location_at && (
              <> Останнє оновлення: {dateTime(order.courier_location_at)}.</>
            )}
          </p>
        )}
      </div>
      <div className="delivery-contact-grid">
        <div>
          <span className="delivery-eyebrow">Адреса доставки</span>
          <p className="delivery-contact-value">{order.delivery_address}</p>
          {canEdit ? (
            <button type="button" onClick={() => setEditing(true)}>
              Змінити адресу
            </button>
          ) : (
            <p className="small">
              {active
                ? "Кур’єр уже отримав замовлення. Зміни узгоджуються в чаті."
                : "Доставку завершено. Адреса збережена в історії."}
            </p>
          )}
        </div>
        <div>
          <span className="delivery-eyebrow">
            {order.courier && mode !== "courier" ? "Твій кур’єр" : "Кур’єр"}
          </span>
          <p className="delivery-contact-value">
            {order.courier ?? "Ще не призначений"}
          </p>
          {order.courier_transport && (
            <p className="small">{order.courier_transport}</p>
          )}
          <div className="actions">
            {active && mode !== "courier" && order.courier_phone && (
              <a
                className="map-secondary-link"
                href={`tel:${order.courier_phone}`}
              >
                Зателефонувати
              </a>
            )}
            {order.courier_id && (
              <button type="button" onClick={() => setChatOpen(true)}>
                {active
                  ? mode === "customer"
                    ? "Написати кур’єру"
                    : "Відкрити чат"
                  : "Історія повідомлень"}
              </button>
            )}
          </div>
        </div>
      </div>
      {destination && (
        <a
          className="delivery-navigation"
          href={navigationUrl(destination, pickup)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Відкрити навігацію у Google Maps ↗
        </a>
      )}
      {mode !== "customer" && active && (
        <CourierPosition
          key={order.id}
          order={order}
          live={mode === "courier"}
        />
      )}
      {order.courier_id && (
        <details
          className="delivery-chat"
          open={chatOpen}
          onToggle={(event) => setChatOpen(event.currentTarget.open)}
        >
          <summary>Повідомлення про доставку</summary>
          <MessageThread
            key={`${order.id}-${mode}`}
            order={order}
            mode={mode}
            open={chatOpen}
          />
        </details>
      )}
      {editing && (
        <AddressEditor order={order} onClose={() => setEditing(false)} />
      )}
      {mode === "operator" && active && order.courier_id && (
        <a
          href={pageHref("courier-delivery", { id: order.courier_id })}
          target="_blank"
          rel="noopener noreferrer"
          className="delivery-courier-link"
        >
          Відкрити екран кур’єра ↗
        </a>
      )}
    </section>
  );
}
function AddressEditor({
  order,
  onClose,
}: {
  order: OrderDetail;
  onClose: () => void;
}) {
  const [value, setValue] = useState<AddressValue>({
    address: order.delivery_address,
    latitude: order.delivery_latitude,
    longitude: order.delivery_longitude,
  });
  const [version, setVersion] = useState(order.address_version);
  const editable = canChangeDeliveryAddress(
    order.delivery_status,
    order.courier_id,
  );
  const notify = useNotify();
  return (
    <Modal
      title="Змінити адресу доставки"
      resetKey={`address-${order.id}-${version}`}
      onClose={onClose}
    >
      <AppForm
        key={version}
        disabled={!editable}
        submitLabel="Зберегти адресу"
        onCancel={onClose}
        onSubmit={async () => {
          try {
            return await api.write(
              `/orders/${order.id}/address`,
              "PATCH",
              addressUpdate(
                value.address,
                version,
                geoPoint(value.latitude, value.longitude),
              ),
            );
          } catch (error) {
            if (error instanceof ApiError && error.status === 409)
              invalidateResources();
            throw error;
          }
        }}
        onSuccess={() => {
          notify("Адресу доставки змінено");
          onClose();
        }}
      >
        <p className="small">Зміна стосується лише цього замовлення.</p>
        {!editable && (
          <p className="inline-alert" role="alert">
            Кур’єр уже отримав замовлення або доставку завершено. Адресу не
            змінено.
          </p>
        )}
        {version !== order.address_version && (
          <div className="inline-alert" role="status">
            <p>Адресу змінили в іншому вікні. Твої правки збережені у формі.</p>
            <p>Поточна адреса: {order.delivery_address}</p>
            <button
              type="button"
              onClick={() => {
                setValue({
                  address: order.delivery_address,
                  latitude: order.delivery_latitude,
                  longitude: order.delivery_longitude,
                });
                setVersion(order.address_version);
              }}
            >
              Завантажити поточну адресу
            </button>
          </div>
        )}
        <AddressField value={value} onChange={setValue} disabled={!editable} />
      </AppForm>
    </Modal>
  );
}
function CourierPosition({
  order,
  live,
}: {
  order: OrderDetail;
  live: boolean;
}) {
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const notify = useNotify();
  useEffect(() => {
    if (
      !enabled ||
      !live ||
      !order.courier_id ||
      order.delivery_status !== "в дорозі"
    )
      return;
    if (!navigator.geolocation) {
      setEnabled(false);
      setError("Цей браузер не підтримує геолокацію");
      return;
    }
    let active = true,
      sending = false,
      lastSent = -Infinity;
    const watch = navigator.geolocation.watchPosition(
      (position) => {
        if (!active || sending || !canPublishLocation(lastSent, Date.now()))
          return;
        const point = geoPoint(
          position.coords.latitude,
          position.coords.longitude,
        );
        if (!point || position.coords.accuracy > 500) {
          setError("GPS поки неточний. Очікуємо точнішу позицію");
          return;
        }
        sending = true;
        lastSent = Date.now();
        void api
          .write(`/orders/${order.id}/courier-location`, "POST", {
            courier_id: order.courier_id,
            ...point,
            source: "gps",
          })
          .then(() => {
            if (active) {
              lastSent = Date.now();
              setError("");
            }
          })
          .catch((cause) => {
            if (active)
              setError(
                cause instanceof Error
                  ? cause.message
                  : "Не вдалося передати геопозицію",
              );
          })
          .finally(() => {
            sending = false;
          });
      },
      () => {
        if (active) {
          setEnabled(false);
          setError(
            "Немає доступу до GPS. Дозволь геолокацію в браузері та спробуй ще раз",
          );
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
    );
    return () => {
      active = false;
      navigator.geolocation.clearWatch(watch);
    };
  }, [enabled, live, order.id, order.courier_id, order.delivery_status]);
  const [demoPoint, setDemoPoint] = useState(false);
  return (
    <div className="courier-position-controls">
      <h3>{live ? "Передавання геопозиції" : "Позиція кур’єра"}</h3>
      {live && (
        <>
          <p className="small">
            GPS передається лише після увімкнення й поки ця сторінка відкрита.
            Клієнт побачить час останнього оновлення.
          </p>
          <button
            type="button"
            className={enabled ? "" : "primary"}
            onClick={() => {
              setError("");
              setEnabled((value) => !value);
            }}
          >
            {enabled ? "Зупинити GPS" : "Увімкнути GPS"}
          </button>
        </>
      )}
      <button
        type="button"
        disabled={busy || enabled}
        onClick={() => setDemoPoint(true)}
      >
        Позначити демонстраційну позицію
      </button>
      <p className="location-picker-error" role="status">
        {error}
      </p>
      {demoPoint && (
        <ManualCourierPoint
          order={order}
          onClose={() => setDemoPoint(false)}
          onSave={async (value) => {
            setBusy(true);
            try {
              await api.write(`/orders/${order.id}/courier-location`, "POST", {
                courier_id: order.courier_id,
                latitude: value.latitude,
                longitude: value.longitude,
                source: "manual",
              });
              setDemoPoint(false);
              notify("Демонстраційну позицію кур’єра оновлено");
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </div>
  );
}
function ManualCourierPoint({
  order,
  onClose,
  onSave,
}: {
  order: OrderDetail;
  onClose: () => void;
  onSave: (point: AddressValue) => Promise<void>;
}) {
  const [value, setValue] = useState<AddressValue>({
    address: order.restaurant_address,
    latitude: order.courier_latitude ?? order.restaurant_latitude,
    longitude: order.courier_longitude ?? order.restaurant_longitude,
  });
  return (
    <Modal
      title="Демонстраційна позиція кур’єра"
      resetKey={`demo-point-${order.id}`}
      onClose={onClose}
    >
      <AppForm
        submitLabel="Зберегти точку"
        onCancel={onClose}
        disabled={!geoPoint(value.latitude, value.longitude)}
        onSubmit={() => onSave(value)}
        onSuccess={() => {}}
      >
        <p className="small">
          Ця точка буде підписана як демонстраційна. Це не дані GPS.
        </p>
        <AddressField label="Місце кур’єра" value={value} onChange={setValue} />
      </AppForm>
    </Modal>
  );
}
interface Message {
  id: number;
  sender: "customer" | "courier";
  body: string;
  created_at: string;
}
function MessageThread({
  order,
  mode,
  open,
}: {
  order: OrderDetail;
  mode: Mode;
  open: boolean;
}) {
  const resource = useResource<{ items: Message[]; has_more: boolean }>(
    open ? `/orders/${order.id}/messages` : null,
  );
  const list = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const canSend =
    order.delivery_status === "в дорозі" && order.courier_id !== null;
  useEffect(() => {
    if (!open || resource.loading) return;
    const refresh = () => {
      if (document.visibilityState === "visible") resource.retry();
    };
    const timer = setInterval(refresh, 8000);
    return () => clearInterval(timer);
  }, [open, resource.loading, resource.retry]);
  const last = resource.data?.items.at(-1)?.id;
  useEffect(() => {
    if (open && list.current && atBottom.current)
      list.current.scrollTop = list.current.scrollHeight;
  }, [last, open]);
  return (
    <div className="delivery-chat-content">
      <Async resource={resource} quiet>
        {(data) => (
          <>
            {data.has_more && (
              <p className="small">Показано останні 100 повідомлень.</p>
            )}
            <div
              className="delivery-message-list"
              role="log"
              aria-label="Повідомлення про замовлення"
              aria-live="polite"
              aria-relevant="additions"
              ref={list}
              onScroll={(event) => {
                const node = event.currentTarget;
                atBottom.current =
                  node.scrollHeight - node.scrollTop - node.clientHeight < 40;
              }}
            >
              {!data.items.length && (
                <p className="chat-empty">
                  Тут можна уточнити під’їзд або домовитися, де зустрітися.
                </p>
              )}
              {data.items.map((message) => (
                <article
                  className={`delivery-message from-${message.sender}`}
                  key={message.id}
                >
                  <div>
                    <strong>
                      {message.sender === "customer" ? "Клієнт" : "Кур’єр"}
                    </strong>
                    <time>{dateTime(message.created_at)}</time>
                  </div>
                  <p>{message.body}</p>
                </article>
              ))}
            </div>
          </>
        )}
      </Async>
      {canSend ? (
        <MessageComposer
          order={order}
          sender={mode === "customer" ? "customer" : "courier"}
        />
      ) : (
        <p className="small">
          Доставку завершено. Історія чату доступна для перегляду.
        </p>
      )}
    </div>
  );
}
function MessageComposer({
  order,
  sender,
}: {
  order: OrderDetail;
  sender: "customer" | "courier";
}) {
  const key = `susidnia-kukhnia.message.${order.id}.${sender}`;
  const [attempt, setAttempt] = useState<MessageAttempt | null>(() => {
    try {
      return decodeMessageAttempt(sessionStorage.getItem(key));
    } catch {
      return null;
    }
  });
  const [text, setText] = useState(attempt?.body ?? "");
  const id = useId();
  const storeAttempt = (next: MessageAttempt | null) => {
    setAttempt(next);
    try {
      if (next) sessionStorage.setItem(key, JSON.stringify(next));
      else sessionStorage.removeItem(key);
    } catch {}
  };
  return (
    <AppForm
      className="message-composer"
      hideCancel
      submitLabel={attempt ? "Перевірити надсилання" : "Надіслати"}
      onSubmit={async () => {
        const next = attempt ?? {
          sender,
          body: text.trim(),
          request_key: crypto.randomUUID(),
          ...(sender === "courier" && order.courier_id
            ? { courier_id: order.courier_id }
            : {}),
        };
        storeAttempt(next);
        try {
          return await api.write(`/orders/${order.id}/messages`, "POST", next);
        } catch (error) {
          if (
            error instanceof ApiError &&
            (error.status === 400 ||
              error.status === 404 ||
              error.status === 409)
          )
            storeAttempt(null);
          throw error;
        }
      }}
      onSuccess={() => {
        storeAttempt(null);
        setText("");
      }}
    >
      <Field
        name="body"
        label={
          sender === "customer"
            ? "Повідомлення кур’єру"
            : "Відповідь від кур’єра"
        }
        type="textarea"
        value={text}
        onChange={setText}
        maxLength={1000}
        disabled={Boolean(attempt)}
      />
      {attempt && (
        <p id={id} className="small" role="status">
          Перевірка повторює це саме повідомлення, без дублювання.
        </p>
      )}
    </AppForm>
  );
}
