import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { Prisma, type Courier } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { HttpError, filters, integer, object, phone, text } from '../common/validation.js';

@Controller('api/couriers')
export class CouriersController {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}
  @Get() list(@Query() query: unknown) {
    const {q,status,page}=filters(query);
    if(!['','available','busy','inactive'].includes(status))throw new HttpError(400,'Невідомий статус кур’єра');
    return this.db.page(Prisma.sql`SELECT c.*,(SELECT COUNT(*)::integer FROM orders o WHERE o.courier_id=c.id) AS orders_count,(SELECT COUNT(*)::integer FROM orders o WHERE o.courier_id=c.id AND o.delivery_status='в дорозі') AS active_orders_count
      FROM couriers c WHERE (c.full_name ILIKE ${'%'+q+'%'} OR c.phone ILIKE ${'%'+q+'%'})
      AND (${status}='' OR (${status}='inactive' AND NOT c.is_active)
        OR (${status}='available' AND c.is_active AND c.is_available)
        OR (${status}='busy' AND c.is_active AND EXISTS(SELECT 1 FROM orders o WHERE o.courier_id=c.id AND o.delivery_status='в дорозі')))
      ORDER BY c.is_active DESC,c.full_name,c.id`,page);
  }
  @Get(':id/delivery') async delivery(@Param('id') value: string) {
    const id=integer(Number(value),'id');
    const row=await this.db.courier.findUnique({
      where:{id},
      include:{orders:{where:{delivery_status:'в дорозі'},select:{id:true},take:1}},
    });
    if(!row)throw new HttpError(404,'Кур’єра не знайдено');
    const {orders,...courier}=row;
    return {courier,order_id:orders[0]?.id??null};
  }
  private fields(input: unknown) {
    const b=object(input),vehicle=text(b.vehicle_type,'vehicle_type',30);
    if(!['пішки','велосипед','скутер','автомобіль'].includes(vehicle))throw new HttpError(400,'Оберіть транспорт',{vehicle_type:'Оберіть значення зі списку'});
    return {full_name:text(b.full_name,'full_name',100),phone:phone(b.phone),vehicle_type:vehicle};
  }
  @Post() @HttpCode(200) create(@Body() input: unknown) {
    return this.db.courier.create({data:this.fields(input)});
  }
  @Patch(':id') update(@Param('id') value: string,@Body() input: unknown) {
    return this.db.courier.update({where:{id:integer(Number(value),'id')},data:this.fields(input)});
  }
  @Delete(':id') remove(@Param('id') value: string) {
    const id=integer(Number(value),'id');
    return this.db.$transaction(async tx=>{
      const [courier]=await tx.$queryRaw<Courier[]>`SELECT * FROM couriers WHERE id=${id} FOR UPDATE`;
      if(!courier)throw new HttpError(404,'Кур’єра не знайдено');
      if(await tx.order.count({where:{courier_id:id,delivery_status:'в дорозі'}}))throw new HttpError(409,'Кур’єр виконує доставку. Спочатку завершіть або скасуйте її');
      if(await tx.order.count({where:{courier_id:id}})) {
        await tx.courier.update({where:{id},data:{is_active:false}});
        return {id,archived:true};
      }
      await tx.courier.delete({where:{id}});
      return {id,archived:false};
    });
  }
  @Patch(':id/restore') restore(@Param('id') value: string) {
    const id=integer(Number(value),'id');
    return this.db.$transaction(async tx=>{
      const [courier]=await tx.$queryRaw<Courier[]>`SELECT * FROM couriers WHERE id=${id} FOR UPDATE`;
      if(!courier)throw new HttpError(404,'Кур’єра не знайдено');
      const active=await tx.order.count({where:{courier_id:id,delivery_status:'в дорозі'}});
      return tx.courier.update({where:{id},data:{is_active:true,is_available:active===0}});
    });
  }
}
