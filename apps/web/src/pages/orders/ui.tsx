import type { OrderStatus } from "../../entities/order";
import { useEffect } from "react";
import { Status } from "../../entities/order";
import type { Order } from "../../entities/order";
import type { Page } from "../../shared/lib";
import type { DialogState } from "../../widgets/workspace-dialog";
import { invalidateResources, useResource } from "../../shared/api";
import { dateTime, money, navigate, useLocationParams } from "../../shared/lib";
import {
  Async,
  Empty,
  Field,
  Heading,
  Pagination,
  Search,
} from "../../shared/ui";

export function OrdersPage({
  onDialog,
}: {
  onDialog: (state: DialogState) => void;
}) {
  const params = useLocationParams(),
    q = params.get("q") ?? "",
    status = params.get("status") ?? "",
    page = params.get("page") ?? "1";
  const boot = useResource<Bootstrap>("/bootstrap");
  const resource = useResource<Page<Order>>(
    `/orders?${new URLSearchParams({ q, status, page })}`,
  );
  useEffect(() => {
    if (resource.data && Number(page) !== resource.data.page)
      navigate({ page: resource.data.page }, true);
  }, [resource.data, page]);
  const reset = () => navigate({ q: null, status: null, page: null }, true);
  return (
    <>
      <Heading
        title="Замовлення"
        description="Оформлення, оплата, призначення кур’єра та доставка."
      >
        <button
          className="primary"
          onClick={() => onDialog({ type: "new-order" })}
        >
          Нове замовлення
        </button>
      </Heading>
      <div className="toolbar">
        <Search
          value={q}
          placeholder="Номер, клієнт або заклад"
          onSearch={(value) => navigate({ q: value, page: null }, true)}
          onClear={reset}
        />
        <Field
          name="filter-status"
          label="Статус"
          required={false}
          value={status}
          onChange={(value) => navigate({ status: value, page: null })}
          options={[
            { value: "", label: "Усі статуси" },
            ...(
              boot.data?.statuses ?? [
                "створено",
                "готується",
                "в дорозі",
                "доставлено",
                "скасовано",
              ]
            ).map((value) => ({ value, label: value })),
          ]}
        />
        <button onClick={invalidateResources}>Оновити</button>
      </div>
      <Async resource={resource}>
        {(data) => (
          <>
            {data.items.length ? (
              <TableOfOrders
                orders={data.items}
                onOpen={(id) => onDialog({ type: "order", id })}
              />
            ) : (
              <Empty
                title="Замовлень не знайдено"
                hint="Змініть фільтр або створіть нове замовлення"
                onReset={reset}
              />
            )}
            <Pagination
              data={data}
              onPage={(value) => navigate({ page: value })}
            />
          </>
        )}
      </Async>
    </>
  );
}
import { Table } from "../../shared/ui";

interface Bootstrap {
  statuses: OrderStatus[];
}
function TableOfOrders({
  orders,
  onOpen,
}: {
  orders: Order[];
  onOpen: (id: number) => void;
}) {
  return (
    <Table
      label="Замовлення"
      headers={["Замовлення", "Клієнт", "Заклад", "Статус", "Сума", "Кур'єр"]}
      rows={orders.map((order) => [
        <>
          <button className="row-link" onClick={() => onOpen(order.id)}>
            № {order.id}
          </button>
          <span className="subline">{dateTime(order.order_date)}</span>
        </>,
        order.customer,
        order.restaurant,
        <Status value={order.delivery_status} />,
        <>
          <span className="nowrap">{money(order.total_amount)}</span>
          {order.payment_method && <span className="subline">{order.payment_refunded_at ? "Повернено" : "Оплачено"}</span>}
        </>,
        order.courier || "Не призначено",
      ])}
    />
  );
}
