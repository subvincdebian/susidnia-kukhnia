BEGIN;
CREATE UNIQUE INDEX uq_courier_active_delivery ON orders(courier_id)
WHERE delivery_status = 'в дорозі';

CREATE FUNCTION guard_order_item() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER order_item_guard BEFORE INSERT OR UPDATE OR DELETE ON order_items
FOR EACH ROW EXECUTE FUNCTION guard_order_item();

CREATE FUNCTION recalculate_order() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id INTEGER;
BEGIN
    parent_id := CASE WHEN TG_OP='DELETE' THEN OLD.order_id ELSE NEW.order_id END;
    UPDATE orders SET total_amount=(SELECT COALESCE(SUM(quantity*unit_price),0)
                                    FROM order_items WHERE order_id=parent_id)
    WHERE id=parent_id;
    RETURN NULL;
END;
$$;
CREATE TRIGGER order_items_total AFTER INSERT OR UPDATE OR DELETE ON order_items
FOR EACH ROW EXECUTE FUNCTION recalculate_order();

CREATE FUNCTION guard_order_update() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER order_update_guard BEFORE UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION guard_order_update();

CREATE FUNCTION guard_payment() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER payment_guard BEFORE INSERT OR UPDATE OR DELETE ON payments
FOR EACH ROW EXECUTE FUNCTION guard_payment();

CREATE INDEX idx_orders_customer_date ON orders(customer_id,order_date DESC);
CREATE INDEX idx_orders_restaurant ON orders(restaurant_id);
CREATE INDEX idx_menu_items_restaurant ON menu_items(restaurant_id);
CREATE INDEX idx_order_items_menu ON order_items(menu_item_id);
COMMIT;
