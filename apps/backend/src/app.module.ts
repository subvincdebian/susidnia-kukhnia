import { DynamicModule, Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service.js';
import { AppController } from './app.controller.js';
import { CouriersController } from './couriers/couriers.controller.js';
import { RestaurantsModule } from './restaurants/restaurants.module.js';
import { CustomersModule } from './customers/customers.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { ReviewsModule } from './reviews/reviews.module.js';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { GeoModule } from './geo/geo.module.js';
import { AuthModule } from './auth/auth.module.js';
@Global()
@Module({})
class DatabaseModule {
  static register(connectionString: string): DynamicModule {
    return {module:DatabaseModule,providers:[{provide:PrismaService,useFactory:()=>new PrismaService(connectionString)}],exports:[PrismaService]};
  }
}
@Module({})
export class AppModule {
  static register(connectionString: string): DynamicModule {
    return {module:AppModule,imports:[DatabaseModule.register(connectionString),AuthModule,RestaurantsModule,CustomersModule,OrdersModule,ReviewsModule,AnalyticsModule,GeoModule],controllers:[AppController,CouriersController]};
  }
}
