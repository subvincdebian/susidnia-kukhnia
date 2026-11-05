import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { flag, HttpError, integer, money, object, phone, text } from '../common/validation.js';

@Injectable()
export class RestaurantsService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}
  private search(q: string) {
    const needle=q.trim().toLocaleLowerCase('uk-UA');
    const match=(column: Prisma.Sql)=>Prisma.sql`strpos(translate(lower(${column}), 'АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯЁЪЫЭ', 'абвгґдеєжзиіїйклмнопрстуфхцчшщьюяёъыэ'), ${needle})>0`;
    const dish=Prisma.sql`m.is_available AND (${match(Prisma.sql`m.name`)} OR ${match(Prisma.sql`m.category`)})`;
    const where=Prisma.sql`(${match(Prisma.sql`r.name`)} OR ${match(Prisma.sql`r.cuisine_type`)} OR EXISTS(SELECT 1 FROM menu_items m WHERE m.restaurant_id=r.id AND ${dish}))`;
    const count=Prisma.sql`(SELECT COUNT(*) FROM menu_items m WHERE ${Boolean(needle)} AND m.restaurant_id=r.id AND ${dish})`;
    return {needle,dish,where,count};
  }
  list({q='',page=1}: {q?:string;page?:number}) {
    const search=this.search(q);
    return this.db.page(Prisma.sql`SELECT r.*,(SELECT COUNT(*) FROM menu_items WHERE restaurant_id=r.id) AS dishes_count,
      (SELECT ROUND(AVG(v.rating),2) FROM reviews v JOIN orders o ON o.id=v.order_id WHERE o.restaurant_id=r.id) AS review_rating,
      ${search.count} AS matched_dishes_count,
      COALESCE((SELECT jsonb_agg(to_jsonb(matched)||jsonb_build_object('price',matched.price::text)) FROM
        (SELECT m.* FROM menu_items m WHERE ${Boolean(search.needle)} AND m.restaurant_id=r.id AND ${search.dish} ORDER BY m.price,m.name,m.id LIMIT 3) matched),'[]'::jsonb) AS matched_dishes
      FROM restaurants r WHERE ${search.where} ORDER BY r.is_active DESC,r.name,r.id`,page);
  }
  async map(q='') {
    const search=this.search(q);
    const [items, counts] = await this.db.$transaction([
      this.db.$queryRaw<Record<string,unknown>[]>(Prisma.sql`SELECT r.id,r.name,r.address,r.phone,r.cuisine_type,r.is_active,r.latitude,r.longitude,r.coordinate_source,r.image_url,r.image_alt,r.website_url,r.menu_url,
        ${search.count} AS matched_dishes_count FROM restaurants r WHERE ${search.where} ORDER BY r.is_active DESC,r.name,r.id LIMIT 500`),
      this.db.$queryRaw<{total:number;missing:number}[]>(Prisma.sql`SELECT COUNT(*)::integer AS total,COUNT(*) FILTER(WHERE r.latitude IS NULL OR r.longitude IS NULL)::integer AS missing FROM restaurants r WHERE ${search.where}`),
    ]);
    const count=counts[0];
    if(!count)throw new Error('Не отримано кількість закладів');
    return {items,total:count.total,missing_coordinates:count.missing,truncated:count.total>items.length};
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
