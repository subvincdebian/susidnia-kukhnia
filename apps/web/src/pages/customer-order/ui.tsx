import { useEffect } from "react";
import type { OrderDetail } from "../../entities/order";
import { Receipt } from "../../entities/order";
import { DeliveryTracking } from "../../features/delivery-tracking";
import { useResource } from "../../shared/api";
import { dateTime } from "../../shared/lib";
import { Async, Empty, PageLink } from "../../shared/ui";

const stages = ["створено", "готується", "в дорозі", "доставлено"];
const labels = ["Створено", "Готується", "В дорозі", "Доставлено"];
const messages: Record<string, string> = {
  створено: "Замовлення збережено. Його склад і сума вже зафіксовані.",
  готується: "Замовлення готується. Тут з’явиться наступний стан доставки.",
  "в дорозі": "Замовлення передано кур’єру.",
  доставлено: "Замовлення доставлено. Можеш залишити відгук.",
  скасовано: "Замовлення скасовано. Перевір інформацію про оплату нижче.",
};
export function CustomerOrderPage({
  id,
  onReview,
}: {
  id: number | null;
  onReview: (id: number) => void;
}) {
  const resource = useResource<OrderDetail>(id ? `/orders/${id}` : null);
  const terminal =
    resource.data?.delivery_status === "доставлено" ||
    resource.data?.delivery_status === "скасовано";
  useEffect(() => {
    if (!id || terminal || resource.loading) return;
    const refresh = () => {
      if (document.visibilityState === "visible") resource.retry();
    };
    const timer = setInterval(refresh, 12000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [id, terminal, resource.loading, resource.retry]);
  if (!id)
    return (
      <>
        <Empty title="Замовлення не знайдено" />
        <PageLink view="history">До замовлень</PageLink>
      </>
    );
  return (
    <div className="shop-page customer-order-page">
      <PageLink view="history" className="shop-back-link">
        ← Мої замовлення
      </PageLink>
      <Async resource={resource} quiet>
        {(order) => {
          const current = stages.indexOf(order.delivery_status);
          const paid = Boolean(order.payment && !order.payment.refunded_at);
          return (
            <>
              <header className="shop-page-heading">
                <div>
                  <p className="home-eyebrow">{order.restaurant}</p>
                  <h1 tabIndex={-1}>Замовлення № {order.id}</h1>
                  <p>{dateTime(order.order_date)}</p>
                </div>
                <button
                  type="button"
                  className="order-refresh"
                  onClick={resource.retry}
                  disabled={resource.loading}
                >
                  {resource.loading ? "Оновлення..." : "Оновити стан"}
                </button>
              </header>
              <section
                className={`order-status-panel${order.delivery_status === "скасовано" ? " is-cancelled" : ""}`}
                aria-labelledby="order-status-title"
              >
                <div aria-live="polite" aria-atomic="true">
                  <span className="order-status-label">Поточний стан</span>
                  <h2 id="order-status-title">
                    {order.delivery_status === "скасовано"
                      ? "Скасовано"
                      : (labels[current] ?? order.delivery_status)}
                  </h2>
                  <p>
                    {order.delivery_status === "доставлено" && order.review
                      ? "Замовлення доставлено. Дякуємо за відгук."
                      : messages[order.delivery_status]}
                  </p>
                </div>
                <span
                  key={order.delivery_status}
                  className="order-status-symbol"
                  aria-hidden="true"
                >
                  {order.delivery_status === "скасовано"
                    ? "×"
                    : terminal
                      ? "✓"
                      : "→"}
                </span>
              </section>
              {order.delivery_status !== "скасовано" && (
                <ol className="order-progress" aria-label="Стан доставки">
                  {stages.map((stage, index) => (
                    <li
                      key={stage}
                      className={
                        index < current
                          ? "is-complete"
                          : index === current
                            ? "is-current"
                            : undefined
                      }
                      aria-current={index === current ? "step" : undefined}
                    >
                      <span aria-hidden="true">
                        {index < current ? "✓" : index + 1}
                      </span>
                      <strong>{labels[index]}</strong>
                    </li>
                  ))}
                </ol>
              )}
              <DeliveryTracking order={order} />
              <div className="customer-order-layout">
                <section className="customer-order-receipt">
                  <h2>Що в замовленні</h2>
                  <Receipt order={order} />
                  <PageLink view="menu" params={{ id: order.restaurant_id }}>
                    Меню {order.restaurant} ↗
                  </PageLink>
                </section>
                <div className="customer-order-details">
                  <section>
                    <h2>Одержувач</h2>
                    <dl>
                      <div>
                        <dt>Одержувач</dt>
                        <dd>{order.recipient_name ?? order.customer}</dd>
                      </div>
                      <div>
                        <dt>Телефон</dt>
                        <dd>{order.recipient_phone ?? order.customer_phone}</dd>
                      </div>
                      {order.delivery_note && (
                        <div>
                          <dt>Примітка</dt>
                          <dd>{order.delivery_note}</dd>
                        </div>
                      )}
                    </dl>
                  </section>
                  <section>
                    <h2>Оплата</h2>
                    <p
                      className={`order-payment-state${paid ? " is-paid" : ""}`}
                    >
                      {order.payment?.refunded_at
                        ? "Оплату повернено"
                        : paid
                          ? "Оплачено"
                          : order.delivery_status === "скасовано"
                            ? "Оплату не проводили"
                            : "Очікує оплати при отриманні"}
                    </p>
                    <p className="order-payment-method">
                      {order.payment?.method === "картка"
                        ? "Карткою"
                        : order.payment?.method === "готівка"
                          ? "Готівкою"
                          : order.delivery_status === "скасовано"
                            ? "Платіж відсутній"
                            : "Готівкою при отриманні"}
                    </p>
                  </section>
                  {order.delivery_status === "доставлено" && (
                    <section>
                      <h2>
                        {order.review ? "Твій відгук" : "Як тобі замовлення?"}
                      </h2>
                      {order.review ? (
                        <>
                          <p className="order-review-rating">
                            {order.review.rating} / 5
                          </p>
                          <p>{order.review.comment}</p>
                        </>
                      ) : (
                        <>
                          <p>Поділися враженнями про страви та доставку.</p>
                          <button
                            type="button"
                            onClick={() => onReview(order.id)}
                          >
                            Залишити відгук
                          </button>
                        </>
                      )}
                    </section>
                  )}
                </div>
              </div>
            </>
          );
        }}
      </Async>
    </div>
  );
}
