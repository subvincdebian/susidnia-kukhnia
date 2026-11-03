import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { flag, HttpError, integer, money, object, phone, text } from '../common/validation.js';

@Injectable()
export class RestaurantsService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}
  list({q='',page=1}: {q?:string;page?:number}) {
    return this.db.page(Prisma.sql`SELECT r.*,(SELECT COUNT(*) FROM menu_items WHERE restaurant_id=r.id) AS dishes_count,
      (SELECT ROUND(AVG(v.rating),2) FROM reviews v JOIN orders o ON o.id=v.order_id WHERE o.restaurant_id=r.id) AS review_rating
      FROM restaurants r WHERE r.name ILIKE ${'%'+q+'%'} OR r.cuisine_type ILIKE ${'%'+q+'%'} ORDER BY r.is_active DESC,r.name,r.id`,page);
  }
  async map() {
    const [items, total, missing] = await this.db.$transaction([
      this.db.restaurant.findMany({
        select: {id:true,name:true,address:true,phone:true,cuisine_type:true,is_active:true,latitude:true,longitude:true,coordinate_source:true,image_url:true,image_alt:true,website_url:true,menu_url:true},
        orderBy: [{is_active:'desc'},{name:'asc'},{id:'asc'}],
        take: 500,
      }),
      this.db.restaurant.count(),
      this.db.restaurant.count({where:{OR:[{latitude:null},{longitude:null}]}}),
    ]);
    return {items,total,missing_coordinates:missing,truncated:total>items.length};
  }
  async get(id: number) {
    const row=await this.db.restaurant.findUnique({where:{id},include:{menu:{orderBy:[{is_available:'desc'},{category:'asc'},{name:'asc'},{id:'asc'}]}}});
    if(!row)throw new HttpError(404,'Заклад не знайдено');
    return row;
  }
  async save(id: number|null,input: unknown) {
    const b=object(input),data={name:text(b.name,'name',100),address:text(b.address,'address',200),phone:phone(b.phone),cuisine_type:text(b.cuisine_type,'cuisine_type',50),is_active:flag(b.is_active,'is_active')};
    if(!id)return this.db.restaurant.create({data});
    const previous=await this.db.restaurant.findUnique({where:{id}});
    if(!previous)throw new HttpError(404,'Заклад не знайдено');
    const changed=previous.name!==data.name||previous.address!==data.address||previous.phone!==data.phone||previous.cuisine_type!==data.cuisine_type;
    return this.db.restaurant.update({where:{id},data:{...data,...(changed?{image_url:null,image_alt:null,website_url:null,menu_url:null,source_checked_at:null,source_note:null}:{}),...(previous.address!==data.address?{latitude:null,longitude:null,coordinate_source:null}:{})}});
  }
  async saveDish(id: number|null,input: unknown) {
    const b=object(input),data={name:text(b.name,'name',100),description:text(b.description??'','description',2000,0),price:money(b.price),category:text(b.category,'category',50),is_available:flag(b.is_available,'is_available')};
    return this.db.$transaction(async tx=>{
      if(!id){
        const restaurant_id=integer(b.restaurant_id,'restaurant_id');
        const row=await tx.menuItem.create({data:{...data,restaurant_id}});
        await tx.restaurant.update({where:{id:restaurant_id},data:{source_checked_at:null}});
        return row;
      }
      const previous=await tx.menuItem.findUnique({where:{id}});
      if(!previous)throw new HttpError(404,'Страву не знайдено');
      const renamed=previous.name!==data.name;
      const changed=renamed||previous.price.toFixed(2)!==new Prisma.Decimal(data.price).toFixed(2)||(previous.description??'')!==data.description||previous.category!==data.category;
      const row=await tx.menuItem.update({where:{id},data:{...data,...(changed?{source_url:null}:{}),...(renamed?{image_url:null,image_alt:null,portion:null}:{})}});
      if(changed)await tx.restaurant.update({where:{id:previous.restaurant_id},data:{source_checked_at:null}});
      return row;
    });
  }
}
