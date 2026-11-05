import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { filters, integer } from '../common/validation.js';
import { RestaurantsService } from './restaurants.service.js';
import { Public } from '../auth/auth.guard.js';
@Controller('api')
export class RestaurantsController {
  constructor(@Inject(RestaurantsService) private readonly service: RestaurantsService) {}
  @Public() @Get('restaurants') list(@Query() query: unknown) { return this.service.list(filters(query)); }
  @Public() @Get('restaurants/map') map(@Query() query: unknown) { return this.service.map(filters(query).q); }
  @Public() @Get('restaurants/:id') get(@Param('id') id: string) { return this.service.get(integer(Number(id),'id')); }
  @Post('restaurants') @HttpCode(200) create(@Body() body: unknown) { return this.service.save(null,body); }
  @Patch('restaurants/:id') save(@Param('id') id: string,@Body() body: unknown) { return this.service.save(integer(Number(id),'id'),body); }
  @Post('menu') @HttpCode(200) createDish(@Body() body: unknown) { return this.service.saveDish(null,body); }
  @Patch('menu/:id') saveDish(@Param('id') id: string,@Body() body: unknown) { return this.service.saveDish(integer(Number(id),'id'),body); }
}
