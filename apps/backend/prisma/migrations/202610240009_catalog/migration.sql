ALTER TABLE restaurants
    ALTER COLUMN rating DROP NOT NULL,
    ALTER COLUMN rating DROP DEFAULT,
    ADD COLUMN image_url TEXT,
    ADD COLUMN image_alt TEXT,
    ADD COLUMN website_url TEXT,
    ADD COLUMN menu_url TEXT,
    ADD COLUMN source_checked_at VARCHAR(10),
    ADD COLUMN source_note TEXT;

ALTER TABLE menu_items
    ADD COLUMN image_url TEXT,
    ADD COLUMN image_alt TEXT,
    ADD COLUMN source_url TEXT,
    ADD COLUMN portion TEXT;
