import { useEffect } from "react";
import type { OrderDetail } from "../../entities/order";
import { DeliveryTracking } from "../../features/delivery-tracking";
import { useResource } from "../../shared/api";
import { Async, Empty, Heading, PageLink } from "../../shared/ui";

export function CourierDeliveryPage({ id }: { id: number | null }) {
  const assignment = useResource<{
    courier: { id: number; full_name: string; phone: string };
    order_id: number | null;
  }>(id ? `/couriers/${id}/delivery` : null);
  useEffect(() => {
    if (!id || assignment.loading) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") assignment.retry();
    }, 12000);
    return () => clearInterval(timer);
  }, [id, assignment.loading, assignment.retry]);
  if (!id) return <Empty title="Кур’єра не знайдено" />;
  return (
    <>
      <PageLink view="couriers" className="shop-back-link">
        ← До кур’єрів
      </PageLink>
      <Async resource={assignment} quiet>
        {(data) => (
          <>
            <Heading
              title="Доставка кур’єра"
              description={data.courier.full_name}
            />
            {data.order_id ? (
              <ActiveDelivery key={data.order_id} id={data.order_id} />
            ) : (
              <Empty
                title="Активної доставки немає"
                hint="Замовлення з’явиться тут після передачі кур’єру."
              />
            )}
          </>
        )}
      </Async>
    </>
  );
}
function ActiveDelivery({ id }: { id: number }) {
  const resource = useResource<OrderDetail>(`/orders/${id}`);
  useEffect(() => {
    if (resource.loading) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") resource.retry();
    }, 12000);
    return () => clearInterval(timer);
  }, [resource.loading, resource.retry]);
  return (
    <Async resource={resource} quiet>
      {(order) => (
        <>
          <section className="courier-recipient">
            <div>
              <h2>Замовлення № {order.id}</h2>
              <p>
                {order.restaurant} → {order.delivery_address}
              </p>
            </div>
            <a
              className="map-secondary-link"
              href={`tel:${order.recipient_phone ?? order.customer_phone}`}
            >
              Подзвонити одержувачу
            </a>
          </section>
          {order.delivery_note && (
            <p className="inline-alert">Примітка: {order.delivery_note}</p>
          )}
          <DeliveryTracking key={order.id} order={order} mode="courier" />
        </>
      )}
    </Async>
  );
}
