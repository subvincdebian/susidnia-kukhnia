export function CartQuantity({
  name,
  quantity,
  onChange,
  disabled = false,
}: {
  name: string;
  quantity: number;
  onChange: (quantity: number) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="cart-quantity"
      role="group"
      aria-label={`Кількість: ${name}`}
    >
      <button
        type="button"
        disabled={disabled}
        aria-label={
          quantity === 1
            ? `Прибрати ${name} з кошика`
            : `Зменшити кількість: ${name}`
        }
        onClick={() => onChange(quantity - 1)}
      >
        −
      </button>
      <output aria-label={`Обрано: ${name}`}>
        <span key={quantity} className="quantity-value">
          {quantity}
        </span>
      </output>
      <button
        type="button"
        disabled={disabled || quantity >= 99}
        aria-label={`Збільшити кількість: ${name}`}
        data-cart-increase
        onClick={() => onChange(quantity + 1)}
      >
        +
      </button>
    </div>
  );
}
