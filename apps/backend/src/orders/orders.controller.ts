import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { filters, integer, object, text, HttpError } from '../common/validation.js';
import { Authenticated } from '../auth/auth.guard.js';
import { AuthService, currentUser } from '../auth/auth.service.js';
import { OrdersService } from './orders.service.js';
@Controller('api/orders')
export class OrdersController {
  constructor(@Inject(OrdersService) private readonly service: OrdersService, @Inject(AuthService) private readonly auth: AuthService) {}
  private async owned(request: FastifyRequest, value: string) {
    const id = integer(Number(value),'id');
    await this.auth.requireOrder(currentUser(request),id);
    return id;
  }
  @Get() list(@Query() query: unknown) { return this.service.list(filters(query)); }
  @Authenticated() @Get('recent') recent(@Query() query: unknown,@Req() request: FastifyRequest) {
    const raw = text(object(query).ids ?? '', 'ids', 360, 0);
    const values = raw ? raw.split(',') : [];
    if (values.length > 30 || values.some(value => !/^\d+$/.test(value))) throw new HttpError(400,'Некоректний список замовлень');
    return this.service.recent([...new Set(values.map(value => integer(Number(value),'ids')))], currentUser(request).customer_id);
  }
  @Authenticated() @Get(':id') async get(@Param('id') id: string,@Req() request: FastifyRequest) { return this.service.get(await this.owned(request,id)); }
  @Post() @HttpCode(200) create(@Body() body: unknown) { return this.service.create(body); }
  @Authenticated() @Post('checkout') @HttpCode(200) checkout(@Body() body: unknown,@Req() request: FastifyRequest) { return this.service.checkout(body,currentUser(request).customer_id); }
  @Patch(':id/status') status(@Param('id') id: string,@Body() body: unknown) { return this.service.changeStatus(integer(Number(id),'id'),body); }
  @Authenticated() @Post(':id/payment') @HttpCode(200) async pay(@Param('id') id: string,@Body() body: unknown,@Req() request: FastifyRequest) { return this.service.pay(await this.owned(request,id),body); }
  @Authenticated() @Patch(':id/note') async note(@Param('id') id: string,@Body() body: unknown,@Req() request: FastifyRequest) { return this.service.saveNote(await this.owned(request,id),body); }
  @Authenticated() @Patch(':id/address') async address(@Param('id') id: string,@Body() body: unknown,@Req() request: FastifyRequest) { return this.service.changeAddress(await this.owned(request,id),body); }
  @Post(':id/courier-location') @HttpCode(200) location(@Param('id') id: string,@Body() body: unknown) { return this.service.updateCourierLocation(integer(Number(id),'id'),body); }
  @Authenticated() @Get(':id/messages') async messages(@Param('id') id: string,@Req() request: FastifyRequest) { return this.service.messages(await this.owned(request,id)); }
  @Authenticated() @Post(':id/messages') @HttpCode(200) async message(@Param('id') id: string,@Body() body: unknown,@Req() request: FastifyRequest) {
    const user = currentUser(request);
    if (user.role !== 'admin' && object(body).sender === 'courier') throw new HttpError(403,'Від імені кур’єра може писати лише адміністратор');
    return this.service.sendMessage(await this.owned(request,id),body);
  }
}
