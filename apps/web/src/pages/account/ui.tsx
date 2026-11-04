import { useState } from "react";
import { useSession } from "../../entities/session";
import type { SessionUser } from "../../entities/session";
import { ApiError } from "../../shared/api";
import { openPage, useLocationParams } from "../../shared/lib";
import { AppForm, Field, PageLink, textValue, useNotify } from "../../shared/ui";

export function AccountPage({ returnTo, reason }: { returnTo?: string; reason?: string }) {
  const session = useSession();
  const params = useLocationParams();
  const notify = useNotify();
  const [registering, setRegistering] = useState(false);
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const finish = (user: SessionUser) => {
    setPassword("");
    notify(registering ? "Акаунт створено" : "Вхід виконано");
    const target = new URLSearchParams(returnTo ?? params.get("next") ?? "");
    const view = target.get("view");
    target.delete("view");
    target.delete("next");
    openPage(view && view !== "account" ? view : user.role === "admin" ? "manage" : "history", Object.fromEntries(target));
  };
  return (
    <div className="shop-page account-page">
      <header className="shop-page-heading">
        <div>
          <p className="home-eyebrow">Сусідня кухня · твій акаунт</p>
          <h1 tabIndex={-1}>{session.user ? "Раді бачити тебе" : registering ? "Створити акаунт" : "Увійти до акаунта"}</h1>
          <p>{session.user ? "Замовлення й контакти під рукою." : reason ?? "Увійди, щоб оформлювати замовлення та бачити їхню історію."}</p>
        </div>
      </header>
      {session.loading ? (
        <div className="state" role="status">Перевіряємо вхід…</div>
      ) : session.error ? (
        <div className="state" role="alert">
          <h2>Не вдалося перевірити вхід</h2>
          <p>{session.error.message}</p>
          <button type="button" onClick={session.refresh}>Повторити</button>
        </div>
      ) : session.user ? (
        <section className="account-card" aria-label="Поточний акаунт">
          <span className="account-role">{session.user.role === "admin" ? "Адміністратор" : "Користувач"}</span>
          <h2>{session.user.full_name}</h2>
          <p className="account-email">{session.user.email}</p>
          <dl className="account-details"><div><dt>Телефон</dt><dd>{session.user.phone}</dd></div></dl>
          <div className="account-links">
            <PageLink view="history">Мої замовлення <span aria-hidden="true">↗</span></PageLink>
            {session.user.role === "admin" && <PageLink view="manage">Керування доставкою <span aria-hidden="true">↗</span></PageLink>}
            <PageLink view="restaurants">Обрати заклад <span aria-hidden="true">↗</span></PageLink>
          </div>
          <AppForm hideCancel submitLabel="Вийти з акаунта" onSubmit={async () => { await session.logout(); notify("Вихід виконано"); }} onSuccess={() => undefined}>
            <p className="hint">Кошик збережеться. Для перегляду замовлень потрібно буде ввійти знову.</p>
          </AppForm>
        </section>
      ) : (
        <div className="account-layout">
          <section className="account-card" aria-label={registering ? "Реєстрація" : "Вхід"}>
            <div className="account-modes" aria-label="Вхід або реєстрація">
              <button type="button" aria-pressed={!registering} onClick={() => { setRegistering(false); setPassword(""); }}>Увійти</button>
              <button type="button" aria-pressed={registering} onClick={() => { setRegistering(true); setPassword(""); }}>Створити акаунт</button>
            </div>
            <AppForm
              key={String(registering)}
              hideCancel
              submitLabel={registering ? "Створити акаунт" : "Увійти"}
              validate={(data) => {
                const errors: Record<string, string> = {};
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(textValue(data, "email"))) errors.email = "Наприклад, name@example.com";
                if (registering) {
                  if (password.length < 10 || password.length > 128) errors.password = "Від 10 до 128 символів";
                  if (!/^\+?[\d ()-]{7,20}$/.test(textValue(data, "phone"))) errors.phone = "Наприклад, +380671234567";
                }
                return errors;
              }}
              onSubmit={async (data) => {
                try {
                  const user = registering
                    ? await session.register({ email: textValue(data, "email"), password, full_name: textValue(data, "full_name"), phone: textValue(data, "phone") })
                    : await session.login(textValue(data, "email"), password);
                  // Authentication remounts account-scoped UI, so finish this transition here.
                  finish(user);
                  return user;
                } catch (error) {
                  if (error instanceof ApiError && error.status === 401) setPassword("");
                  throw error;
                }
              }}
              onSuccess={() => undefined}
            >
              {registering && <Field name="full_name" label="Ім’я та прізвище" maxLength={100} autoComplete="name" />}
              <Field name="email" label="Електронна пошта" type="email" maxLength={100} value={email} onChange={setEmail} autoComplete="username" />
              {registering && <Field name="phone" label="Номер телефону" type="tel" maxLength={20} autoComplete="tel" hint="Наприклад, +380671234567" />}
              <Field name="password" label="Пароль" type="password" maxLength={128} value={password} onChange={setPassword} autoComplete={registering ? "new-password" : "current-password"} hint={registering ? "Від 10 до 128 символів. Не використовуй пароль від інших сервісів." : undefined} />
            </AppForm>
          </section>
          <aside className="account-note">
            <span className="brand-mark" aria-hidden="true">ск</span>
            <h2>Смачне поруч.<br />Замовлення — твої.</h2>
            <p>З акаунтом можна оформити замовлення, стежити за доставкою й повернутися до свого чека.</p>
            <p>Каталог і меню доступні без входу.</p>
            <PageLink view="restaurants">Переглянути заклади <span aria-hidden="true">→</span></PageLink>
            {import.meta.env.MODE === "pages" && <p className="account-demo-note">Це браузерна демоверсія. Акаунти й замовлення зберігаються лише в цьому браузері; вони не надають доступу до серверної версії.</p>}
            <details className="account-demo">
              <summary>Демоакаунти для перевірки</summary>
              <p>Лише демонстраційні дані. Можна також створити власний тестовий акаунт.</p>
              <dl>
                <div><dt>Користувач</dt><dd>user@demo.test<br /><code>UserDemo2026!</code></dd></div>
                <div><dt>Адміністратор</dt><dd>admin@demo.test<br /><code>AdminDemo2026!</code></dd></div>
              </dl>
            </details>
          </aside>
        </div>
      )}
    </div>
  );
}
