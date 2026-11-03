export class HttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly fields: Record<string,string> = {}) { super(message); }
}
export function object(value: unknown): Record<string,unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400,"Очікується об'єкт полів");
  return Object.fromEntries(Object.entries(value));
}
export function text(value: unknown, name: string, max=200, min=1): string {
  if(typeof value !== 'string' || value.trim().length < min || value.trim().length > max)
    throw new HttpError(400,'Перевірте заповнення полів',{[name]:`Від ${min} до ${max} символів`});
  return value.trim();
}
export function integer(value: unknown, name: string, min=1, max=2147483647): number {
  if(typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    throw new HttpError(400,'Перевірте числове поле',{[name]:`Ціле число від ${min} до ${max}`});
  return value;
}
export function money(value: unknown): string {
  if(typeof value !== 'string' || !/^\d{1,8}(\.\d{1,2})?$/.test(value) || Number(value)<=0)
    throw new HttpError(400,'Перевірте ціну',{price:'Додатна сума, максимум два знаки після крапки'});
  return value;
}
export function flag(value: unknown, name: string): boolean {
  if(typeof value !== 'boolean') throw new HttpError(400,'Перевірте стан поля',{[name]:'Оберіть значення'});
  return value;
}
export function date(value: unknown, name: string): string {
  if(typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10)!==value)
    throw new HttpError(400,'Перевірте період',{[name]:'Вкажіть правильну дату'});
  return value;
}
export const statuses=['створено','готується','в дорозі','доставлено','скасовано'];
export function filters(input: unknown) {
  const q=object(input);
  return {q:q.q ? text(q.q,'q',100,0) : '',page:q.page ? integer(Number(q.page),'page',1,100000) : 1,status:q.status ? text(q.status,'status',30) : ''};
}
export function phone(value: unknown): string {
  const p=text(value,'phone',20);
  if(!/^\+?[\d ()-]{7,20}$/.test(p))throw new HttpError(400,'Перевірте телефон',{phone:'Вкажіть номер телефону'});
  return p;
}
