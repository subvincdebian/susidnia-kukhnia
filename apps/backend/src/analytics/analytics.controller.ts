import { Controller, Get, Inject, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service.js';
@Controller('api/analytics')
export class AnalyticsController {
  constructor(@Inject(AnalyticsService) private readonly service: AnalyticsService) {}
  @Get() get(@Query() query: unknown) { return this.service.get(query); }
}
