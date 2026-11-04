import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from './auth.guard.js';
import { AuthService } from './auth.service.js';
@Public()
@Controller('api/auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  @Get('session') session(@Req() request: FastifyRequest) { return {user:request.authUser ?? null}; }
  @Post('login') @HttpCode(200) login(@Body() body: unknown,@Req() request: FastifyRequest,@Res({passthrough:true}) reply: FastifyReply) { return this.auth.login(body,request,reply); }
  @Post('register') @HttpCode(200) register(@Body() body: unknown,@Req() request: FastifyRequest,@Res({passthrough:true}) reply: FastifyReply) { return this.auth.register(body,request,reply); }
  @Post('logout') @HttpCode(200) logout(@Req() request: FastifyRequest,@Res({passthrough:true}) reply: FastifyReply) { return this.auth.logout(request,reply); }
}
