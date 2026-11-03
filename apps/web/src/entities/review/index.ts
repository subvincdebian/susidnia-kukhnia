export interface Review {
  id: number;
  order_id: number;
  restaurant: string;
  customer: string;
  rating: number;
  comment: string;
  created_at: string;
}
export interface ReviewOption {
  id: number;
  restaurant: string;
  customer: string;
}
