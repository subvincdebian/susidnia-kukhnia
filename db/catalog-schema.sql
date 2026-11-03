SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', 'public', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

CREATE FUNCTION public.check_review_order() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE ordered_at TIMESTAMP; current_status TEXT;
BEGIN
    SELECT order_date, delivery_status INTO ordered_at, current_status
    FROM orders WHERE id = NEW.order_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Замовлення не знайдено' USING ERRCODE = '23503';
    END IF;
    IF current_status <> 'доставлено' THEN
        RAISE EXCEPTION 'Відгук дозволено лише після доставки'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.created_at < ordered_at THEN
        RAISE EXCEPTION 'Дата відгуку передує замовленню'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.complete_order(p_order_id integer, p_method text) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE target orders%ROWTYPE; payment_id INTEGER; actual_total NUMERIC;
BEGIN
    IF p_method IS NULL OR p_method NOT IN ('картка', 'готівка') THEN
        RAISE EXCEPTION 'Оберіть спосіб оплати' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO target FROM orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Замовлення не знайдено' USING ERRCODE = 'P0002';
    END IF;
    SELECT id INTO payment_id FROM payments WHERE order_id = p_order_id;
    IF target.delivery_status = 'доставлено' AND payment_id IS NOT NULL THEN
        RETURN payment_id;
    END IF;
    IF target.delivery_status <> 'в дорозі' OR target.courier_id IS NULL THEN
        RAISE EXCEPTION 'Завершити можна лише замовлення в дорозі з кур''єром'
            USING ERRCODE = '23514';
    END IF;
    SELECT SUM(quantity * unit_price) INTO actual_total
    FROM order_items WHERE order_id = p_order_id;
    IF actual_total IS NULL OR actual_total <> target.total_amount THEN
        RAISE EXCEPTION 'Сума замовлення не відповідає позиціям'
            USING ERRCODE = '23514';
    END IF;
    INSERT INTO payments(order_id, amount, method)
    VALUES (p_order_id, target.total_amount, p_method) RETURNING id INTO payment_id;
    UPDATE orders SET delivery_status = 'доставлено' WHERE id = p_order_id;
    UPDATE couriers SET is_available = TRUE WHERE id = target.courier_id
      AND NOT EXISTS (SELECT 1 FROM orders
                      WHERE courier_id = target.courier_id
                        AND delivery_status = 'в дорозі');
    RETURN payment_id;
END;
$$;

CREATE FUNCTION public.guard_order_item() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE parent orders%ROWTYPE; dish menu_items%ROWTYPE;
BEGIN
    IF TG_OP = 'UPDATE' AND (NEW.order_id <> OLD.order_id OR NEW.menu_item_id <> OLD.menu_item_id) THEN
        RAISE EXCEPTION 'Не можна переносити позицію в інше замовлення' USING ERRCODE='23514';
    END IF;
    SELECT * INTO parent FROM orders
    WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END FOR UPDATE;
    IF NOT FOUND THEN RETURN OLD; END IF;
    IF parent.delivery_status <> 'створено' THEN
        RAISE EXCEPTION 'Позиції можна змінювати лише у створеному замовленні' USING ERRCODE='23514';
    END IF;
    IF TG_OP <> 'DELETE' THEN
        SELECT * INTO dish FROM menu_items WHERE id=NEW.menu_item_id FOR SHARE;
        IF NOT FOUND OR dish.restaurant_id <> parent.restaurant_id THEN
            RAISE EXCEPTION 'Страва має належати ресторану замовлення' USING ERRCODE='23514';
        END IF;
        IF TG_OP = 'INSERT' AND NOT dish.is_available THEN
            RAISE EXCEPTION 'Страва недоступна' USING ERRCODE='23514';
        END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_order_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE actual_total NUMERIC;
