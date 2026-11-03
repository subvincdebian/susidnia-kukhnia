BEGIN;
ALTER TABLE couriers ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE payments ADD COLUMN refunded_at TIMESTAMP;
ALTER TABLE payments ADD CONSTRAINT payment_refund_time CHECK (refunded_at IS NULL OR refunded_at >= paid_at);

CREATE OR REPLACE FUNCTION guard_payment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target orders%ROWTYPE;
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION 'Зареєстрована оплата незмінна' USING ERRCODE='23514';
    END IF;
    SELECT * INTO target FROM orders WHERE id=NEW.order_id FOR UPDATE;
    IF TG_OP='UPDATE' THEN
        IF NEW.id=OLD.id AND NEW.order_id=OLD.order_id AND NEW.amount=OLD.amount
           AND NEW.method=OLD.method AND NEW.paid_at=OLD.paid_at
           AND OLD.refunded_at IS NULL AND NEW.refunded_at IS NOT NULL
           AND target.delivery_status='скасовано' THEN RETURN NEW; END IF;
        RAISE EXCEPTION 'Зареєстрована оплата незмінна' USING ERRCODE='23514';
    END IF;
    IF NOT FOUND OR target.delivery_status NOT IN ('створено','готується','в дорозі')
       OR target.total_amount<=0 OR NEW.amount<>target.total_amount OR NEW.refunded_at IS NOT NULL THEN
        RAISE EXCEPTION 'Оплата має відповідати активному замовленню' USING ERRCODE='23514';
    END IF;
    IF target.delivery_status<>'в дорозі' AND NEW.method<>'картка' THEN
        RAISE EXCEPTION 'До отримання доступна лише оплата карткою' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION record_order_payment(p_order_id INTEGER, p_method TEXT)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE target orders%ROWTYPE; payment_id INTEGER; actual_total NUMERIC;
BEGIN
    IF p_method IS NULL OR p_method<>'картка' THEN
        RAISE EXCEPTION 'До отримання доступна лише оплата карткою' USING ERRCODE='23514';
    END IF;
    SELECT * INTO target FROM orders WHERE id=p_order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Замовлення не знайдено' USING ERRCODE='P0002'; END IF;
    IF target.delivery_status='скасовано' THEN
        RAISE EXCEPTION 'Скасоване замовлення не оплачується' USING ERRCODE='23514';
    END IF;
    SELECT id INTO payment_id FROM payments WHERE order_id=p_order_id;
    IF payment_id IS NOT NULL THEN RETURN payment_id; END IF;
    IF target.delivery_status NOT IN ('створено','готується','в дорозі') THEN
        RAISE EXCEPTION 'Замовлення вже завершене' USING ERRCODE='23514';
    END IF;
    SELECT SUM(quantity*unit_price) INTO actual_total FROM order_items WHERE order_id=p_order_id;
    IF actual_total IS NULL OR actual_total<=0 OR actual_total<>target.total_amount THEN
        RAISE EXCEPTION 'Сума замовлення не відповідає позиціям' USING ERRCODE='23514';
    END IF;
    INSERT INTO payments(order_id,amount,method) VALUES(p_order_id,target.total_amount,p_method)
    RETURNING id INTO payment_id;
    RETURN payment_id;
END;
$$;

CREATE FUNCTION refund_cancelled_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.delivery_status='скасовано' AND OLD.delivery_status<>'скасовано' THEN
        UPDATE payments SET refunded_at=GREATEST(LOCALTIMESTAMP,paid_at)
        WHERE order_id=NEW.id AND refunded_at IS NULL;
    END IF;
    RETURN NULL;
END;
$$;
CREATE TRIGGER order_payment_refund AFTER UPDATE OF delivery_status ON orders
FOR EACH ROW EXECUTE FUNCTION refund_cancelled_order();
CREATE OR REPLACE FUNCTION guard_order_item() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent orders%ROWTYPE; dish menu_items%ROWTYPE;
BEGIN
    IF TG_OP = 'UPDATE' AND (NEW.order_id <> OLD.order_id OR NEW.menu_item_id <> OLD.menu_item_id) THEN
        RAISE EXCEPTION 'Не можна переносити позицію в інше замовлення' USING ERRCODE='23514';
    END IF;
    SELECT * INTO parent FROM orders
    WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END FOR UPDATE;
    IF NOT FOUND THEN RETURN OLD; END IF;
    IF EXISTS (SELECT 1 FROM payments WHERE order_id=parent.id) THEN
        RAISE EXCEPTION 'Позиції оплаченого замовлення незмінні' USING ERRCODE='23514';
    END IF;
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

CREATE OR REPLACE FUNCTION complete_order(p_order_id INTEGER, p_method TEXT)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE target orders%ROWTYPE; payment_id INTEGER; actual_total NUMERIC;
BEGIN
    IF p_method IS NOT NULL AND p_method NOT IN ('картка', 'готівка') THEN
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
    IF payment_id IS NULL THEN
        IF p_method IS NULL THEN
            RAISE EXCEPTION 'Оберіть спосіб оплати' USING ERRCODE='23514';
        END IF;
        INSERT INTO payments(order_id, amount, method)
        VALUES (p_order_id, target.total_amount, p_method) RETURNING id INTO payment_id;
    END IF;
    UPDATE orders SET delivery_status = 'доставлено' WHERE id = p_order_id;
    UPDATE couriers SET is_available = TRUE WHERE id = target.courier_id
      AND NOT EXISTS (SELECT 1 FROM orders
                      WHERE courier_id = target.courier_id
                        AND delivery_status = 'в дорозі');
    RETURN payment_id;
END;
$$;
COMMIT;
