export type Numeric = string | number;
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
  pages: number;
}
