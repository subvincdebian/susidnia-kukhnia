import type {
  Dish,
  Restaurant,
  RestaurantDetail,
} from "../../entities/restaurant";

const featuredNames = [
  "Musafir",
  "il Molino",
  "Greek House",
  "Lviv Croissants",
  "Pesto Cafe",
  "KFC",
];

export function featuredRestaurants(restaurants: Restaurant[]) {
  const available = restaurants.filter((restaurant) => restaurant.is_active);
  return [
    ...featuredNames.flatMap((name) =>
      available.filter((restaurant) => restaurant.name === name),
    ),
    ...available.filter(
      (restaurant) => !featuredNames.includes(restaurant.name),
    ),
  ].slice(0, 6);
}

export function heroRestaurants(restaurants: Restaurant[]) {
  const available = restaurants.filter((restaurant) => restaurant.is_active);
  const selected: Restaurant[] = [];
  for (const name of ["il Molino", "Greek House", "Pesto Cafe"]) {
    const restaurant =
      available.find(
        (item) =>
          item.name === name && !selected.some((pick) => pick.id === item.id),
      ) ??
      available.find((item) => !selected.some((pick) => pick.id === item.id));
    if (restaurant) selected.push(restaurant);
  }
  return selected;
}

export function featuredDish(
  restaurant: RestaurantDetail | undefined,
  preferredName: string,
): Dish | undefined {
  if (!restaurant?.is_active) return undefined;
  const dishes = restaurant.menu.filter(
    (dish) =>
      dish.is_available &&
      dish.image_url?.startsWith("/media/catalog/") &&
      !dish.image_url.includes(".."),
  );
  return (
    dishes.find((dish) =>
      dish.name.toLocaleLowerCase("uk-UA").includes(preferredName),
    ) ?? dishes[0]
  );
}
