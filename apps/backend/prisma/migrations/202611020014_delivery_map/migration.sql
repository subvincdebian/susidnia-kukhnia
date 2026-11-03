BEGIN;

ALTER TABLE restaurants
    ADD COLUMN latitude DOUBLE PRECISION,
    ADD COLUMN longitude DOUBLE PRECISION,
    ADD COLUMN coordinate_source TEXT,
    ADD CONSTRAINT restaurant_coordinate_pair CHECK (
        (latitude IS NULL AND longitude IS NULL AND coordinate_source IS NULL)
        OR (latitude IS NOT NULL AND longitude IS NOT NULL
            AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180
            AND coordinate_source IS NOT NULL AND coordinate_source ~ '^https://')
    );

ALTER TABLE orders
    ADD COLUMN delivery_latitude DOUBLE PRECISION,
    ADD COLUMN delivery_longitude DOUBLE PRECISION,
    ADD COLUMN address_version INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN courier_latitude DOUBLE PRECISION,
    ADD COLUMN courier_longitude DOUBLE PRECISION,
    ADD COLUMN courier_location_at TIMESTAMP,
    ADD COLUMN courier_location_source VARCHAR(10),
    ADD CONSTRAINT order_delivery_coordinate_pair CHECK (
        (delivery_latitude IS NULL AND delivery_longitude IS NULL)
        OR (delivery_latitude IS NOT NULL AND delivery_longitude IS NOT NULL
            AND delivery_latitude BETWEEN -90 AND 90 AND delivery_longitude BETWEEN -180 AND 180)
    ),
    ADD CONSTRAINT order_address_version_nonnegative CHECK (address_version >= 0),
    ADD CONSTRAINT order_courier_coordinate_pair CHECK (
        (courier_latitude IS NULL AND courier_longitude IS NULL
            AND courier_location_at IS NULL AND courier_location_source IS NULL)
        OR (courier_latitude IS NOT NULL AND courier_longitude IS NOT NULL
            AND courier_latitude BETWEEN -90 AND 90 AND courier_longitude BETWEEN -180 AND 180
            AND courier_location_at IS NOT NULL AND courier_location_source IS NOT NULL
            AND courier_location_source IN ('gps','manual'))
    );

CREATE FUNCTION guard_order_address() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.delivery_address IS DISTINCT FROM OLD.delivery_address
       OR NEW.delivery_latitude IS DISTINCT FROM OLD.delivery_latitude
       OR NEW.delivery_longitude IS DISTINCT FROM OLD.delivery_longitude
       OR NEW.address_version IS DISTINCT FROM OLD.address_version THEN
        IF OLD.delivery_status NOT IN ('створено','готується') OR OLD.courier_id IS NOT NULL
           OR NEW.address_version <> OLD.address_version + 1 THEN
            RAISE EXCEPTION 'Адреса змінюється лише до передавання кур''єру з новою версією'
                USING ERRCODE='23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER order_address_guard
    BEFORE UPDATE OF delivery_address, delivery_latitude, delivery_longitude, address_version ON orders
    FOR EACH ROW EXECUTE FUNCTION guard_order_address();

CREATE FUNCTION guard_courier_location() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.courier_latitude IS DISTINCT FROM OLD.courier_latitude
       OR NEW.courier_longitude IS DISTINCT FROM OLD.courier_longitude
       OR NEW.courier_location_at IS DISTINCT FROM OLD.courier_location_at
       OR NEW.courier_location_source IS DISTINCT FROM OLD.courier_location_source THEN
        IF OLD.delivery_status <> 'в дорозі' OR OLD.courier_id IS NULL THEN
            RAISE EXCEPTION 'Координати кур''єра оновлюються лише під час активної доставки'
                USING ERRCODE='23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER order_courier_location_guard
    BEFORE UPDATE OF courier_latitude, courier_longitude, courier_location_at, courier_location_source ON orders
    FOR EACH ROW EXECUTE FUNCTION guard_courier_location();

CREATE TABLE delivery_messages (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    sender VARCHAR(10) NOT NULL CHECK (sender IN ('customer','courier')),
    body VARCHAR(1000) NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 1000),
    request_key VARCHAR(64) NOT NULL CHECK (request_key ~ '^[A-Za-z0-9_-]{8,64}$'),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_delivery_message_request UNIQUE(order_id,request_key)
);
CREATE INDEX idx_delivery_messages_order ON delivery_messages(order_id,id DESC);

CREATE FUNCTION guard_delivery_message() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE target orders%ROWTYPE;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Історія листування незмінна' USING ERRCODE='23514';
    END IF;
    SELECT * INTO target FROM orders WHERE id=NEW.order_id FOR UPDATE;
    IF NOT FOUND OR target.delivery_status <> 'в дорозі' OR target.courier_id IS NULL THEN
        RAISE EXCEPTION 'Листування доступне після передавання замовлення кур''єру'
            USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER delivery_message_guard BEFORE INSERT OR UPDATE OR DELETE ON delivery_messages
    FOR EACH ROW EXECUTE FUNCTION guard_delivery_message();

COMMIT;
