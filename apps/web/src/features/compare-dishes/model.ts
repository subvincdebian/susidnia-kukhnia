export function portionPrice(price: string | number, portion?: string | null) {
  const match = portion
    ?.trim()
    .match(/^(\d{1,6}(?:[.,]\d{1,3})?)\s*(г|g|кг|kg|мл|ml|л|l)$/iu);
  if (!match) return null;
  const amount = Number(match[1]?.replace(",", "."));
  const unit = match[2]?.toLocaleLowerCase("uk-UA");
  const value = Number(price);
  if (!amount || !Number.isFinite(value) || value <= 0) return null;
  const quantity =
    amount *
    (unit === "кг" || unit === "kg" || unit === "л" || unit === "l" ? 1000 : 1);
  const weight = unit === "г" || unit === "g" || unit === "кг" || unit === "kg";
  return {
    price: Math.round(value * 100) / quantity,
    unit: weight ? "г" : "мл",
  };
}
