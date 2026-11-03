import { useLayoutEffect, useRef } from "react";
import { CartQuantity, useCart } from "../../entities/cart";
export function AddToCart({
  restaurant,
  dish,
}: {
  restaurant: { id: number; name: string; is_active: boolean };
  dish: { id: number; name: string; is_available: boolean };
}) {
  const { cart, add, quantity, attempt } = useCart();
  const control = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(false);
  const count =
    cart.restaurant?.id === restaurant.id
      ? (cart.items.find((item) => item.id === dish.id)?.quantity ?? 0)
      : 0;
  const disabled = Boolean(
    attempt || !restaurant.is_active || !dish.is_available,
  );
  useLayoutEffect(() => {
    if (!restoreFocus.current) return;
    restoreFocus.current = false;
    control.current
      ?.querySelector<HTMLButtonElement>(
        count ? "[data-cart-increase]" : ".add-to-cart",
      )
      ?.focus({ preventScroll: true });
  }, [count]);
  const rememberFocus = () => {
    restoreFocus.current =
      control.current?.contains(document.activeElement) ?? false;
  };
  return (
    <div className="cart-control" ref={control}>
      {count ? (
        <CartQuantity
          name={dish.name}
          quantity={count}
          disabled={disabled}
          onChange={(value) => {
            if (!value) rememberFocus();
            quantity(dish.id, value);
          }}
        />
      ) : (
        <button
          type="button"
          className="add-to-cart"
          disabled={disabled}
          aria-label={`Додати ${dish.name} до кошика`}
          onClick={() => {
            if (!cart.restaurant || cart.restaurant.id === restaurant.id)
              rememberFocus();
            add(restaurant, dish);
          }}
        >
          <span>Додати</span>
          <span aria-hidden="true">+</span>
        </button>
      )}
    </div>
  );
}
