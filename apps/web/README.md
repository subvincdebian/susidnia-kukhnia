# Інтерфейс

React 19, TypeScript strict, Vite, FSD. Запуск із кореня: `npm run dev:web` при запущеному `npm run dev`. Vite на 127.0.0.1:5173 передає API на 3000. Перед запитами відкривається локальний сеанс через /api/session. Збірку apps/web/dist віддає NestJS.

Клієнтські сторінки: home, restaurants, menu&id, checkout, order&id, history. Керування: manage, manage-restaurants, orders, customers, couriers, reviews, analytics, labs. Назва сервісу повертає на головну. Пошук каталогу й робочі фільтри зберігаються в URL, пошук усередині меню локальний.

У app розташовані композиція та CSS, у pages - сторінки, widgets - навігація, кошик і робочі діалоги, features - дії та форми, entities - бізнес-моделі й представлення, shared - API, URL, форматування й спільний UI. Кожен slice має публічний index.ts. Імпорти йдуть лише в нижчі шари або всередині slice. Shared не містить бізнес-моделей. Правила перевіряє check:fsd.

CartProvider у entities/cart зберігає склад у localStorage, контакти й непідтверджений запит у sessionStorage. Сервер повторно перевіряє ціни. CheckoutForm зберігає ключ і вміст спроби до підтвердження; finish не стирає нові зміни іншої вкладки. Історія містить лише номери цього браузера й не замінює авторизацію.

Спільні власники: shared/ui/form.tsx для Field та AppForm, modal.tsx для діалогу й фокуса, primitives.tsx для повідомлень, пошуку, таблиць і пагінації. Select і date нативні. UseResource скасовує застарілі запити; фонове оновлення чека не зсуває вміст. Кольори належать app/styles.css, головна - home.css, клієнтські сторінки - shop.css. Поведінка та оформлення визначені в кореневих UX-CONTRACT.md і DESIGN.md.

Перевірки: `npm run check -w @food-delivery/web`, `npm run build -w @food-delivery/web`; моделі кошика перевіряються кореневим `npm test`.
