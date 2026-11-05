import type { Numeric } from "../../shared/lib";
export interface Restaurant {
  id: number;
  name: string;
  address: string;
  phone: string;
  cuisine_type: string;
  rating: Numeric | null;
  is_active: boolean;
  dishes_count?: Numeric;
  review_rating?: Numeric | null;
  image_url?: string | null;
  image_alt?: string | null;
  website_url?: string | null;
  menu_url?: string | null;
  source_checked_at?: string | null;
  source_note?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  coordinate_source?: string | null;
  matched_dishes?: Dish[];
  matched_dishes_count?: Numeric;
}
export interface Dish {
  id: number;
  restaurant_id: number;
  name: string;
  description: string | null;
  category: string;
  price: Numeric;
  is_available: boolean;
  image_url?: string | null;
  image_alt?: string | null;
  source_url?: string | null;
  portion?: string | null;
}
export interface RestaurantDetail extends Restaurant {
  menu: Dish[];
}
