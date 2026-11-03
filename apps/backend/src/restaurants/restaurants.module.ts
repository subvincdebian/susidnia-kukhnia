import { Module } from '@nestjs/common';
import { RestaurantsService } from './restaurants.service.js';
import { RestaurantsController } from './restaurants.controller.js';
@Module({providers:[RestaurantsService],controllers:[RestaurantsController],exports:[RestaurantsService]})
export class RestaurantsModule {}
