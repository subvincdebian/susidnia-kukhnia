import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { useResource } from "../../shared/api";
import type { Resource } from "../../shared/api";
import { useNotify } from "../../shared/ui";
import {
  addCartItem,
  cartDisplayCount,
  cartStorageKey,
  cartCompletionPrefix,
  readCartFromStorage,
  completeCartInStorage,
  decodeAttempt,
  decodeContact,
  decodeHistory,
  emptyCart,
  resolveCart,
  setCartQuantity,
} from "./model";
import type {
  CartCatalog,
  CartDraft,
  CartRestaurant,
  CheckoutAttempt,
  ContactDraft,
} from "./model";

const CART_KEY = cartStorageKey;
const read = (key: string, session = false) => {
  try {
    return (session ? sessionStorage : localStorage).getItem(key);
  } catch {
    return null;
  }
};
const storedCart = () => {
  try {
    return readCartFromStorage(localStorage);
  } catch {
    return null;
  }
};
type AddRequest = {
  restaurant: CartRestaurant;
  item: { id: number; name: string };
  revision: string;
};
interface CartContextValue {
  cart: CartDraft;
  catalog: Resource<CartCatalog>;
  resolved: ReturnType<typeof resolveCart>;
  count: number;
  contact: ContactDraft;
  attempt: CheckoutAttempt | null;
  history: number[];
  pendingAdd: AddRequest | null;
  storageIssue: string;
  add: (restaurant: CartRestaurant, item: { id: number; name: string }) => void;
  quantity: (id: number, value: number) => void;
  setContact: (values: Partial<ContactDraft>) => void;
  confirmSwitch: () => void;
  cancelSwitch: () => void;
  beginAttempt: (attempt: CheckoutAttempt) => void;
  clearAttempt: () => void;
  finish: (id: number, revision: string) => void;
}
const CartContext = createContext<CartContextValue | null>(null);
export function CartProvider({ children, account }: { children: ReactNode; account: { id: number; full_name: string; phone: string } | null }) {
  const CONTACT_KEY = `susidnia-kukhnia.contact.v2.${account?.id ?? "guest"}`;
  const ATTEMPT_KEY = `susidnia-kukhnia.checkout.v2.${account?.id ?? "guest"}`;
  const HISTORY_KEY = `susidnia-kukhnia.orders.v2.${account?.id ?? "guest"}`;
  const [cart, setCart] = useState(() => storedCart() ?? emptyCart());
  const [contact, changeContact] = useState(() =>
    read(CONTACT_KEY, true) ? decodeContact(read(CONTACT_KEY, true)) : { ...decodeContact(null), full_name: account?.full_name ?? "", phone: account?.phone ?? "" },
  );
  const [attempt, setAttempt] = useState(() =>
    decodeAttempt(read(ATTEMPT_KEY, true)),
  );
  const [history, setHistory] = useState(() =>
    decodeHistory(read(HISTORY_KEY)),
  );
  const [pendingAdd, setPendingAdd] = useState<AddRequest | null>(null);
  const [storageIssue, setStorageIssue] = useState("");
  const notify = useNotify();
  const cartRef = useRef(cart);
  cartRef.current = cart;
  const contactRef = useRef(contact);
  contactRef.current = contact;
  const attemptRef = useRef(attempt);
  attemptRef.current = attempt;
  const catalog = useResource<CartCatalog>(
    cart.restaurant ? `/restaurants/${cart.restaurant.id}` : null,
  );
  const resolved = useMemo(
    () => resolveCart(cart, catalog.data),
    [cart, catalog.data],
  );
  const commitCart = (next: CartDraft) => {
    cartRef.current = next;
    setCart(next);
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(next));
    } catch {
      setStorageIssue("Браузер не зберігає кошик після оновлення сторінки");
    }
  };
  useEffect(() => {
    const update = (event: StorageEvent) => {
      if (
        event.key === CART_KEY ||
        event.key === cartCompletionPrefix + cartRef.current.revision
      ) {
        const next = storedCart() ?? emptyCart();
        cartRef.current = next;
        setCart(next);
      }
      if (event.key === HISTORY_KEY) setHistory(decodeHistory(event.newValue));
    };
    window.addEventListener("storage", update);
    return () => window.removeEventListener("storage", update);
  }, []);
  const clearAttempt = () => {
    attemptRef.current = null;
    setAttempt(null);
    try {
      sessionStorage.removeItem(ATTEMPT_KEY);
    } catch {
      setStorageIssue("Не вдалося очистити збережений стан оформлення");
    }
  };
  const add = (
    restaurant: CartRestaurant,
    item: { id: number; name: string },
  ) => {
    if (attemptRef.current) {
      notify("Спочатку перевірте незавершене оформлення");
      return;
    }
    const current = cartRef.current;
    if (current.restaurant && current.restaurant.id !== restaurant.id) {
      setPendingAdd({ restaurant, item, revision: current.revision });
      return;
    }
    try {
      commitCart(addCartItem(current, restaurant, item));
      notify(`Додано: ${item.name}`);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Не вдалося додати страву",
      );
    }
  };
  return (
    <CartContext
      value={{
        cart,
        catalog,
        resolved,
        contact,
        attempt,
        history,
        pendingAdd,
        storageIssue,
        count: cartDisplayCount(cart, attempt),
        add,
        quantity: (id, value) => {
          if (!attemptRef.current)
            commitCart(setCartQuantity(cartRef.current, id, value));
        },
        setContact: (values) => {
          if (attemptRef.current) return;
          const next = { ...contactRef.current, ...values };
          contactRef.current = next;
          changeContact(next);
          try {
            sessionStorage.setItem(CONTACT_KEY, JSON.stringify(next));
          } catch {
            setStorageIssue(
              "Браузер не зберігає контакти після оновлення сторінки",
            );
          }
        },
        cancelSwitch: () => setPendingAdd(null),
        confirmSwitch: () => {
          if (!pendingAdd || attemptRef.current) return;
          if (cartRef.current.revision !== pendingAdd.revision) {
            notify("Кошик змінився. Повторіть додавання страви");
            setPendingAdd(null);
            return;
          }
          commitCart(
            addCartItem(emptyCart(), pendingAdd.restaurant, pendingAdd.item),
          );
          setPendingAdd(null);
        },
        beginAttempt: (next) => {
          if (cartRef.current.revision !== next.revision)
            throw new Error("Кошик змінився. Перевірте його перед оформленням");
          try {
            sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify(next));
          } catch {
            throw new Error(
              "Браузер не дозволив зберегти стан оформлення. Перевірте його налаштування",
            );
          }
          attemptRef.current = next;
          setAttempt(next);
        },
        clearAttempt,
        finish: (id, revision) => {
          const nextHistory = [
            ...new Set([id, ...decodeHistory(read(HISTORY_KEY)), ...history]),
          ].slice(0, 30);
          setHistory(nextHistory);
          try {
            localStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory));
          } catch {
            setStorageIssue("Браузер не зберігає історію замовлень");
          }
          let next = cartRef.current;
          try {
            next = completeCartInStorage(localStorage, next, revision);
          } catch {
            if (next.revision === revision) next = emptyCart();
            setStorageIssue("Не вдалося зберегти завершення кошика");
          }
          cartRef.current = next;
          setCart(next);
          if (next.items.length)
            notify("Замовлення оформлено. Нові зміни в кошику збережено");
          clearAttempt();
        },
      }}
    >
      {children}
    </CartContext>
  );
}
export function useCart() {
  const value = useContext(CartContext);
  if (!value) throw new Error("Кошик недоступний");
  return value;
}
