export const money = (value: string | number) =>
  new Intl.NumberFormat("uk-UA", {
    style: "currency",
    currency: "UAH",
    maximumFractionDigits: 2,
  }).format(Number(value));
export const dateTime = (value: string) =>
  new Intl.DateTimeFormat("uk-UA", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Kyiv",
  }).format(new Date(value));
export const displayValue = (value: unknown): string =>
  value === null
    ? "NULL"
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value ?? "");
export function downloadCsv(
  fields: string[],
  rows: Record<string, unknown>[],
  filename: string,
) {
  const escape = (value: unknown) =>
    `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv =
    "\ufeff" +
    [fields, ...rows.map((row) => fields.map((field) => row[field]))]
      .map((row) => row.map(escape).join(";"))
      .join("\r\n");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
