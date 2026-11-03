import type { Numeric } from "../../shared/lib";
export type OrderStatus =
  | "створено"
  | "готується"
  | "в дорозі"
  | "доставлено"
  | "скасовано";
export interface Order {
  id: number;
  customer: string;
  restaurant: string;
  restaurant_id: number;
  recipient_name?: string | null;
  recipient_phone?: string | null;
  order_date: string;
  delivery_status: OrderStatus;
  total_amount: Numeric;
  courier: string | null;
  payment_method: string | null;
  payment_refunded_at: string | null;
}
export interface OrderDetail
  extends Omit<Order, "payment_method" | "payment_refunded_at"> {
  customer_phone: string;
  courier_id: number | null;
  courier_phone: string | null;
  courier_transport: string | null;
  restaurant_address: string;
  restaurant_phone: string;
  restaurant_latitude: number | null;
  restaurant_longitude: number | null;
  restaurant_coordinate_source: string | null;
  delivery_latitude: number | null;
  delivery_longitude: number | null;
  address_version: number;
  courier_latitude: number | null;
  courier_longitude: number | null;
  courier_location_at: string | null;
  courier_location_source: "gps" | "manual" | null;
  delivery_address: string;
  delivery_note: string;
  items: {
    id: number;
    menu_item_id: number;
    name: string;
    quantity: number;
    unit_price: Numeric;
  }[];
  payment: {
    id: number;
    amount: Numeric;
    method: string;
    refunded_at: string | null;
  } | null;
  review: { rating: number; comment: string } | null;
}
