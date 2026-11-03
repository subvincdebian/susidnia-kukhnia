BEGIN;
ALTER TABLE restaurants ADD COLUMN catalog_key VARCHAR(100);
CREATE UNIQUE INDEX restaurants_catalog_key_key ON restaurants(catalog_key);
COMMIT;
