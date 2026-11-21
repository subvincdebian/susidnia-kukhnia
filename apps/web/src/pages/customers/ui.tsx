import { useEffect } from "react";
import { useResource } from "../../shared/api";
import { navigate, useLocationParams } from "../../shared/lib";
import type { Page } from "../../shared/lib";
import {
  Async,
  Empty,
  Heading,
  Pagination,
  PageLink,
  Search,
  Table,
} from "../../shared/ui";
interface Customer {
  id: number;
  full_name: string;
  email: string | null;
  phone: string;
  default_delivery_address: string;
}
export function CustomersPage({ onAdd }: { onAdd: () => void }) {
  const params = useLocationParams(),
    q = params.get("q") ?? "",
    sort = params.get("sort") || "name_asc",
    page = params.get("page") ?? "1";
  const resource = useResource<Page<Customer>>(
    `/customers?${new URLSearchParams({ q, page, sort })}`,
  );
  useEffect(() => {
    if (resource.data && Number(page) !== resource.data.page)
      navigate({ page: resource.data.page }, true);
  }, [resource.data, page]);
  const reset = () => navigate({ q: null, page: null }, true);
  return (
    <>
      <Heading
        title="Клієнти"
        description="Контакти та адреси клієнтів. Історичні контакти одержувача зберігаються в замовленні."
      >
        <button type="button" className="primary" onClick={onAdd}>
          Додати клієнта
        </button>
      </Heading>
      <div className="toolbar">
        <Search
          value={q}
          placeholder="Ім’я, телефон або email"
          onSearch={(value) => navigate({ q: value, page: null }, true)}
          onClear={reset}
        />
      </div>
      <Async resource={resource}>
        {(data) => (
          <>
            {data.items.length ? (
              <Table
                label="Клієнти"
                sortKeys={["name", "phone", "email", "address", null]}
                sort={sort}
                onSort={(value) => navigate({ sort: value, page: null })}
                rowKeys={data.items.map(({ id }) => id)}
                headers={[
                  "Клієнт",
                  "Телефон",
                  "Email",
                  "Адреса за замовчуванням",
                  "Замовлення",
                ]}
                rows={data.items.map((customer) => [
                  customer.full_name,
                  customer.phone,
                  customer.email ?? "Не вказано",
                  customer.default_delivery_address,
                  <PageLink view="orders" params={{ customer_id: customer.id }}>
                    Усі замовлення<span className="sr-only">: {customer.full_name}</span>
                  </PageLink>,
                ])}
              />
            ) : (
              <Empty
                title="Клієнтів не знайдено"
                hint="Зміни пошук або додай нового клієнта"
                onReset={q ? reset : undefined}
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
