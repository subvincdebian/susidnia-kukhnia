import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { filters, integer } from '../common/validation.js';
import { ReviewsService } from './reviews.service.js';
@Controller('api')
export class ReviewsController {
  constructor(@Inject(ReviewsService) private readonly service: ReviewsService) {}
  @Get('reviews') list(@Query() query: unknown) { return this.service.list(filters(query)); }
  @Get('review-options') options() { return this.service.options(); }
  @Post('reviews') @HttpCode(200) create(@Body() body: unknown) { return this.service.save(null,body); }
  @Patch('reviews/:id') save(@Param('id') id: string,@Body() body: unknown) { return this.service.save(integer(Number(id),'id'),body); }
  @Delete('reviews/:id') delete(@Param('id') id: string) { return this.service.delete(integer(Number(id),'id')); }
}
