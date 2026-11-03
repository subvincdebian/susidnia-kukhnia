import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { integer, object, text } from '../common/validation.js';
@Injectable()
export class ReviewsService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}
  list({page=1}: {page?:number}) {
    return this.db.page(Prisma.sql`SELECT v.*,o.customer_id,c.full_name AS customer,r.name AS restaurant
      FROM reviews v JOIN orders o ON o.id=v.order_id JOIN customers c ON c.id=o.customer_id
      JOIN restaurants r ON r.id=o.restaurant_id ORDER BY v.created_at DESC,v.id DESC`,page);
  }
  options() { return this.db.$queryRaw`SELECT o.id,c.full_name AS customer,r.name AS restaurant FROM orders o JOIN customers c ON c.id=o.customer_id JOIN restaurants r ON r.id=o.restaurant_id LEFT JOIN reviews v ON v.order_id=o.id WHERE o.delivery_status='доставлено' AND v.id IS NULL ORDER BY o.id DESC LIMIT 200`; }
  save(id: number|null,input: unknown) {
    const b=object(input),data={rating:integer(b.rating,'rating',1,5),comment:text(b.comment,'comment',2000)};
    return id ? this.db.review.update({where:{id},data}) : this.db.review.create({data:{...data,order_id:integer(b.order_id,'order_id')}});
  }
  delete(id: number) { return this.db.review.delete({where:{id},select:{id:true}}); }
}
