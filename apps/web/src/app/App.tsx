import { Component, useEffect, useRef, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { HomePage } from "../pages/home";
import { CatalogPage } from "../pages/catalog";
import { MenuPage } from "../pages/menu";
import { CheckoutPage } from "../pages/checkout";
import { CustomerOrderPage } from "../pages/customer-order";
import { HistoryPage } from "../pages/history";
import { AccountPage } from "../pages/account";
import { ManagePage } from "../pages/manage";
import { CustomersPage } from "../pages/customers";
import { RestaurantsPage } from "../pages/restaurants";
import { OrdersPage } from "../pages/orders";
import { CouriersPage } from "../pages/couriers";
import { CourierDeliveryPage } from "../pages/courier-delivery";
import { ReviewsPage } from "../pages/reviews";
import { AnalyticsPage } from "../pages/analytics";
import { CartProvider, useCart } from "../entities/cart";
import { SessionProvider, useSession } from "../entities/session";
import { managementLinks, Shell } from "../widgets/shell";
import {
  CartButton,
  CartOverlay,
  CartBar,
  CartSwitchDialog,
  PendingCheckoutNotice,
} from "../widgets/cart";
import { WorkspaceDialog } from "../widgets/workspace-dialog";
import type { DialogState } from "../widgets/workspace-dialog";
import { isShopView, openPage, useLocationParams } from "../shared/lib";
import { Empty, Heading, Notifications } from "../shared/ui";
import "./home.css";
import "./shop.css";
import "./maps.css";
import "./account.css";

const titles: Record<string, string> = {
  home: "Смачне поруч",
  restaurants: "Заклади",
  menu: "Меню закладу",
  checkout: "Оформлення замовлення",
  order: "Замовлення",
  history: "Мої замовлення",
  account: "Акаунт",
  "courier-delivery": "Доставка кур’єра",
  ...Object.fromEntries(managementLinks.map((item) => [item.view, item.label])),
};
export function App() {
  return (
    <Notifications>
      <SessionProvider><SessionCart /></SessionProvider>
    </Notifications>
  );
}
function SessionCart() {
  const { user } = useSession();
  return <CartProvider key={user?.id ?? "guest"} account={user}><AppContent /></CartProvider>;
}
function AppContent() {
  const params = useLocationParams(),
    view = params.get("view") ?? "home";
  const number = Number(params.get("id")),
    id =
      Number.isSafeInteger(number) && number > 0 && number <= 2147483647
        ? number
        : null;
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const { count, attempt } = useCart();
  const session = useSession();
  const adminRoute = managementLinks.some((item) => item.view === view) || view === "courier-delivery";
  const protectedRoute = adminRoute || ["checkout", "history", "order"].includes(view);
  const denied = adminRoute && session.user?.role !== "admin";
  const allowed = !protectedRoute || (!session.loading && !session.error && Boolean(session.user) && !denied);
  const shop = isShopView(view),
    route = view + ":" + (params.get("id") ?? "");
  const firstRoute = useRef(true);
  useEffect(() => {
    const title = protectedRoute && session.loading ? "Перевірка сеансу"
      : protectedRoute && session.error ? "Не вдалося перевірити вхід"
      : protectedRoute && !session.user ? "Увійти до акаунта"
      : protectedRoute && denied ? "Доступ обмежено" : titles[view] ?? "Сторінку не знайдено";
    document.title = title + " | Сусідня кухня";
    setCartOpen(false);
    if (firstRoute.current) {
      firstRoute.current = false;
      return;
    }
    document
      .querySelector<HTMLElement>("#main")
      ?.focus({ preventScroll: true });
  }, [route, view, protectedRoute, denied, session.user?.id, session.loading, session.error]);
  useEffect(() => { setDialog(null); }, [session.user?.id, session.user?.role]);
  const showCartBar =
    shop &&
    view !== "checkout" &&
    view !== "order" &&
    (count > 0 || Boolean(attempt));
  return (
    <>
      <Shell
        view={view}
        hasCart={showCartBar}
        cartTrigger={<CartButton onOpen={() => setCartOpen(true)} />}
      >
        {shop && view !== "checkout" && <PendingCheckoutNotice />}
        <PageBoundary key={route + ":" + (session.user?.id ?? "guest")}>
          {!allowed && (session.loading || session.error || !session.user) ? (
            <AccountPage returnTo={params.toString()} reason={view === "checkout" ? "Увійди, щоб продовжити оформлення. Кошик збережено." : adminRoute ? "Для керування потрібен акаунт адміністратора." : "Увійди, щоб переглянути свої замовлення."} />
          ) : !allowed ? (
            <div className="shop-page access-page">
              <Heading title="Доступ обмежено" description="Керування доступне лише адміністратору. У твоєму акаунті можна оформлювати й переглядати власні замовлення." />
              <div className="actions"><button className="primary" onClick={() => openPage("history")}>Мої замовлення</button><button onClick={() => openPage("account", { next: params.toString() })}>Переглянути акаунт</button></div>
            </div>
          ) : view === "account" ? (
            <AccountPage />
          ) : view === "home" ? (
            <HomePage onMenu={(value) => openPage("menu", { id: value })} />
          ) : view === "restaurants" ? (
            <CatalogPage />
          ) : view === "menu" ? (
            <MenuPage id={id} />
          ) : view === "checkout" ? (
            <CheckoutPage onCart={() => setCartOpen(true)} />
          ) : view === "order" ? (
            <CustomerOrderPage
              id={id}
              onReview={(value) =>
                setDialog({ type: "review", orderId: value })
              }
            />
          ) : view === "history" ? (
            <HistoryPage />
          ) : view === "manage" ? (
            <ManagePage />
          ) : view === "manage-restaurants" ? (
            <RestaurantsPage onDialog={setDialog} />
          ) : view === "customers" ? (
            <CustomersPage onAdd={() => setDialog({ type: "customer" })} />
          ) : view === "orders" ? (
            <OrdersPage onDialog={setDialog} />
          ) : view === "couriers" ? (
            <CouriersPage onDialog={setDialog} />
          ) : view === "courier-delivery" ? (
            <CourierDeliveryPage id={id} />
          ) : view === "reviews" ? (
            <ReviewsPage onDialog={setDialog} />
          ) : view === "analytics" ? (
            <AnalyticsPage />
          ) : (
            <>
              <Heading
                title="Сторінку не знайдено"
                description="Перейдіть до каталогу або оберіть розділ у меню."
              />
              <button onClick={() => openPage("restaurants")}>
                До закладів
              </button>
            </>
          )}
        </PageBoundary>
      </Shell>
      {showCartBar && <CartBar onOpen={() => setCartOpen(true)} />}
      <div className={shop ? "shop-overlays" : undefined}>
        {cartOpen && <CartOverlay onClose={() => setCartOpen(false)} />}
        <CartSwitchDialog />
        {dialog && !session.loading && session.user && (session.user.role === "admin" || dialog.type === "review") && (
          <WorkspaceDialog
            state={dialog}
            onChange={setDialog}
            onClose={() => setDialog(null)}
          />
        )}
      </div>
    </>
  );
}

class PageBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    document.title = "Помилка сторінки | Сусідня кухня";
  }
  render() {
    return this.state.failed ? (
      <>
        <Empty
          title="Не вдалося показати сторінку"
          hint="Оновіть сторінку та повторіть дію"
        />
        <button className="spaced" onClick={() => location.reload()}>
          Оновити сторінку
        </button>
      </>
    ) : (
      <div className="page-content">{this.props.children}</div>
    );
  }
}
