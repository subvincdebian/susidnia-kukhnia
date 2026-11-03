import type { Numeric } from "../../shared/lib";
import type { OrderStatus } from "../../entities/order";
export interface Analytics {
  summary: {
    orders_count: Numeric;
    orders_amount: Numeric;
    delivered_count: Numeric;
    delivered_amount: Numeric;
  };
  dishes: { name: string; orders_count: Numeric; portions: Numeric }[];
  ratings: { name: string; average_rating: Numeric; reviews_count: Numeric }[];
  status: {
    delivery_status: OrderStatus;
    orders_count: Numeric;
    amount: Numeric;
  }[];
  restaurants: { name: string; completed_orders: Numeric; amount: Numeric }[];
}
