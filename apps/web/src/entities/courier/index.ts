export interface Courier {
  id: number;
  full_name: string;
  phone: string;
  vehicle_type: string;
  is_available: boolean;
  is_active: boolean;
  orders_count?: number;
  active_orders_count?: number;
}
