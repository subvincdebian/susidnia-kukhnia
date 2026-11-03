export const managementOverview = {
  view: "manage",
  label: "Огляд керування",
};

export const managementGroups = [
  {
    label: "Доставка",
    links: [
      {
        view: "orders",
        label: "Замовлення",
        description: "Оформлення, оплата, призначення кур’єра та доставка.",
      },
      {
        view: "couriers",
        label: "Кур’єри",
        description: "Контакти, транспорт і доступність кур’єрів.",
      },
    ],
  },
  {
    label: "Каталог і контакти",
    links: [
      {
        view: "manage-restaurants",
        label: "Заклади й меню",
        description: "Дані закладів, страви, ціни та доступність у каталозі.",
      },
      {
        view: "customers",
        label: "Клієнти",
        description: "Контакти та адреси клієнтів для замовлень.",
      },
    ],
  },
  {
    label: "Звіти й дані",
    links: [
      {
        view: "reviews",
        label: "Відгуки",
        description: "Оцінки та коментарі до доставлених замовлень.",
      },
      {
        view: "analytics",
        label: "Аналітика",
        description: "Показники замовлень і відгуків за період.",
      },
    ],
  },
];

export const managementLinks = [
  managementOverview,
  ...managementGroups.flatMap((group) => group.links),
];
