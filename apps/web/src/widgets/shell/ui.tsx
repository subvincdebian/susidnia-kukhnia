import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { useSession } from "../../entities/session";
import { isShopView } from "../../shared/lib";
import { PageLink } from "../../shared/ui";
import { managementGroups, managementLinks, managementOverview } from "./model";

const shopLinks = [
  { view: "home", label: "Головна" },
  { view: "restaurants", label: "Заклади" },
  { view: "history", label: "Замовлення" },
];
function ManagementNavigation({ view }: { view: string }) {
  const link = (item: { view: string; label: string }) => (
    <PageLink key={item.view} view={item.view} current={view === item.view || item.view === "couriers" && view === "courier-delivery"}>
      {item.label}
    </PageLink>
  );
  return (
    <nav className="workspace-nav" aria-label="Розділи керування">
      <div className="workspace-overview-link">{link(managementOverview)}</div>
      {managementGroups.map((group) => (
        <div
          className="workspace-nav-group"
          role="group"
          aria-label={group.label}
          key={group.label}
        >
          <p aria-hidden="true">{group.label}</p>
          {group.links.map(link)}
        </div>
      ))}
    </nav>
  );
}
export function Shell({
  view,
  children,
  cartTrigger,
  hasCart = false,
}: {
  view: string;
  children: ReactNode;
  cartTrigger?: ReactNode;
  hasCart?: boolean;
}) {
  const { user } = useSession();
  const isAdmin = user?.role === "admin";
  const shop = isShopView(view) || !isAdmin;
  const accountLink = <PageLink view="account" className="account-trigger" current={view === "account"} label={user ? `Акаунт: ${user.full_name}` : "Увійти до акаунта"}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></svg><span>{user ? "Акаунт" : "Увійти"}</span></PageLink>;
  const currentSection = managementLinks.find((item) => item.view === (view === "courier-delivery" ? "couriers" : view));
  const management = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (management.current) management.current.open = false;
  }, [view]);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (
        management.current?.open &&
        event.target instanceof Node &&
        !management.current.contains(event.target)
      )
        management.current.open = false;
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);
  const link = (item: { view: string; label: string }) => (
    <PageLink
      key={item.view}
      view={item.view}
      current={
        view === item.view ||
        (item.view === "restaurants" && view === "menu") ||
        (item.view === "history" && view === "order")
      }
    >
      {item.label}
    </PageLink>
  );
  return (
    <div
      className={
        "site-shell" +
        (shop ? " home-shell shop-shell" : " workspace-shell") +
        (hasCart ? " has-basket" : "")
      }
    >
      <a className="skip" href="#main">
        До вмісту
      </a>
      <header className={"header" + (shop ? " home-header" : "")}>
        <PageLink view="home" className="brand">
          <span className="brand-mark" aria-hidden="true">
            ск
          </span>
          <span>
            Сусідня кухня<small>Доставка з місцевих закладів</small>
          </span>
        </PageLink>
        {shop ? (
          <>
            <nav className="home-nav" aria-label="Основна навігація">
              {shopLinks.map(link)}
            </nav>
            <div className="home-header-end">
              <span className="home-city">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  aria-hidden="true"
                >
                  <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" />
                  <circle cx="12" cy="10" r="2.5" />
                </svg>
                Київ
              </span>
              {accountLink}
              {cartTrigger}
              {isAdmin && <details
                ref={management}
                className="home-manage"
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.currentTarget.open = false;
                    event.currentTarget.querySelector("summary")?.focus();
                  }
                }}
              >
                <summary aria-label="Керування">
                  <svg
                    className="manage-symbol"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    aria-hidden="true"
                  >
                    <rect x="4" y="4" width="6" height="6" rx="1" />
                    <rect x="14" y="4" width="6" height="6" rx="1" />
                    <rect x="4" y="14" width="6" height="6" rx="1" />
                    <rect x="14" y="14" width="6" height="6" rx="1" />
                  </svg>
                  <span className="manage-label">Керування</span>
                  <svg
                    className="manage-chevron"
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    aria-hidden="true"
                  >
                    <path d="m5 8 5 5 5-5" />
                  </svg>
                </summary>
                <ManagementNavigation view={view} />
              </details>}
            </div>
          </>
        ) : (
          <div className="workspace-header-actions">
            <span className="local-label">Керування доставкою</span>
            {accountLink}
            <PageLink
              view="restaurants"
              className="workspace-store-link"
              label="Перейти до каталогу"
            >
              <span className="workspace-store-long">Перейти до каталогу</span>
              <span className="workspace-store-short" aria-hidden="true">
                Каталог
              </span>
              <span aria-hidden="true">↗</span>
            </PageLink>
          </div>
        )}
      </header>
      {import.meta.env.MODE === "pages" && (
        <p className="demo-notice" role="note">
          <strong>Демоверсія.</strong> Замовлення й оплати імітуються. Зміни зберігаються лише у твоєму браузері.
        </p>
      )}
      {shop ? (
        <main id="main" tabIndex={-1}>
          {children}
        </main>
      ) : (
        <div className="workspace-layout">
          <aside className="workspace-sidebar">
            <ManagementNavigation view={view} />
          </aside>
          <div className="workspace-content">
            <details
              ref={management}
              className="workspace-mobile-nav"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.currentTarget.open = false;
                  event.currentTarget.querySelector("summary")?.focus();
                }
              }}
            >
              <summary>
                <span>Розділи керування</span>
                <strong>{currentSection?.label ?? "Обрати розділ"}</strong>
                <span className="workspace-nav-chevron" aria-hidden="true">
                  ⌄
                </span>
              </summary>
              <ManagementNavigation view={view} />
            </details>
            <main id="main" tabIndex={-1}>
              {children}
            </main>
          </div>
        </div>
      )}
      {shop ? (
        <footer className="footer home-footer">
          <div>
            <PageLink view="home" className="home-footer-brand">
              Сусідня кухня<span aria-hidden="true">↗</span>
            </PageLink>
            <p>Меню закладів Києва в одному місці.</p>
          </div>
          <div className="home-footer-note">
            <p>
              Демоверсія сервісу. Замовлення не надсилаються закладам,
              кошти не списуються.
            </p>
            <small>Назви та фотографії належать відповідним закладам.</small>
          </div>
        </footer>
      ) : (
        <footer className="footer">
          Сусідня кухня
          <span>Демонстраційне керування доставкою</span>
        </footer>
      )}
    </div>
  );
}
