import type { PGliteInterface } from "@electric-sql/pglite";
import { createOrders } from "./orders.ts";
import { createBrowserAuth, memoryTokenStore, type BrowserTokenStore, type BrowserUser } from "./auth.ts";
import { jsonValue, one, page, rows, type Row } from "./sql.ts";
import { date, fail, filters, flag, integer, minorUnits, money, object, phone, publicError, statuses, text } from "./validation.ts";
export { BrowserApiError } from "./validation.ts";

interface RestaurantRow extends Row { id: number; name: string; address: string; phone: string; cuisine_type: string }
interface MenuRow extends Row { id: number; restaurant_id: number; name: string; price: string; description: string | null; category: string }
function catalogSearch(q: string) {
  const needle=q.trim().toLocaleLowerCase("uk-UA");
  const match=(column: string)=>`strpos(translate(lower(${column}), 'АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯЁЪЫЭ', 'абвгґдеєжзиіїйклмнопрстуфхцчшщьюяёъыэ'), $1)>0`;
  const dish=`m.is_available AND (${match("m.name")} OR ${match("m.category")})`;
  const where=`(${match("r.name")} OR ${match("r.cuisine_type")} OR EXISTS(SELECT 1 FROM menu_items m WHERE m.restaurant_id=r.id AND ${dish}))`;
  const count=`(SELECT COUNT(*) FROM menu_items m WHERE length($1)>0 AND m.restaurant_id=r.id AND ${dish})`;
  return {needle,dish,where,count};
}
function courierFields(input: unknown) {
  const body = object(input), vehicle = text(body.vehicle_type, "vehicle_type", 30);
  if (!["пішки", "велосипед", "скутер", "автомобіль"].includes(vehicle))
    fail(400, "Оберіть транспорт", { vehicle_type: "Оберіть значення зі списку" });
  return [text(body.full_name, "full_name", 100), phone(body.phone), vehicle];
}

