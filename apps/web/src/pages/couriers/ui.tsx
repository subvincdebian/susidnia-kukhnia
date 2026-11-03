import { useEffect } from "react";
import type { Courier } from "../../entities/courier";
import type { Page } from "../../shared/lib";
import type { DialogState } from "../../widgets/workspace-dialog";
import { invalidateResources, useResource } from "../../shared/api";
import { navigate, useLocationParams } from "../../shared/lib";
import { Async, Empty, Field, Heading, Pagination, Search, Table, PageLink } from "../../shared/ui";

export function CouriersPage({ onDialog }: { onDialog: (state: DialogState) => void }) {
  const params = useLocationParams();
  const q = params.get("q") ?? "", status = params.get("status") ?? "", page = params.get("page") ?? "1";
  const resource = useResource<Page<Courier>>(`/couriers?${new URLSearchParams({ q, status, page })}`);
  const reset = () => navigate({ q: null, status: null, page: null }, true);
  useEffect(() => {
    if (resource.data && Number(page) !== resource.data.page) navigate({ page: resource.data.page }, true);
  }, [resource.data, page]);
  return <>
    <Heading title="Кур'єри" description="Контакти, транспорт і доступність для доставки.">
      <button className="primary" onClick={() => onDialog({ type: "courier" })}>Додати кур'єра</button>
    </Heading>
    <div className="toolbar">
      <Search value={q} placeholder="Ім'я або телефон" onSearch={(value) => navigate({ q: value, page: null }, true)} onClear={reset} />
      <Field name="courier-status" label="Статус" required={false} value={status} onChange={(value) => navigate({ status: value, page: null })}
        options={[{ value: "", label: "Усі кур'єри" }, { value: "available", label: "Вільні" }, { value: "busy", label: "На доставці" }, { value: "inactive", label: "Неактивні" }]} />
      <button onClick={invalidateResources}>Оновити</button>
    </div>
    <Async resource={resource}>{(data) => <>
      {data.items.length ? <Table label="Кур'єри" headers={["Кур'єр", "Телефон", "Транспорт", "Статус", "Дії"]}
        rows={data.items.map((courier) => [courier.full_name, <a href={`tel:${courier.phone}`}>{courier.phone}</a>, courier.vehicle_type,
          <span className={`status ${!courier.is_active ? "" : courier.is_available ? "green" : "amber"}`}>{!courier.is_active ? "Неактивний" : courier.active_orders_count ? "На доставці" : courier.is_available ? "Вільний" : "Недоступний"}</span>,
          <div className="actions">
          {Boolean(courier.active_orders_count) && <PageLink view="courier-delivery" params={{ id: courier.id }}>Доставка →</PageLink>}
          <button aria-label={`Редагувати кур'єра ${courier.full_name}`} onClick={() => onDialog({ type: "courier", courier })}>Редагувати</button>
          <button className={courier.is_active ? "danger" : ""} disabled={Boolean(courier.active_orders_count)}
            onClick={() => onDialog({ type: "courier-action", courier, action: courier.is_active ? "remove" : "restore" })}>
            {!courier.is_active ? "Відновити" : courier.orders_count ? "Деактивувати" : "Видалити"}
          </button></div>])} /> : <Empty title="Кур'єрів не знайдено" hint="Змініть фільтр або додайте кур'єра" onReset={reset} />}
      <Pagination data={data} onPage={(value) => navigate({ page: value })} />
    </>}</Async>
    <p className="small spaced">Кур'єра на доставці можна прибрати після її завершення. Кур'єри з історією замовлень деактивуються, їх можна відновити.</p>
  </>;
}
