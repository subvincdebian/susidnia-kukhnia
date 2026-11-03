import { useCart, decimal } from "../../entities/cart";
import { CheckoutForm } from "../../features/checkout";
import { CartPanel } from "../../widgets/cart";
import { Empty, PageLink } from "../../shared/ui";
import { money } from "../../shared/lib";

export function CheckoutPage({ onCart }: { onCart: () => void }) {
  const { cart, attempt, resolved, count } = useCart();
  if (!cart.items.length && !attempt)
    return (
      <div className="shop-page">
        <Empty
          title="Кошик поки порожній"
          hint="Обери заклад і додай страви з меню"
        />
        <PageLink view="restaurants" className="shop-primary-link">
          Переглянути заклади →
        </PageLink>
      </div>
    );
  const total =
    attempt?.body.expected_total ??
    (resolved.totalCents === null ? null : decimal(resolved.totalCents));
  return (
    <div className="shop-page checkout-page">
      <ol className="checkout-steps" aria-label="Етапи замовлення">
        <li>
          <PageLink
            view="menu"
            params={{
              id: attempt?.body.restaurant_id ?? cart.restaurant?.id ?? 0,
            }}
          >
            Меню
          </PageLink>
        </li>
        <li>
          <button type="button" onClick={onCart}>
            Кошик
          </button>
        </li>
        <li aria-current="step">Оформлення</li>
      </ol>
      <header className="shop-page-heading">
        <div>
          <p className="home-eyebrow">Майже готово</p>
          <h1 tabIndex={-1}>Оформлення замовлення</h1>
          <p>Перевір склад і вкажи контакти одержувача.</p>
        </div>
      </header>
      <div className="checkout-layout">
        <details className="checkout-mobile-summary">
          <summary>
            <span>Склад замовлення · {count}</span>
            <strong>{total ? money(total) : "Перевірка..."}</strong>
          </summary>
          <CartPanel hideProceed />
        </details>
        <CheckoutForm />
        <aside className="checkout-desktop-summary">
          <CartPanel hideProceed />
        </aside>
      </div>
    </div>
  );
}
