import { Inject, Injectable, SetMetadata, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { AuthService } from './auth.service.js';
import { HttpError } from '../common/validation.js';

export const Public = () => SetMetadata('authAccess','public');
export const Authenticated = () => SetMetadata('authAccess','authenticated');
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(Reflector) private readonly reflector: Reflector) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    request.authUser = await this.auth.resolve(request);
    const access = this.reflector.getAllAndOverride<string>('authAccess',[context.getHandler(),context.getClass()]) ?? 'admin';
    if (access === 'public') return true;
    if (!request.authUser) throw new HttpError(401,'Увійдіть до облікового запису');
    if (access === 'admin' && request.authUser.role !== 'admin') throw new HttpError(403,'Дія доступна лише адміністратору');
    return true;
  }
}
