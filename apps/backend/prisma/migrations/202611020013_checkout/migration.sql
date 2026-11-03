ALTER TABLE customers ALTER COLUMN email DROP NOT NULL;

ALTER TABLE orders
    ADD COLUMN recipient_name VARCHAR(100),
    ADD COLUMN recipient_phone VARCHAR(20),
    ADD CONSTRAINT order_recipient_pair CHECK (
        (recipient_name IS NULL AND recipient_phone IS NULL)
        OR (recipient_name IS NOT NULL AND recipient_phone IS NOT NULL
            AND length(btrim(recipient_name)) > 0
            AND recipient_phone ~ '^\+?[0-9]{7,15}$')
    );

CREATE FUNCTION guard_order_recipient() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.recipient_name IS DISTINCT FROM OLD.recipient_name
       OR NEW.recipient_phone IS DISTINCT FROM OLD.recipient_phone THEN
        RAISE EXCEPTION 'Контакти одержувача завершеного оформлення не змінюються'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER order_recipient_guard
    BEFORE UPDATE OF recipient_name, recipient_phone ON orders
    FOR EACH ROW EXECUTE FUNCTION guard_order_recipient();

CREATE TABLE _checkout_requests (
    request_key VARCHAR(64) PRIMARY KEY,
    request_hash VARCHAR(64) NOT NULL,
    order_id INTEGER UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