export function createBrowserApi(db: PGliteInterface, tokenStore: BrowserTokenStore = memoryTokenStore()) {
  const orders = createOrders(db);
  const auth = createBrowserAuth(db, tokenStore);

  async function bootstrap(user: BrowserUser | null) {
    if (user?.role !== "admin") {
      const restaurants = await rows(db, "SELECT id,name,is_active FROM restaurants ORDER BY name LIMIT 200");
      return { customers: [], couriers: [], restaurants, counts: {}, statuses };
    }
    const customers = await rows(db, "SELECT id,full_name,default_delivery_address FROM customers ORDER BY full_name LIMIT 200");
    const couriers = await rows(db, "SELECT id,full_name,vehicle_type,is_available,is_active FROM couriers WHERE is_active ORDER BY full_name LIMIT 200");
    const restaurants = await rows(db, "SELECT id,name,is_active FROM restaurants ORDER BY name LIMIT 200");
    const counts = await one(db, `SELECT (SELECT COUNT(*) FROM restaurants) AS restaurants,(SELECT COUNT(*) FROM orders) AS orders,
      (SELECT COUNT(*) FROM reviews) AS reviews,(SELECT COUNT(*) FROM active_orders) AS active`);
    return { customers, couriers, restaurants, counts, statuses };
  }
  function restaurantList(query: Record<string, unknown>) {
    const { q, page: requestedPage } = filters(query);
    const search=catalogSearch(q);
    return page(db, `SELECT r.*,(SELECT COUNT(*) FROM menu_items WHERE restaurant_id=r.id) AS dishes_count,
      (SELECT ROUND(AVG(v.rating),2) FROM reviews v JOIN orders o ON o.id=v.order_id WHERE o.restaurant_id=r.id) AS review_rating,
      ${search.count} AS matched_dishes_count,
      COALESCE((SELECT jsonb_agg(to_jsonb(matched)||jsonb_build_object('price',matched.price::text)) FROM
        (SELECT m.* FROM menu_items m WHERE length($1)>0 AND m.restaurant_id=r.id AND ${search.dish} ORDER BY m.price,m.name,m.id LIMIT 3) matched),'[]'::jsonb) AS matched_dishes
      FROM restaurants r WHERE ${search.where} ORDER BY r.is_active DESC,r.name,r.id`, [search.needle], requestedPage);
  }
  async function restaurantMap(query: Record<string, unknown>) {
    const search=catalogSearch(filters(query).q);
    return db.transaction(async (tx) => {
      const items = await rows(tx, `SELECT r.id,r.name,r.address,r.phone,r.cuisine_type,r.is_active,r.latitude,r.longitude,r.coordinate_source,r.image_url,r.image_alt,r.website_url,r.menu_url,
        ${search.count} AS matched_dishes_count FROM restaurants r WHERE ${search.where} ORDER BY r.is_active DESC,r.name,r.id LIMIT 500`,[search.needle]);
      const counts = await one<{ total: number; missing: number }>(tx, `SELECT COUNT(*)::integer AS total,COUNT(*) FILTER(WHERE r.latitude IS NULL OR r.longitude IS NULL)::integer AS missing FROM restaurants r WHERE ${search.where}`,[search.needle]);
      return { items, total: counts.total, missing_coordinates: counts.missing, truncated: counts.total > items.length };
    });
  }
  async function restaurantGet(id: number) {
    const restaurant = await one(db, "SELECT * FROM restaurants WHERE id=$1", [id], "Заклад не знайдено");
    const menu = await rows(db, "SELECT * FROM menu_items WHERE restaurant_id=$1 ORDER BY is_available DESC,category,name,id", [id]);
    return { ...restaurant, menu };
  }
  function restaurantSave(id: number | null, input: unknown) {
    const body = object(input);
    const name = text(body.name, "name", 100), address = text(body.address, "address", 200), contact = phone(body.phone), cuisine = text(body.cuisine_type, "cuisine_type", 50), active = flag(body.is_active, "is_active");
    return db.transaction(async (tx) => {
      if (id === null) return one(tx, "INSERT INTO restaurants(name,address,phone,cuisine_type,is_active) VALUES($1,$2,$3,$4,$5) RETURNING *", [name, address, contact, cuisine, active]);
      const old = await one<RestaurantRow>(tx, "SELECT * FROM restaurants WHERE id=$1 FOR UPDATE", [id], "Заклад не знайдено");
      const changed = old.name !== name || old.address !== address || old.phone !== contact || old.cuisine_type !== cuisine;
      return one(tx, `UPDATE restaurants SET name=$1,address=$2,phone=$3,cuisine_type=$4,is_active=$5,
        image_url=CASE WHEN $6 THEN NULL ELSE image_url END,image_alt=CASE WHEN $6 THEN NULL ELSE image_alt END,
        website_url=CASE WHEN $6 THEN NULL ELSE website_url END,menu_url=CASE WHEN $6 THEN NULL ELSE menu_url END,
        source_checked_at=CASE WHEN $6 THEN NULL ELSE source_checked_at END,source_note=CASE WHEN $6 THEN NULL ELSE source_note END,
        latitude=CASE WHEN $7 THEN NULL ELSE latitude END,longitude=CASE WHEN $7 THEN NULL ELSE longitude END,
        coordinate_source=CASE WHEN $7 THEN NULL ELSE coordinate_source END WHERE id=$8 RETURNING *`, [name, address, contact, cuisine, active, changed, old.address !== address, id]);
    });
  }
  function menuSave(id: number | null, input: unknown) {
    const body = object(input), name = text(body.name, "name", 100), description = text(body.description ?? "", "description", 2000, 0), price = money(body.price), category = text(body.category, "category", 50), available = flag(body.is_available, "is_available");
    return db.transaction(async (tx) => {
      if (id === null) {
        const restaurant = integer(body.restaurant_id, "restaurant_id");
        const dish = await one(tx, `INSERT INTO menu_items(name,description,price,category,is_available,restaurant_id)
          VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, [name, description, price, category, available, restaurant]);
        await tx.query("UPDATE restaurants SET source_checked_at=NULL WHERE id=$1", [restaurant]);
        return dish;
      }
      const old = await one<MenuRow>(tx, "SELECT * FROM menu_items WHERE id=$1 FOR UPDATE", [id], "Страву не знайдено");
      const renamed = old.name !== name;
      const changed = renamed || minorUnits(old.price) !== minorUnits(price) || (old.description ?? "") !== description || old.category !== category;
      const dish = await one(tx, `UPDATE menu_items SET name=$1,description=$2,price=$3,category=$4,is_available=$5,
        source_url=CASE WHEN $6 THEN NULL ELSE source_url END,image_url=CASE WHEN $7 THEN NULL ELSE image_url END,
        image_alt=CASE WHEN $7 THEN NULL ELSE image_alt END,portion=CASE WHEN $7 THEN NULL ELSE portion END
        WHERE id=$8 RETURNING *`, [name, description, price, category, available, changed, renamed, id]);
      if (changed) await tx.query("UPDATE restaurants SET source_checked_at=NULL WHERE id=$1", [old.restaurant_id]);
      return dish;
    });
  }
  function customerList(query: Record<string, unknown>) {
    const { q, page: requestedPage } = filters(query);
    return page(db, `SELECT id,full_name,email,phone,default_delivery_address FROM customers
      WHERE full_name ILIKE $1 OR phone ILIKE $1 OR COALESCE(email,'') ILIKE $1 ORDER BY full_name,id`, ["%" + q + "%"], requestedPage);
  }
  function customerCreate(input: unknown) {
    const body = object(input), email = text(body.email, "email", 100).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, "Перевірте пошту", { email: "Наприклад, client@example.test" });
    return one(db, "INSERT INTO customers(full_name,email,phone,default_delivery_address) VALUES($1,$2,$3,$4) RETURNING *", [text(body.full_name, "full_name", 100), email, phone(body.phone), text(body.default_delivery_address, "default_delivery_address", 200)]);
  }
  function courierList(query: Record<string, unknown>) {
    const { q, status, page: requestedPage } = filters(query);
    if (!["", "available", "busy", "inactive"].includes(status)) fail(400, "Невідомий статус кур’єра");
    return page(db, `SELECT c.*,(SELECT COUNT(*)::integer FROM orders o WHERE o.courier_id=c.id) AS orders_count,
      (SELECT COUNT(*)::integer FROM orders o WHERE o.courier_id=c.id AND o.delivery_status='в дорозі') AS active_orders_count
      FROM couriers c WHERE (c.full_name ILIKE $1 OR c.phone ILIKE $1)
      AND ($2='' OR ($2='inactive' AND NOT c.is_active) OR ($2='available' AND c.is_active AND c.is_available)
        OR ($2='busy' AND c.is_active AND EXISTS(SELECT 1 FROM orders o WHERE o.courier_id=c.id AND o.delivery_status='в дорозі')))
      ORDER BY c.is_active DESC,c.full_name,c.id`, ["%" + q + "%", status], requestedPage);
  }
  async function courierDelivery(id: number) {
    const courier = await one(db, "SELECT * FROM couriers WHERE id=$1", [id], "Кур’єра не знайдено");
    const [delivery] = await rows<{ id: number }>(db, "SELECT id FROM orders WHERE courier_id=$1 AND delivery_status='в дорозі' LIMIT 1", [id]);
    return { courier, order_id: delivery?.id ?? null };
  }
  function courierRemove(id: number) {
    return db.transaction(async (tx) => {
      await one(tx, "SELECT id FROM couriers WHERE id=$1 FOR UPDATE", [id], "Кур’єра не знайдено");
      const counts = await one<{ active: number; total: number }>(tx, "SELECT COUNT(*) FILTER(WHERE delivery_status='в дорозі')::integer AS active,COUNT(*)::integer AS total FROM orders WHERE courier_id=$1", [id]);
      if (counts.active) fail(409, "Кур’єр виконує доставку. Спочатку завершіть або скасуйте її");
      if (counts.total) {
        await tx.query("UPDATE couriers SET is_active=FALSE WHERE id=$1", [id]);
        return { id, archived: true };
      }
      await tx.query("DELETE FROM couriers WHERE id=$1", [id]);
      return { id, archived: false };
    });
  }
  function courierRestore(id: number) {
    return db.transaction(async (tx) => {
      await one(tx, "SELECT id FROM couriers WHERE id=$1 FOR UPDATE", [id], "Кур’єра не знайдено");
      return one(tx, `UPDATE couriers SET is_active=TRUE,is_available=NOT EXISTS(SELECT 1 FROM orders WHERE courier_id=$1 AND delivery_status='в дорозі') WHERE id=$1 RETURNING *`, [id]);
    });
  }
  function reviewList(query: Record<string, unknown>, customerId: number | null) {
    return page(db, `SELECT v.*,o.customer_id,c.full_name AS customer,r.name AS restaurant FROM reviews v JOIN orders o ON o.id=v.order_id
      JOIN customers c ON c.id=o.customer_id JOIN restaurants r ON r.id=o.restaurant_id
      WHERE ($1::integer IS NULL OR o.customer_id=$1) ORDER BY v.created_at DESC,v.id DESC`, [customerId], filters(query).page);
  }
  function reviewOptions() {
    return rows(db, `SELECT o.id,c.full_name AS customer,r.name AS restaurant FROM orders o JOIN customers c ON c.id=o.customer_id
      JOIN restaurants r ON r.id=o.restaurant_id LEFT JOIN reviews v ON v.order_id=o.id
      WHERE o.delivery_status='доставлено' AND v.id IS NULL ORDER BY o.id DESC LIMIT 200`);
  }
  function reviewSave(id: number | null, input: unknown) {
    const body = object(input), rating = integer(body.rating, "rating", 1, 5), comment = text(body.comment, "comment", 2000);
    if (id === null) return one(db, "INSERT INTO reviews(rating,comment,order_id) VALUES($1,$2,$3) RETURNING *", [rating, comment, integer(body.order_id, "order_id")]);
    return one(db, "UPDATE reviews SET rating=$1,comment=$2 WHERE id=$3 RETURNING *", [rating, comment, id]);
  }
  async function analytics(query: Record<string, unknown>) {
    const from = date(query.from ?? "2026-10-01", "from"), to = date(query.to ?? "2026-10-31", "to");
    if (from > to) fail(400, "Початок періоду має бути раніше завершення", { to: "Оберіть пізнішу дату" });
    const params = [from, to];
    const summary = await one(db, `SELECT COUNT(*) AS orders_count,COALESCE(SUM(total_amount),0) AS orders_amount,
      COUNT(*) FILTER(WHERE delivery_status='доставлено') AS delivered_count,COALESCE(SUM(total_amount) FILTER(WHERE delivery_status='доставлено'),0) AS delivered_amount
      FROM orders WHERE order_date>=$1::date AND order_date<$2::date+INTERVAL '1 day'`, params);
    const dishes = await rows(db, `SELECT m.name,COUNT(DISTINCT i.order_id) AS orders_count,SUM(i.quantity) AS portions FROM order_items i JOIN orders o ON o.id=i.order_id
      JOIN menu_items m ON m.id=i.menu_item_id WHERE o.order_date>=$1::date AND o.order_date<$2::date+INTERVAL '1 day' AND o.delivery_status<>'скасовано'
      GROUP BY m.id,m.name ORDER BY orders_count DESC,portions DESC,m.name LIMIT 10`, params);
    const ratings = await rows(db, `SELECT r.name,ROUND(AVG(v.rating),2) AS average_rating,COUNT(v.id) AS reviews_count FROM reviews v JOIN orders o ON o.id=v.order_id
      JOIN restaurants r ON r.id=o.restaurant_id WHERE v.created_at>=$1::date AND v.created_at<$2::date+INTERVAL '1 day'
      GROUP BY r.id,r.name ORDER BY average_rating DESC,reviews_count DESC,r.name LIMIT 10`, params);
    const status = await rows(db, `SELECT delivery_status,COUNT(*) AS orders_count,SUM(total_amount) AS amount FROM orders
      WHERE order_date>=$1::date AND order_date<$2::date+INTERVAL '1 day' GROUP BY delivery_status ORDER BY orders_count DESC`, params);
    const restaurants = await rows(db, `SELECT r.name,COUNT(o.id) AS completed_orders,COALESCE(SUM(o.total_amount),0) AS amount FROM restaurants r LEFT JOIN orders o
      ON o.restaurant_id=r.id AND o.delivery_status='доставлено' AND o.order_date>=$1::date AND o.order_date<$2::date+INTERVAL '1 day'
      GROUP BY r.id,r.name ORDER BY completed_orders DESC,amount DESC,r.name LIMIT 10`, params);
    return { from, to, summary, dishes, ratings, status, restaurants };
  }

  async function route(path: string, method: string, body: unknown): Promise<unknown> {
    const url = new URL(path, "https://browser.invalid");
    if (url.origin !== "https://browser.invalid" || !path.startsWith("/")) fail(400, "Некоректна адреса запиту");
    const query = Object.fromEntries(url.searchParams), segments = url.pathname.split("/").filter(Boolean);
    const [resource, rawId, operation] = segments;
    if (segments.length > 3) fail(404, "Сторінку не знайдено");
    const id = () => integer(Number(rawId), "id");
    if (resource === "auth" && segments.length === 2) {
      if (method === "GET" && rawId === "session") return { user: await auth.current() };
      if (method === "POST" && rawId === "login") return auth.login(body);
      if (method === "POST" && rawId === "register") return auth.register(body);
      if (method === "POST" && rawId === "logout") return auth.logout();
      fail(404, "Сторінку не знайдено");
    }
    const user = await auth.current();
    const publicRead = method === "GET" && (resource === "session" && segments.length === 1
      || resource === "bootstrap" && segments.length === 1
      || resource === "restaurants" && segments.length <= 2);
    if (!publicRead) {
      if (!user) fail(401, "Увійдіть до облікового запису");
      if (user.role !== "admin") {
        const ownOrder = async (orderId: number) => {
          if (!(await rows(db, "SELECT id FROM orders WHERE id=$1 AND customer_id=$2", [orderId, user.customer_id])).length)
            fail(404, "Замовлення не знайдено");
        };
        if (resource === "orders" && segments.length === 2 && (method === "GET" && rawId === "recent" || method === "POST" && rawId === "checkout")) {
          // The scoped handlers below bind both history and checkout to this account.
        } else if (resource === "orders" && (method === "GET" && segments.length === 2
          || segments.length === 3 && (method === "GET" && operation === "messages"
            || method === "POST" && ["payment", "messages"].includes(operation ?? "")
            || method === "PATCH" && ["address", "note"].includes(operation ?? "")))) {
          await ownOrder(id());
          if (method === "POST" && operation === "messages" && object(body).sender !== "customer")
            fail(403, "Повідомлення від кур’єра доступне лише в панелі керування");
        } else if (resource === "reviews" && segments.length === 1 && method === "POST") {
          await ownOrder(integer(object(body).order_id, "order_id"));
        } else if (resource === "reviews" && segments.length === 2 && ["PATCH", "DELETE"].includes(method)) {
          const [review] = await rows<{ order_id: number }>(db, "SELECT v.order_id FROM reviews v JOIN orders o ON o.id=v.order_id WHERE v.id=$1 AND o.customer_id=$2", [id(), user.customer_id]);
          if (!review) fail(404, "Відгук не знайдено");
        } else if (!(["review-options", "reviews"].includes(resource ?? "") && segments.length === 1 && method === "GET")) {
          fail(403, "Розділ доступний лише адміністратору");
        }
      }
    }
    if (method === "GET") {
      if (segments.length === 1) {
        if (resource === "session") return { ready: true };
        if (resource === "bootstrap") return bootstrap(user);
        if (resource === "restaurants") return restaurantList(query);
        if (resource === "customers") return customerList(query);
        if (resource === "couriers") return courierList(query);
        if (resource === "orders") return orders.list(query);
        if (resource === "reviews") return reviewList(query, user?.role === "user" ? user.customer_id : null);
        if (resource === "review-options") {
          if (user?.role === "user") return rows(db, "SELECT o.id,r.name AS restaurant,o.order_date FROM orders o JOIN restaurants r ON r.id=o.restaurant_id LEFT JOIN reviews v ON v.order_id=o.id WHERE o.customer_id=$1 AND o.delivery_status='доставлено' AND v.id IS NULL ORDER BY o.order_date DESC,o.id DESC LIMIT 100", [user.customer_id]);
          return reviewOptions();
        }
        if (resource === "analytics") return analytics(query);
      }
      if (segments.length === 2) {
        if (resource === "restaurants" && rawId === "map") return restaurantMap(query);
        if (resource === "restaurants") return restaurantGet(id());
        if (resource === "orders" && rawId === "recent" && user) return orders.recent(query, user.customer_id);
        if (resource === "orders") return orders.get(id());
      }
      if (resource === "couriers" && operation === "delivery") return courierDelivery(id());
      if (resource === "orders" && operation === "messages") return orders.messages(id());
    }
    if (method === "POST") {
      if (segments.length === 1) {
        if (resource === "restaurants") return restaurantSave(null, body);
        if (resource === "menu") return menuSave(null, body);
        if (resource === "customers") return customerCreate(body);
        if (resource === "couriers") return one(db, "INSERT INTO couriers(full_name,phone,vehicle_type) VALUES($1,$2,$3) RETURNING *", courierFields(body));
        if (resource === "reviews") return reviewSave(null, body);
        if (resource === "orders") return orders.create(body);
      }
      if (resource === "orders" && rawId === "checkout" && segments.length === 2 && user) return orders.checkout(body, user.customer_id);
      if (resource === "orders" && operation === "payment") return orders.pay(id(), body);
      if (resource === "orders" && operation === "courier-location") return orders.updateCourierLocation(id(), body);
      if (resource === "orders" && operation === "messages") return orders.sendMessage(id(), body);
    }
    if (method === "PATCH") {
      if (segments.length === 2) {
        if (resource === "restaurants") return restaurantSave(id(), body);
        if (resource === "menu") return menuSave(id(), body);
        if (resource === "reviews") return reviewSave(id(), body);
        if (resource === "couriers") return one(db, "UPDATE couriers SET full_name=$1,phone=$2,vehicle_type=$3 WHERE id=$4 RETURNING *", [...courierFields(body), id()]);
      }
      if (resource === "couriers" && operation === "restore") return courierRestore(id());
      if (resource === "orders" && operation === "status") return orders.changeStatus(id(), body);
      if (resource === "orders" && operation === "note") return orders.saveNote(id(), body);
      if (resource === "orders" && operation === "address") return orders.changeAddress(id(), body);
    }
    if (method === "DELETE" && segments.length === 2) {
      if (resource === "couriers") return courierRemove(id());
      if (resource === "reviews") return one(db, "DELETE FROM reviews WHERE id=$1 RETURNING id", [id()]);
    }
    fail(404, "Сторінку не знайдено");
  }

  return {
    async request(path: string, method = "GET", body?: unknown): Promise<unknown> {
      try { return jsonValue(await route(path, method.toUpperCase(), body)); }
      catch (error) { throw publicError(error); }
    },
  };
}
