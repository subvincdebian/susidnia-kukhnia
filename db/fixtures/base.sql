BEGIN;
CREATE TABLE restaurants (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    address VARCHAR(200) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    cuisine_type VARCHAR(50) NOT NULL,
    rating NUMERIC(3,2) NOT NULL DEFAULT 5.0 CHECK (rating BETWEEN 1.0 AND 5.0),
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE menu_items (
    id SERIAL PRIMARY KEY,
    restaurant_id INT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    price NUMERIC(10,2) NOT NULL CHECK (price > 0),
    category VARCHAR(50) NOT NULL,
    is_available BOOLEAN DEFAULT TRUE NOT NULL
);

CREATE TABLE customers (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    phone VARCHAR(20) UNIQUE NOT NULL,
    default_delivery_address VARCHAR(200) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE couriers (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20) UNIQUE NOT NULL,
    vehicle_type VARCHAR(30) NOT NULL CHECK (vehicle_type IN ('пішки', 'велосипед', 'скутер', 'автомобіль')),
    is_available BOOLEAN DEFAULT TRUE NOT NULL
);

CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    customer_id INT NOT NULL REFERENCES customers(id),
    restaurant_id INT NOT NULL REFERENCES restaurants(id),
    courier_id INT REFERENCES couriers(id),
    order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    delivery_address VARCHAR(200) NOT NULL,
    total_amount NUMERIC(10,2) DEFAULT 0 NOT NULL CHECK (total_amount >= 0),
    delivery_status VARCHAR(30) DEFAULT 'створено' NOT NULL CHECK (delivery_status IN ('створено', 'готується', 'в дорозі', 'доставлено', 'скасовано'))
);

CREATE TABLE order_items (
    id SERIAL PRIMARY KEY,
    order_id INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    menu_item_id INT NOT NULL REFERENCES menu_items(id),
    quantity INT DEFAULT 1 NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(10,2) NOT NULL CHECK (unit_price > 0),
    CONSTRAINT uq_order_menu_item UNIQUE (order_id, menu_item_id)
);

INSERT INTO restaurants (name, address, phone, cuisine_type, rating, is_active) VALUES
('Мама Фокачча', 'вул. Хрещатик, 15', '+380000300001', 'Італійська', 4.85, TRUE),
('Суші Майстер', 'вул. Володимирська, 42', '+380000300002', 'Японська', 4.70, TRUE),
('Борщ & Сало', 'пр. Перемоги, 10', '+380000300003', 'Українська', 4.90, TRUE),
('Бургер Хаус', 'вул. Саксаганського, 25', '+380000300004', 'Американська', 4.65, TRUE),
('Тбілісо', 'вул. Велика Васильківська, 30', '+380000300005', 'Грузинська', 4.80, TRUE),
('В''єтнам Привіт', 'Бессарабська площа, 2', '+380000300006', 'Азійська', 4.75, TRUE),
('Піца Паста', 'вул. Басейна, 12', '+380000300007', 'Італійська', 4.55, TRUE),
('Лаваш Гриль', 'вул. Мечникова, 8', '+380000300008', 'Кавказька', 4.60, TRUE),
('Зелений Сад', 'вул. Шота Руставелі, 16', '+380000300009', 'Вегетаріанська', 4.70, TRUE),
('Рідний Смак', 'вул. Антоновича, 50', '+380000300010', 'Українська', 4.80, FALSE);

INSERT INTO menu_items (restaurant_id, name, description, price, category, is_available) VALUES
(1, 'Піца Маргарита', 'Томати, сир моцарела, базилік', 220.00, 'Піца', TRUE),
(1, 'Паста Карбонара', 'Спагеті, бекон, вершковий соус, пармезан', 260.00, 'Основні страви', TRUE),
(2, 'Рол Філадельфія', 'Лосось, вершковий сир, огірок, рис', 310.00, 'Основні страви', TRUE),
(2, 'Місо суп', 'Бульйон дасі, соєва паста тофу, водорості вакаме', 140.00, 'Супи', TRUE),
(3, 'Український борщ', 'Борщ із телятиною, сметаною та пампушками', 180.00, 'Супи', TRUE),
(3, 'Деруни зі сметаною', 'Хрусткі картопляні деруни з зеленню', 150.00, 'Закуски', TRUE),
(4, 'Чизбургер Класик', 'Яловича котлета, чедер, соус, салат', 210.00, 'Бургери', TRUE),
(4, 'Картопля фрі', 'Смажена картопля з фірмовим соусом', 90.00, 'Снеки', TRUE),
(5, 'Хачапурі по-аджарськи', 'Човник із тіста з сулугуні та яйцем', 240.00, 'Випічка', TRUE),
(5, 'Хінкалі з яловичиною', 'Традиційні хінкалі зі спеціями та бульйоном', 190.00, 'Основні страви', TRUE),
(6, 'Суп Фо Бо', 'Яловичий бульйон, рисова локшина, зелень', 230.00, 'Супи', TRUE),
(7, 'Піца Кватро Формаджо', 'Чотири види добірного сиру', 280.00, 'Піца', FALSE);

