import { Inject, Injectable } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { HttpError, object, phone, text } from '../common/validation.js';
import { hashPassword, verifyPassword } from './password.js';

export interface AuthUser {
  id: number;
  role: 'admin' | 'user';
  email: string;
  full_name: string;
  phone: string;
  customer_id: number;
}
declare module 'fastify' { interface FastifyRequest { authUser?: AuthUser | null; } }
const sessionSeconds = 8 * 60 * 60;
const fallbackHash = 'pbkdf2-sha256$600000$T9GR3i6DRE2fkDzCMXFzGQ==$Ycf6fogRjkN8mmVHAU0/mNxjLP3Z5rJlio+vp7lfJjI=';
function token(request: FastifyRequest) {
  const raw = request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('auth_session='))?.slice('auth_session='.length);
  return raw && /^[A-Za-z0-9_-]{43}$/.test(raw) ? raw : undefined;
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function emailAddress(value: unknown) {
  const email = text(value, 'email', 100).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Перевірте пошту', {email:'Наприклад, name@example.com'});
  return email;
}
function passwordValue(value: unknown, registering = false) {
  if (typeof value !== 'string' || value.length < (registering ? 10 : 1) || value.length > 128)
    throw new HttpError(400, 'Перевірте пароль', {password:registering ? 'Від 10 до 128 символів' : 'Вкажіть пароль (до 128 символів)'});
  return value;
}
export function currentUser(request: FastifyRequest): AuthUser {
  if (!request.authUser) throw new HttpError(401, 'Увійдіть до облікового запису');
  return request.authUser;
}
@Injectable()
export class AuthService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}
  async resolve(request: FastifyRequest): Promise<AuthUser | null> {
    const value = token(request);
    if (!value) return null;
    // Compare expiry inside PostgreSQL. The adapter's timestamptz parser is affected by the business timezone.
    const [user] = await this.db.$queryRaw<(Omit<AuthUser,'role'> & {role:string})[]>`SELECT u.id,u.role,u.email,c.full_name,c.phone,u.customer_id FROM auth_sessions s JOIN app_users u ON u.id=s.user_id JOIN customers c ON c.id=u.customer_id WHERE s.token_hash=${digest(value)} AND s.expires_at>CURRENT_TIMESTAMP`;
    if (!user) return null;
    if (user.role !== 'admin' && user.role !== 'user') return null;
    return {...user,role:user.role};
  }
  private async start(userId: number, request: FastifyRequest, reply: FastifyReply) {
    const value = randomBytes(32).toString('base64url');
    const old = token(request);
    await this.db.$transaction(async tx => {
      if (old) await tx.authSession.deleteMany({where:{token_hash:digest(old)}});
      await tx.$executeRaw`DELETE FROM auth_sessions WHERE expires_at<=CURRENT_TIMESTAMP`;
      await tx.$executeRaw`INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES (${digest(value)},${userId},CURRENT_TIMESTAMP+INTERVAL '8 hours')`;
    });
    reply.header('Set-Cookie', `auth_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionSeconds}`);
    // Resolve the newly created account without accepting identity from the body.
    const account = await this.db.appUser.findUniqueOrThrow({where:{id:userId},include:{customer:true}});
    if (account.role !== 'admin' && account.role !== 'user') throw new HttpError(403, 'Недоступна роль облікового запису');
    return {user:{id:account.id,role:account.role,email:account.email,full_name:account.customer.full_name,phone:account.customer.phone,customer_id:account.customer_id}};
  }
  async login(input: unknown, request: FastifyRequest, reply: FastifyReply) {
    const b = object(input), email = emailAddress(b.email), password = passwordValue(b.password);
    const account = await this.db.appUser.findUnique({where:{email}});
    const valid = await verifyPassword(password, account?.password_hash ?? fallbackHash);
    if (!account || !valid) throw new HttpError(401, 'Неправильна пошта або пароль');
    return this.start(account.id,request,reply);
  }
  async register(input: unknown, request: FastifyRequest, reply: FastifyReply) {
    const b = object(input), email = emailAddress(b.email), password = passwordValue(b.password,true);
    const fullName = text(b.full_name,'full_name',100), number = phone(b.phone);
    const passwordHash = await hashPassword(password);
    const account = await this.db.$transaction(async tx => {
      // Registration always creates a new contact. Matching email/phone never claims an existing customer's orders.
      const customer = await tx.customer.create({data:{full_name:fullName,email,phone:number,default_delivery_address:''}});
      return tx.appUser.create({data:{email,password_hash:passwordHash,customer_id:customer.id,role:'user'}});
    });
    return this.start(account.id,request,reply);
  }
  async logout(request: FastifyRequest, reply: FastifyReply) {
    const value = token(request);
    if (value) await this.db.authSession.deleteMany({where:{token_hash:digest(value)}});
    reply.header('Set-Cookie','auth_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return {ok:true};
  }
  async requireOrder(user: AuthUser, id: number) {
    const order = await this.db.order.findFirst({where:{id,...(user.role === 'admin' ? {} : {customer_id:user.customer_id})},select:{id:true}});
    if (!order) throw new HttpError(404,'Замовлення не знайдено');
  }
  async requireReview(user: AuthUser, id: number) {
    const review = await this.db.review.findFirst({where:{id,...(user.role === 'admin' ? {} : {order:{customer_id:user.customer_id}})},select:{id:true}});
    if (!review) throw new HttpError(404,'Відгук не знайдено');
  }
}
