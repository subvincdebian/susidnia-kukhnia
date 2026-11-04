import type { PGliteInterface } from "@electric-sql/pglite";
import { rows, one, type Row } from "./sql.ts";
import { fail, object, phone, text } from "./validation.ts";

export interface BrowserUser extends Row {
  id: number;
  role: "admin" | "user";
  email: string;
  full_name: string;
  phone: string;
  customer_id: number;
}
export interface BrowserTokenStore { get(): string | null; set(token: string | null): void }
const iterations = 600000;
const encoder = new TextEncoder();
const dummyHash = "pbkdf2-sha256$600000$slNmwoKU8hEMsy3NpD/aHg==$rqVi8DgyyZjsMNWxpDkjx2MAGmHLMV/wl9TgjsfphD4=";
const fields = "u.id,u.role,u.email,u.customer_id,c.full_name,c.phone";
const base64 = (value: Uint8Array) => btoa(String.fromCharCode(...value));
const bytes = (value: string) => Uint8Array.from(atob(value), char => char.charCodeAt(0));
const random = (length: number) => crypto.getRandomValues(new Uint8Array(length));
async function derive(password: string, salt: Uint8Array) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new Uint8Array(salt), iterations }, key, 256));
}
async function passwordHash(password: string) {
  const salt = random(16);
  return `pbkdf2-sha256$${iterations}$${base64(salt)}$${base64(await derive(password, salt))}`;
}
async function passwordMatches(password: string, hash: string) {
  const parts = hash.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256" || parts[1] !== String(iterations)) return false;
  try {
    const salt = bytes(parts[2] ?? ""), expected = bytes(parts[3] ?? "");
    if (salt.length !== 16 || expected.length !== 32) return false;
    const actual = await derive(password, salt);
    let difference = 0;
    for (let i = 0; i < expected.length; i++) difference |= (expected[i] ?? 0) ^ (actual[i] ?? 0);
    return difference === 0;
  } catch { return false; }
}
async function tokenHash(token: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(token)));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}
function email(value: unknown) {
  const result = text(value, "email", 100).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) fail(400, "Перевірте пошту", { email: "Вкажіть правильну електронну адресу" });
  return result;
}
function password(value: unknown, minimum = 10) {
  if (typeof value !== "string" || value.length < minimum || value.length > 128)
    fail(400, "Перевірте пароль", { password: `Від ${minimum} до 128 символів` });
  return value;
}
export function memoryTokenStore(): BrowserTokenStore {
  let token: string | null = null;
  return { get: () => token, set: value => { token = value; } };
}

export function createBrowserAuth(db: PGliteInterface, store: BrowserTokenStore) {
  const attempts = new Map<string, { count: number; reset: number }>();
  function currentToken() {
    try { return store.get(); }
    catch { fail(503, "Немає доступу до сховища браузера. Дозвольте збереження даних і повторіть спробу"); }
  }
  function saveToken(value: string | null) {
    try { store.set(value); }
    catch { fail(503, "Не вдалося зберегти сеанс у браузері. Дозвольте збереження даних"); }
  }
  async function current(): Promise<BrowserUser | null> {
    const token = currentToken();
    if (!token) return null;
    const [user] = await rows<BrowserUser>(db, `SELECT ${fields} FROM auth_sessions s JOIN app_users u ON u.id=s.user_id
      JOIN customers c ON c.id=u.customer_id WHERE s.token_hash=$1 AND s.expires_at>CURRENT_TIMESTAMP`, [await tokenHash(token)]);
    if (!user && currentToken() === token) saveToken(null);
    return user ?? null;
  }
  async function start(userId: number) {
    const previous = currentToken(), token = base64(random(32));
    const hash = await tokenHash(token);
    const user = await one<BrowserUser>(db, `SELECT ${fields} FROM app_users u JOIN customers c ON c.id=u.customer_id WHERE u.id=$1`, [userId]);
    await db.query("INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES($1,$2,CURRENT_TIMESTAMP+INTERVAL '8 hours')", [hash, userId]);
    try { saveToken(token); }
    catch (error) { await db.query("DELETE FROM auth_sessions WHERE token_hash=$1", [hash]); throw error; }
    if (previous) await db.query("DELETE FROM auth_sessions WHERE token_hash=$1", [await tokenHash(previous)]);
    return { user };
  }
  return {
    current,
    async login(input: unknown) {
      const body = object(input), address = email(body.email), secret = password(body.password, 1);
      const prior = attempts.get(address), limit = prior && prior.reset > Date.now() ? prior : { count: 0, reset: Date.now() + 15 * 60 * 1000 };
      if (limit.count >= 10) fail(429, "Забагато спроб входу. Спробуйте пізніше");
      limit.count++; attempts.set(address, limit);
      if (attempts.size > 100) {
        const first = attempts.keys().next().value;
        if (first !== undefined && first !== address) attempts.delete(first);
      }
      const [user] = await rows<BrowserUser & { password_hash: string }>(db, `SELECT ${fields},u.password_hash FROM app_users u JOIN customers c ON c.id=u.customer_id WHERE u.email=$1`, [address]);
      const valid = await passwordMatches(secret, user?.password_hash ?? dummyHash);
      if (!user || !valid) fail(401, "Неправильна пошта або пароль");
      attempts.delete(address);
      return start(user.id);
    },
    async register(input: unknown) {
      const body = object(input), address = email(body.email), secret = password(body.password);
      const name = text(body.full_name, "full_name", 100), contact = phone(body.phone);
      const delivery = body.default_delivery_address === undefined ? "Адресу не вказано" : text(body.default_delivery_address, "default_delivery_address", 200);
      const hash = await passwordHash(secret);
      const userId = await db.transaction(async tx => {
        const customer = await one<{ id: number }>(tx, "INSERT INTO customers(full_name,email,phone,default_delivery_address) VALUES($1,$2,$3,$4) RETURNING id", [name, address, contact, delivery]);
        const user = await one<{ id: number }>(tx, "INSERT INTO app_users(customer_id,email,password_hash,role) VALUES($1,$2,$3,'user') RETURNING id", [customer.id, address, hash]);
        return user.id;
      });
      return start(userId);
    },
    async logout() {
      const token = currentToken();
      if (token) await db.query("DELETE FROM auth_sessions WHERE token_hash=$1", [await tokenHash(token)]);
      if (currentToken() === token) saveToken(null);
      return { ok: true };
    },
  };
}
