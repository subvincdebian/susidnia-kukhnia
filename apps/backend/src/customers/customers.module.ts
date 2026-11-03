import { Module } from '@nestjs/common';
import { CustomersService } from './customers.service.js';
import { CustomersController } from './customers.controller.js';
@Module({providers:[CustomersService],controllers:[CustomersController],exports:[CustomersService]})
export class CustomersModule {}