BEGIN
    IF OLD.delivery_status IN ('в дорозі','доставлено','скасовано')
       AND NEW.courier_id IS DISTINCT FROM OLD.courier_id THEN
        RAISE EXCEPTION 'Кур''єр активної або завершеної доставки незмінний' USING ERRCODE='23514';
    END IF;
    IF NEW.customer_id<>OLD.customer_id OR NEW.restaurant_id<>OLD.restaurant_id
       OR NEW.order_date<>OLD.order_date THEN
        RAISE EXCEPTION 'Клієнт, ресторан та дата оформленого замовлення незмінні' USING ERRCODE='23514';
    END IF;
    SELECT COALESCE(SUM(quantity*unit_price),0) INTO actual_total FROM order_items WHERE order_id=OLD.id;
    IF NEW.total_amount<>actual_total THEN
        RAISE EXCEPTION 'Сума має відповідати позиціям замовлення' USING ERRCODE='23514';
    END IF;
    IF NEW.delivery_status<>OLD.delivery_status THEN
        IF NOT ((OLD.delivery_status='створено' AND NEW.delivery_status IN ('готується','скасовано'))
             OR (OLD.delivery_status='готується' AND NEW.delivery_status IN ('в дорозі','скасовано'))
             OR (OLD.delivery_status='в дорозі' AND NEW.delivery_status IN ('доставлено','скасовано'))) THEN
            RAISE EXCEPTION 'Недопустима зміна статусу замовлення' USING ERRCODE='23514';
        END IF;
        IF NEW.delivery_status IN ('готується','в дорозі','доставлено') AND actual_total<=0 THEN
            RAISE EXCEPTION 'Замовлення не містить позицій' USING ERRCODE='23514';
        END IF;
        IF NEW.delivery_status='доставлено' AND NOT EXISTS
           (SELECT 1 FROM payments WHERE order_id=OLD.id AND amount=NEW.total_amount) THEN
            RAISE EXCEPTION 'Потрібно зафіксувати оплату' USING ERRCODE='23514';
        END IF;
    END IF;
    IF NEW.delivery_status='в дорозі' AND NEW.courier_id IS NULL THEN
        RAISE EXCEPTION 'Призначте кур''єра' USING ERRCODE='23514';
    END IF;
    IF OLD.delivery_status IN ('доставлено','скасовано') AND NEW IS DISTINCT FROM OLD THEN
        RAISE EXCEPTION 'Завершене замовлення не редагується' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_payment() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE target orders%ROWTYPE;
BEGIN
    IF TG_OP<>'INSERT' THEN
        RAISE EXCEPTION 'Зареєстрована оплата незмінна' USING ERRCODE='23514';
    END IF;
    SELECT * INTO target FROM orders WHERE id=NEW.order_id FOR UPDATE;
    IF NOT FOUND OR target.delivery_status<>'в дорозі' OR NEW.amount<>target.total_amount THEN
        RAISE EXCEPTION 'Оплата має відповідати замовленню в дорозі' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.recalculate_order() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE parent_id INTEGER;
BEGIN
    parent_id := CASE WHEN TG_OP='DELETE' THEN OLD.order_id ELSE NEW.order_id END;
    UPDATE orders SET total_amount=(SELECT COALESCE(SUM(quantity*unit_price),0)
                                    FROM order_items WHERE order_id=parent_id)
    WHERE id=parent_id;
    RETURN NULL;
END;
$$;

SET default_tablespace = '';

SET default_table_access_method = heap;

CREATE TABLE public.couriers (
    id integer NOT NULL,
    full_name character varying(100) NOT NULL,
    phone character varying(20) NOT NULL,
    vehicle_type character varying(30) NOT NULL,
    is_available boolean DEFAULT true NOT NULL,
    CONSTRAINT couriers_vehicle_type_check CHECK (vehicle_type IN ('пішки', 'велосипед', 'скутер', 'автомобіль'))
);

