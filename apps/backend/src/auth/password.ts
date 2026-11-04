import { pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(pbkdf2);
const iterations = 600000;
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, iterations, 32, 'sha256');
  return `pbkdf2-sha256$${iterations}$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, rounds, saltText, hashText, extra] = encoded.split('$');
  if (algorithm !== 'pbkdf2-sha256' || rounds !== String(iterations) || !saltText || !hashText || extra !== undefined) return false;
  const salt = Buffer.from(saltText, 'base64'), expected = Buffer.from(hashText, 'base64');
  if (salt.length !== 16 || expected.length !== 32) return false;
  const actual = await derive(password, salt, iterations, 32, 'sha256');
  return timingSafeEqual(actual, expected);
}
