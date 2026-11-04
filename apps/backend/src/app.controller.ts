import { Controller, Get, Inject, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { PrismaService } from './prisma/prisma.service.js';
import { statuses } from './common/validation.js';
import { Public } from './auth/auth.guard.js';
@Controller('api')
export class AppController {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}
  @Public() @Get('session') session() { return {ready:true}; }
  @Public() @Get('bootstrap') async bootstrap(@Req() request: FastifyRequest) {
    if (request.authUser?.role !== 'admin') {
      const restaurants = await this.db.restaurant.findMany({select:{id:true,name:true,is_active:true},orderBy:{name:'asc'},take:200});
      return {customers:[],couriers:[],restaurants,counts:{},statuses};
    }
    const [customers,couriers,restaurants,counts]=await Promise.all([
      this.db.customer.findMany({select:{id:true,full_name:true,default_delivery_address:true},orderBy:{full_name:'asc'},take:200}),
      this.db.courier.findMany({where:{is_active:true},select:{id:true,full_name:true,vehicle_type:true,is_available:true,is_active:true},orderBy:{full_name:'asc'},take:200}),
      this.db.restaurant.findMany({select:{id:true,name:true,is_active:true},orderBy:{name:'asc'},take:200}),
      this.db.$queryRaw`SELECT (SELECT COUNT(*) FROM restaurants) AS restaurants,(SELECT COUNT(*) FROM orders) AS orders,(SELECT COUNT(*) FROM reviews) AS reviews,(SELECT COUNT(*) FROM active_orders) AS active`
    ]);
    return {customers,couriers,restaurants,counts:Array.isArray(counts)?counts[0]:{},statuses};
  }
}