CREATE TABLE public.customers (
    id integer NOT NULL,
    full_name character varying(100) NOT NULL,
    email character varying(100) NOT NULL,
    phone character varying(20) NOT NULL,
    default_delivery_address character varying(200) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.orders (
    id integer NOT NULL,
    customer_id integer NOT NULL,
    restaurant_id integer NOT NULL,
    courier_id integer,
    order_date timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    delivery_address character varying(200) NOT NULL,
    total_amount numeric(10,2) DEFAULT 0 NOT NULL,
    delivery_status character varying(30) DEFAULT 'створено'::character varying NOT NULL,
    delivery_note text DEFAULT ''::text NOT NULL,
    CONSTRAINT ck_delivery_note_length CHECK ((length(delivery_note) <= 500)),
    CONSTRAINT orders_delivery_status_check CHECK (delivery_status IN ('створено', 'готується', 'в дорозі', 'доставлено', 'скасовано')),
    CONSTRAINT orders_total_amount_check CHECK ((total_amount >= (0)::numeric))
);

CREATE TABLE public.restaurants (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    address character varying(200) NOT NULL,
    phone character varying(20) NOT NULL,
    cuisine_type character varying(50) NOT NULL,
    rating numeric(3,2) DEFAULT 5.0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT restaurants_rating_check CHECK (((rating >= 1.0) AND (rating <= 5.0)))
);

CREATE VIEW active_orders AS
SELECT o.id, o.order_date, c.full_name AS customer,
       c.phone AS customer_phone, r.name AS restaurant,
       co.full_name AS courier, o.delivery_address, o.delivery_note,
       o.total_amount, o.delivery_status
FROM orders o
JOIN customers c ON c.id = o.customer_id
JOIN restaurants r ON r.id = o.restaurant_id
LEFT JOIN couriers co ON co.id = o.courier_id
WHERE o.delivery_status IN ('створено', 'готується', 'в дорозі');

CREATE SEQUENCE public.couriers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.couriers_id_seq OWNED BY public.couriers.id;

CREATE SEQUENCE public.customers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.customers_id_seq OWNED BY public.customers.id;

CREATE TABLE public.menu_items (
    id integer NOT NULL,
    restaurant_id integer NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    price numeric(10,2) NOT NULL,
    category character varying(50) NOT NULL,
    is_available boolean DEFAULT true NOT NULL,
    CONSTRAINT menu_items_price_check CHECK ((price > (0)::numeric))
);

CREATE SEQUENCE public.menu_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.menu_items_id_seq OWNED BY public.menu_items.id;

CREATE TABLE public.order_items (
    id integer NOT NULL,
    order_id integer NOT NULL,
    menu_item_id integer NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    unit_price numeric(10,2) NOT NULL,
    CONSTRAINT order_items_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT order_items_unit_price_check CHECK ((unit_price > (0)::numeric))
);

CREATE SEQUENCE public.order_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.order_items_id_seq OWNED BY public.order_items.id;

CREATE SEQUENCE public.orders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.orders_id_seq OWNED BY public.orders.id;

CREATE TABLE public.payments (
    id integer NOT NULL,
    order_id integer NOT NULL,
    amount numeric(10,2) NOT NULL,
    method character varying(20) NOT NULL,
    paid_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT payments_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT payments_method_check CHECK (method IN ('картка', 'готівка'))
);

ALTER TABLE public.payments ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.payments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE SEQUENCE public.restaurants_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.restaurants_id_seq OWNED BY public.restaurants.id;

CREATE TABLE public.reviews (
    id integer NOT NULL,
    order_id integer NOT NULL,
    rating smallint NOT NULL,
    comment text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT reviews_comment_check CHECK (((length(btrim(comment)) >= 1) AND (length(btrim(comment)) <= 2000))),
    CONSTRAINT reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);

ALTER TABLE public.reviews ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.reviews_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE ONLY public.couriers ALTER COLUMN id SET DEFAULT nextval('public.couriers_id_seq'::regclass);

ALTER TABLE ONLY public.customers ALTER COLUMN id SET DEFAULT nextval('public.customers_id_seq'::regclass);

ALTER TABLE ONLY public.menu_items ALTER COLUMN id SET DEFAULT nextval('public.menu_items_id_seq'::regclass);

ALTER TABLE ONLY public.order_items ALTER COLUMN id SET DEFAULT nextval('public.order_items_id_seq'::regclass);

ALTER TABLE ONLY public.orders ALTER COLUMN id SET DEFAULT nextval('public.orders_id_seq'::regclass);

ALTER TABLE ONLY public.restaurants ALTER COLUMN id SET DEFAULT nextval('public.restaurants_id_seq'::regclass);

ALTER TABLE ONLY public.couriers
    ADD CONSTRAINT couriers_phone_key UNIQUE (phone);

ALTER TABLE ONLY public.couriers
    ADD CONSTRAINT couriers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_email_key UNIQUE (email);

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_phone_key UNIQUE (phone);

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.menu_items
    ADD CONSTRAINT menu_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_order_id_key UNIQUE (order_id);

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.restaurants
    ADD CONSTRAINT restaurants_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_order_id_key UNIQUE (order_id);

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT uq_order_menu_item UNIQUE (order_id, menu_item_id);

CREATE INDEX idx_menu_items_restaurant ON public.menu_items USING btree (restaurant_id);

CREATE INDEX idx_order_items_menu ON public.order_items USING btree (menu_item_id);

CREATE INDEX idx_orders_customer_date ON public.orders USING btree (customer_id, order_date DESC);

CREATE INDEX idx_orders_restaurant ON public.orders USING btree (restaurant_id);

CREATE UNIQUE INDEX uq_courier_active_delivery ON public.orders USING btree (courier_id) WHERE ((delivery_status)::text = 'в дорозі'::text);

CREATE TRIGGER order_item_guard BEFORE INSERT OR DELETE OR UPDATE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.guard_order_item();

CREATE TRIGGER order_items_total AFTER INSERT OR DELETE OR UPDATE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.recalculate_order();

CREATE TRIGGER order_update_guard BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.guard_order_update();

CREATE TRIGGER payment_guard BEFORE INSERT OR DELETE OR UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.guard_payment();

CREATE TRIGGER reviews_order_check BEFORE INSERT OR UPDATE ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.check_review_order();

ALTER TABLE ONLY public.menu_items
    ADD CONSTRAINT menu_items_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_menu_item_id_fkey FOREIGN KEY (menu_item_id) REFERENCES public.menu_items(id);

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_courier_id_fkey FOREIGN KEY (courier_id) REFERENCES public.couriers(id);

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id);

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);
SET search_path TO public;
