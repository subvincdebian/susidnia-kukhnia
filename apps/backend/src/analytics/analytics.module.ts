import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service.js';
import { AnalyticsController } from './analytics.controller.js';
@Module({providers:[AnalyticsService],controllers:[AnalyticsController],exports:[AnalyticsService]})
export class AnalyticsModule {}
