import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service.js';
import { OrdersController } from './orders.controller.js';
@Module({providers:[OrdersService],controllers:[OrdersController],exports:[OrdersService]})
export class OrdersModule {}
