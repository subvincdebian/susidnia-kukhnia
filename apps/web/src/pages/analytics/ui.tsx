import { useEffect, useState } from "react";
import { Status } from "../../entities/order";
import type { Analytics } from "./model";
import { useResource } from "../../shared/api";
import { money, navigate, useLocationParams } from "../../shared/lib";
import { Async, Field, Heading, Table, textValue } from "../../shared/ui";

function currentPeriod() {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return {
    from: `${month}-01`,
    to: `${month}-${new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()}`,
  };
}
export function AnalyticsPage() {
  const params = useLocationParams(),
    period = currentPeriod();
  const from = params.get("from") ?? period.from,
    to = params.get("to") ?? period.to;
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState<"from" | "to" | null>(null);
  useEffect(() => {
    setError("");
    setInvalid(null);
  }, [from, to]);
  const resource = useResource<Analytics>(
    `/analytics?${new URLSearchParams({ from, to })}`,
  );
  return (
    <>
      <Heading
        title="Аналітика"
        description="Показники замовлень і відгуків за вибраний період."
      />
      <form
        className="toolbar"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const draftFrom = textValue(data, "from");
          const draftTo = textValue(data, "to");
          if (!draftFrom || !draftTo || draftFrom > draftTo) {
            setError("Вкажіть правильний початок і завершення періоду");
            setInvalid(!draftFrom ? "from" : "to");
            document.getElementById(!draftFrom ? "from" : "to")?.focus();
            return;
          }
          setError("");
          setInvalid(null);
          navigate({ from: draftFrom, to: draftTo });
        }}
      >
        <Field
          key={`from:${from}`}
          name="from"
          label="Початок періоду"
          type="date"
          defaultValue={from}
          error={invalid === "from" ? "Перевірте дату" : undefined}
        />
        <Field
          key={`to:${to}`}
          name="to"
          label="Завершення періоду"
          type="date"
          defaultValue={to}
          error={invalid === "to" ? "Перевірте період" : undefined}
        />
        <button type="submit">Показати</button>
        <div className="form-error" role="alert">
          {error}
        </div>
      </form>
      <Async resource={resource}>
        {(data) => <AnalyticsResults data={data} />}
      </Async>
    </>
  );
}
function AnalyticsResults({ data }: { data: Analytics }) {
  const s = data.summary,
    max = Math.max(1, ...data.dishes.map((dish) => Number(dish.orders_count)));
  return (
    <>
      <div className="summary-grid">
        <div>
          <span>Замовлень</span>
          <strong>{s.orders_count}</strong>
        </div>
        <div>
          <span>Сума всіх замовлень</span>
          <strong>{money(s.orders_amount)}</strong>
        </div>
        <div>
          <span>Доставлено</span>
          <strong>{s.delivered_count}</strong>
        </div>
        <div>
          <span>Сума доставлених</span>
          <strong>{money(s.delivered_amount)}</strong>
        </div>
      </div>
      <div className="columns">
        <section className="panel">
          <h2>Популярні страви</h2>
          <p className="small">
            Кількість замовлень. Порції наведено окремо в таблиці.
          </p>
          {data.dishes.length ? (
            <>
              <ol className="chart-list">
                {data.dishes.map((dish, index) => (
                  <li key={`${dish.name}-${index}`}>
                    <div className="chart-label">
                      <span>{dish.name}</span>
                      <strong>{dish.orders_count}</strong>
                    </div>
                    <div className="bar-track" aria-hidden="true">
                      <div
                        className="bar"
                        style={{
                          width: `${(Number(dish.orders_count) / max) * 100}%`,
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ol>
              <details>
                <summary>Таблиця популярності</summary>
                <Table
                  label="Популярність страв"
                  headers={["Страва", "Замовлень", "Порцій"]}
                  rows={data.dishes.map((dish) => [
                    dish.name,
                    dish.orders_count,
                    dish.portions,
                  ])}
                />
              </details>
            </>
          ) : (
            <p>За цей період замовлень немає.</p>
          )}
        </section>
        <section className="panel">
          <h2>Оцінки у відгуках</h2>
          {data.ratings.length ? (
            <Table
              label="Оцінки ресторанів"
              headers={["Заклад", "Середня оцінка", "Відгуків"]}
              rows={data.ratings.map((restaurant) => [
                restaurant.name,
                restaurant.average_rating,
                restaurant.reviews_count,
              ])}
            />
          ) : (
            <p>За цей період відгуків немає.</p>
          )}
          <p className="caption">
            Оцінка обчислюється за відгуками, а не береться з довідника
            закладів.
          </p>
        </section>
      </div>
      <div className="columns spaced">
        <section className="panel">
          <h2>Статуси замовлень</h2>
          {data.status.length ? (
            <Table
              label="Статуси замовлень"
              headers={["Статус", "Кількість", "Сума"]}
              rows={data.status.map((status) => [
                <Status value={status.delivery_status} />,
                status.orders_count,
                money(status.amount),
              ])}
            />
          ) : (
            <p>Замовлень немає.</p>
          )}
        </section>
        <section className="panel">
          <h2>Виконані замовлення за закладами</h2>
          <Table
            label="Виконані замовлення за закладами"
            headers={["Заклад", "Доставлено", "Сума"]}
            rows={data.restaurants.map((restaurant) => [
              restaurant.name,
              restaurant.completed_orders,
              money(restaurant.amount),
            ])}
          />
        </section>
      </div>
    </>
  );
}
