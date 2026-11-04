import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { filters, integer, object } from '../common/validation.js';
import { Authenticated } from '../auth/auth.guard.js';
import { AuthService, currentUser } from '../auth/auth.service.js';
import { ReviewsService } from './reviews.service.js';
@Authenticated()
@Controller('api')
export class ReviewsController {
  constructor(@Inject(ReviewsService) private readonly service: ReviewsService,@Inject(AuthService) private readonly auth: AuthService) {}
  private customer(request: FastifyRequest) { const user = currentUser(request);return user.role === 'admin' ? undefined : user.customer_id; }
  @Get('reviews') list(@Query() query: unknown,@Req() request: FastifyRequest) { return this.service.list(filters(query),this.customer(request)); }
  @Get('review-options') options(@Req() request: FastifyRequest) { return this.service.options(this.customer(request)); }
  @Post('reviews') @HttpCode(200) async create(@Body() body: unknown,@Req() request: FastifyRequest) {
    await this.auth.requireOrder(currentUser(request),integer(object(body).order_id,'order_id'));
    return this.service.save(null,body);
  }
  @Patch('reviews/:id') async save(@Param('id') value: string,@Body() body: unknown,@Req() request: FastifyRequest) {
    const id = integer(Number(value),'id');await this.auth.requireReview(currentUser(request),id);return this.service.save(id,body);
  }
  @Delete('reviews/:id') async delete(@Param('id') value: string,@Req() request: FastifyRequest) {
    const id = integer(Number(value),'id');await this.auth.requireReview(currentUser(request),id);return this.service.delete(id);
  }
}