INSERT INTO customers (full_name, email, phone, default_delivery_address) VALUES
('Клієнт 01', 'customer-01@example.test', '+380000100001', 'Демонстраційна адреса 01'),
('Клієнт 02', 'customer-02@example.test', '+380000100002', 'Демонстраційна адреса 02'),
('Клієнт 03', 'customer-03@example.test', '+380000100003', 'Демонстраційна адреса 03'),
('Клієнт 04', 'customer-04@example.test', '+380000100004', 'Демонстраційна адреса 04'),
('Клієнт 05', 'customer-05@example.test', '+380000100005', 'Демонстраційна адреса 05'),
('Клієнт 06', 'customer-06@example.test', '+380000100006', 'Демонстраційна адреса 06'),
('Клієнт 07', 'customer-07@example.test', '+380000100007', 'Демонстраційна адреса 07'),
('Клієнт 08', 'customer-08@example.test', '+380000100008', 'Демонстраційна адреса 08'),
('Клієнт 09', 'customer-09@example.test', '+380000100009', 'Демонстраційна адреса 09'),
('Клієнт 10', 'customer-10@example.test', '+380000100010', 'Демонстраційна адреса 10');

INSERT INTO couriers (full_name, phone, vehicle_type, is_available) VALUES
('Кур’єр 01', '+380000200001', 'скутер', TRUE),
('Кур’єр 02', '+380000200002', 'велосипед', FALSE),
('Кур’єр 03', '+380000200003', 'автомобіль', TRUE),
('Кур’єр 04', '+380000200004', 'пішки', TRUE),
('Кур’єр 05', '+380000200005', 'скутер', FALSE),
('Кур’єр 06', '+380000200006', 'велосипед', TRUE);

INSERT INTO orders (customer_id, restaurant_id, courier_id, order_date, delivery_address, total_amount, delivery_status) VALUES
(1, 1, 1, '2026-10-05 13:15:00', 'Демонстраційна адреса 01', 480.00, 'доставлено'),
(1, 3, 3, '2026-10-12 18:40:00', 'Демонстраційна адреса 01', 330.00, 'доставлено'),
(1, 2, 2, '2026-10-17 14:10:00', 'Демонстраційна адреса 01', 450.00, 'в дорозі'),
(2, 2, 1, '2026-10-06 14:20:00', 'Демонстраційна адреса 02', 310.00, 'доставлено'),
(3, 4, 3, '2026-10-08 19:10:00', 'Демонстраційна адреса 03', 300.00, 'доставлено'),
(4, 5, 2, '2026-10-09 12:45:00', 'Демонстраційна адреса 04', 430.00, 'доставлено'),
(5, 1, 4, '2026-10-11 15:30:00', 'Демонстраційна адреса 05', 480.00, 'доставлено'),
(6, 3, 5, '2026-10-13 13:00:00', 'Демонстраційна адреса 06', 180.00, 'доставлено'),
(7, 4, 1, '2026-10-15 16:50:00', 'Демонстраційна адреса 07', 300.00, 'доставлено'),
(8, 2, 6, '2026-10-16 11:20:00', 'Демонстраційна адреса 08', 450.00, 'доставлено'),
(9, 5, NULL, '2026-10-17 17:30:00', 'Демонстраційна адреса 09', 240.00, 'готується'),
(10, 6, NULL, '2026-10-17 18:00:00', 'Демонстраційна адреса 10', 230.00, 'створено');

INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price) VALUES
(1, 1, 1, 220.00),
(1, 2, 1, 260.00),
(2, 5, 1, 180.00),
(2, 6, 1, 150.00),
(3, 3, 1, 310.00),
(3, 4, 1, 140.00),
(4, 3, 1, 310.00),
(5, 7, 1, 210.00),
(5, 8, 1, 90.00),
(6, 9, 1, 240.00),
(6, 10, 1, 190.00),
(7, 1, 1, 220.00),
(8, 5, 1, 180.00),
(9, 7, 1, 210.00),
(9, 8, 1, 90.00),
(10, 3, 1, 310.00),
(10, 4, 1, 140.00),
(11, 9, 1, 240.00),
(12, 11, 1, 230.00),
(7, 2, 1, 260.00);
COMMIT;
