import { useId, useLayoutEffect, useRef } from "react";
import { CatalogPhoto } from "../../entities/restaurant";
import { CartQuantity, decimal, useCart } from "../../entities/cart";
import { money, openPage } from "../../shared/lib";
import { Modal, PageLink } from "../../shared/ui";

function BagIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path d="M5 7h14l1 14H4L5 7Z" strokeLinejoin="round" />
      <path d="M8 9V6a4 4 0 0 1 8 0v3" strokeLinecap="round" />
    </svg>
  );
}
export function CartButton({ onOpen }: { onOpen: () => void }) {
  const { count } = useCart();
  return (
    <button
      type="button"
      className="shop-cart-button"
      onClick={onOpen}
      aria-label={`Кошик, страв: ${count}`}
    >
      <BagIcon />
      <span>Кошик</span>
      <span key={count} className="cart-count" data-filled={count > 0}>
        {count}
      </span>
    </button>
  );
}
export function CartPanel({
  onProceed,
  onFollow,
  hideProceed = false,
}: {
  onProceed?: () => void;
  onFollow?: () => void;
  hideProceed?: boolean;
}) {
  const { cart, count, resolved, catalog, quantity, attempt, storageIssue } =
    useCart();
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const focusAfterRemoval = useRef(false);
  useLayoutEffect(() => {
    if (!focusAfterRemoval.current) return;
    focusAfterRemoval.current = false;
    heading.current?.focus({ preventScroll: true });
  }, [count]);
  const proceed = () => {
    onProceed?.();
    if (!onProceed) openPage("checkout");
  };
  return (
    <section className="cart-panel" aria-labelledby={titleId}>
      <div className="cart-panel-heading">
        <h2 ref={heading} id={titleId} tabIndex={-1} data-autofocus>
          Твоє замовлення
        </h2>
        <span key={count} className="quantity-value">
          {count}
        </span>
      </div>
      {attempt ? (
        <>
          <p className="cart-restaurant-name">{attempt.restaurantName}</p>
          <p className="cart-info">
            Очікує підтвердження. Повторна перевірка не створить ще одне
            замовлення.
          </p>
          <ul className="cart-frozen-lines">
            {attempt.lines.map((line, index) => (
              <li key={index}>
                <span>
                  {line.name}
                  <small>
                    {line.quantity} × {money(line.unitPrice)}
                  </small>
                </span>
                <strong>
                  {money(
                    decimal(
                      Math.round(Number(line.unitPrice) * 100) * line.quantity,
                    ),
                  )}
                </strong>
              </li>
            ))}
          </ul>
          <div className="cart-total">
            <span>Разом</span>
            <strong>{money(attempt.body.expected_total)}</strong>
          </div>
          {!hideProceed && (
            <button
              type="button"
              className="primary cart-proceed"
              onClick={proceed}
            >
              Перевірити оформлення <span aria-hidden="true">→</span>
            </button>
          )}
        </>
      ) : !cart.items.length ? (
        <div className="cart-empty">
          <BagIcon />
          <h3>Кошик поки порожній</h3>
          <p>Додай щось смачне з меню. Страви та сума з’являться тут.</p>
          <PageLink view="restaurants" onFollow={onFollow}>
            Переглянути заклади <span aria-hidden="true">↗</span>
          </PageLink>
        </div>
      ) : (
        <>
          <PageLink
            view="menu"
            params={{ id: cart.restaurant?.id ?? 0 }}
            onFollow={onFollow}
            className="cart-restaurant-name"
          >
            {catalog.data?.name ?? cart.restaurant?.name}
            <span aria-hidden="true">↗</span>
          </PageLink>
          {!catalog.data ? (
            <div
              className="cart-loading"
              role={catalog.error ? "alert" : "status"}
            >
              {catalog.error ? (
                <>
                  <p>{catalog.error.message}</p>
                  <button type="button" onClick={catalog.retry}>
                    Повторити
                  </button>
                </>
              ) : (
                "Завантаження кошика..."
              )}
            </div>
          ) : (
            <>
              {catalog.error && (
                <div className="inline-alert" role="alert">
                  <p>{catalog.error.message}</p>
                  <button type="button" onClick={catalog.retry}>
                    Повторити
                  </button>
                </div>
              )}
              <ul className="cart-lines">
                {resolved.lines.map((line) => (
                  <li
                    key={line.id}
                    className={
                      !line.available ? "cart-line-unavailable" : undefined
                    }
                  >
                    <CatalogPhoto
                      src={line.product?.image_url}
                      alt={line.product?.image_alt || line.name}
                    />
                    <div className="cart-line-main">
                      <h3>{line.product?.name ?? line.name}</h3>
                      {line.product?.portion && <p>{line.product.portion}</p>}
                      {!line.available && (
                        <p className="cart-unavailable-label">
                          Зараз недоступна
                        </p>
                      )}
                      <div className="cart-line-actions">
                        <CartQuantity
                          name={line.name}
                          quantity={line.quantity}
                          onChange={(value) => {
                            focusAfterRemoval.current = value === 0;
                            quantity(line.id, value);
                          }}
                        />
                        <strong>
                          {line.unitCents === null
                            ? "Недоступно"
                            : money(decimal(line.unitCents * line.quantity))}
                        </strong>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              {!resolved.ready && (
                <p className="cart-info" role="status">
                  Прибери недоступні позиції, щоб продовжити оформлення.
                </p>
              )}
              <div className="cart-total">
                <span>Разом</span>
                <strong>
                  {resolved.totalCents === null
                    ? "Перевірте склад"
                    : money(decimal(resolved.totalCents))}
                </strong>
              </div>
              {!hideProceed && (
                <button
                  type="button"
                  className="primary cart-proceed"
                  disabled={
                    !resolved.ready || catalog.loading || Boolean(catalog.error)
                  }
                  onClick={proceed}
                >
                  До оформлення <span aria-hidden="true">→</span>
                </button>
              )}
            </>
          )}
        </>
      )}
      {storageIssue && (
        <p className="cart-info" role="alert">
          {storageIssue}
        </p>
      )}
    </section>
  );
}
export function CartOverlay({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Кошик" resetKey="cart" onClose={onClose}>
      <CartPanel
        onFollow={onClose}
        onProceed={() => {
          onClose();
          openPage("checkout");
        }}
      />
    </Modal>
  );
}
export function CartBar({ onOpen }: { onOpen: () => void }) {
  const { count, attempt, resolved } = useCart();
  if (!count && !attempt) return null;
  const total =
    attempt?.body.expected_total ??
    (resolved.totalCents === null ? null : decimal(resolved.totalCents));
  return (
    <div className="mobile-cart-bar">
      <button type="button" className="primary" onClick={onOpen}>
        <span key={count} className="cart-count" data-filled={count > 0}>
          {count}
        </span>
        <span>Переглянути кошик</span>
        <strong>{total ? money(total) : "Відкрити"}</strong>
      </button>
    </div>
  );
}
export function CartSwitchDialog() {
  const { cart, pendingAdd, confirmSwitch, cancelSwitch } = useCart();
  if (!pendingAdd) return null;
  return (
    <Modal
      title="Замінити кошик?"
      resetKey="cart-switch"
      onClose={cancelSwitch}
    >
      <p>
        У кошику вже є страви з {cart.restaurant?.name}. В одному замовленні
        можуть бути страви одного закладу.
      </p>
      <p>
        Перехід до {pendingAdd.restaurant.name} прибере вибрані позиції та
        додасть {pendingAdd.item.name}.
      </p>
      <div className="form-actions">
        <button type="button" data-autofocus onClick={cancelSwitch}>
          Залишити кошик
        </button>
        <button type="button" className="primary" onClick={confirmSwitch}>
          Замінити кошик
        </button>
      </div>
    </Modal>
  );
}
export function PendingCheckoutNotice() {
  const { attempt } = useCart();
  return attempt ? (
    <div className="shop-pending-notice" role="status">
      <span>Оформлення ще не підтверджено.</span>
      <PageLink view="checkout">Перевірити замовлення →</PageLink>
    </div>
  ) : null;
}
