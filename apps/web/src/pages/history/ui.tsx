import { useEffect } from "react";
import type { Order } from "../../entities/order";
import { useResource } from "../../shared/api";
import { money, dateTime } from "../../shared/lib";
import { Async, Empty, PageLink } from "../../shared/ui";
type RecentOrder = Pick<
  Order,
  | "id"
  | "restaurant"
  | "order_date"
  | "delivery_status"
  | "total_amount"
  | "payment_method"
  | "payment_refunded_at"
>;
export function HistoryPage() {
  const resource = useResource<RecentOrder[]>("/orders/recent");
  const active = resource.data?.some(
    (order) => !["доставлено", "скасовано"].includes(order.delivery_status),
  );
  useEffect(() => {
    if (!active || resource.loading) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") resource.retry();
    }, 15000);
    return () => clearInterval(timer);
  }, [active, resource.loading, resource.retry]);
  return (
    <div className="shop-page order-history-page">
      <header className="shop-page-heading">
        <div>
          <p className="home-eyebrow">Все під рукою</p>
          <h1 tabIndex={-1}>Мої замовлення</h1>
          <p>Останні 30 замовлень твого акаунта.</p>
        </div>
          <button
            type="button"
            onClick={resource.retry}
            disabled={resource.loading}
          >
            Оновити
          </button>
      </header>
        <Async resource={resource} quiet>
          {(orders) =>
            orders.length ? (
              <div className="order-history-grid">
                {orders.map((order) => (
                  <article className="order-history-card" key={order.id}>
                    <div className="history-card-top">
                      <span>№ {order.id}</span>
                      <span className="history-order-status">
                        {order.delivery_status}
                      </span>
                    </div>
                    <h2>{order.restaurant}</h2>
                    <p>{dateTime(order.order_date)}</p>
                    <div className="history-card-bottom">
                      <strong>{money(order.total_amount)}</strong>
                      <PageLink view="order" params={{ id: order.id }}>
                        Переглянути <span aria-hidden="true">↗</span>
                      </PageLink>
                    </div>
                    <small>
                      {order.payment_refunded_at
                        ? "Оплату повернено"
                        : order.payment_method
                          ? "Оплачено"
                          : order.delivery_status === "скасовано"
                            ? "Оплату не проводили"
                            : "Оплата при отриманні"}
                    </small>
                  </article>
                ))}
              </div>
            ) : (
              <>
                <Empty
                  title="Тут з’являться твої замовлення"
                  hint="Обери заклад і оформи перше замовлення"
                />
                <PageLink view="restaurants" className="shop-primary-link">
                  Обрати заклад →
                </PageLink>
              </>
            )
          }
        </Async>
    </div>
  );
}
