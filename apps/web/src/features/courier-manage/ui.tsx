import type { Courier } from "../../entities/courier";
import { api } from "../../shared/api";
import { AppForm } from "../../shared/ui";

export function CourierManage({ courier, action, onSaved }: { courier: Courier; action: "remove" | "restore"; onSaved: (message: string) => void }) {
  const restoring = action === "restore";
  const label = restoring ? "Відновити кур'єра" : courier.orders_count ? "Деактивувати кур'єра" : "Видалити кур'єра";
  return <AppForm submitLabel={label} cancelLabel="Повернутися" danger={!restoring}
    onSubmit={() => restoring ? api.write(`/couriers/${courier.id}/restore`, "PATCH", {}) : api.write<{ archived: boolean }>(`/couriers/${courier.id}`, "DELETE", {})}
    onSuccess={(result) => onSaved(restoring ? "Кур'єра відновлено" : result && typeof result === "object" && "archived" in result && result.archived ? "Кур'єра деактивовано" : "Кур'єра видалено")}>
    <p><strong>{courier.full_name}</strong>, {courier.phone}</p>
    <p>{restoring ? "Кур'єр знову буде доступний для призначення на доставку." : courier.orders_count ? "Кур'єр зникне зі списку для призначення. Старі замовлення збережуться. Доступ можна відновити в цьому розділі." : "Контакт буде видалено. У цього кур'єра ще немає замовлень."}</p>
  </AppForm>;
}
