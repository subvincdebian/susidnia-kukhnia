import type { OrderDetail } from "./model";
import { money } from "../../shared/lib";
export function Status({ value }: { value: string }) {
  const tone: Record<string, string> = {
    доставлено: "green",
    скасовано: "red",
    "в дорозі": "blue",
    готується: "amber",
  };
  return <span className={`status ${tone[value] ?? ""}`}>{value}</span>;
}
export function Receipt({ order }: { order: OrderDetail }) {
  return (
    <div className="receipt">
      {order.items.map((item) => (
        <div className="receipt-line" key={item.id}>
          <span>
            {item.name}
            <br />
            <span className="small">
              {item.quantity} × {money(item.unit_price)}
            </span>
          </span>
          <strong>{money(Number(item.unit_price) * item.quantity)}</strong>
        </div>
      ))}
      <div className="receipt-total">
        <span>Разом</span>
        <span>{money(order.total_amount)}</span>
      </div>
    </div>
  );
}
