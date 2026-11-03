import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { date, HttpError, object } from '../common/validation.js';
type AnalyticsRow = Record<string,string|bigint|Prisma.Decimal>;
@Injectable()
export class AnalyticsService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}
  async get(input: unknown) {

    const b=object(input);
    const from=date(b.from??'2026-10-01','from'),to=date(b.to??'2026-10-31','to');
    if(from>to)throw new HttpError(400,'Початок періоду має бути раніше завершення',{to:'Оберіть пізнішу дату'});
    const [summary,dishes,ratings,status,restaurants]=await Promise.all([
      this.db.$queryRaw<AnalyticsRow[]>(Prisma.sql`SELECT COUNT(*) AS orders_count,COALESCE(SUM(total_amount),0) AS orders_amount,
        COUNT(*) FILTER(WHERE delivery_status='доставлено') AS delivered_count,
        COALESCE(SUM(total_amount) FILTER(WHERE delivery_status='доставлено'),0) AS delivered_amount
        FROM orders WHERE order_date>=${from}::date AND order_date<${to}::date+INTERVAL '1 day'`),
      this.db.$queryRaw<AnalyticsRow[]>(Prisma.sql`SELECT m.name,COUNT(DISTINCT i.order_id) AS orders_count,SUM(i.quantity) AS portions
        FROM order_items i JOIN orders o ON o.id=i.order_id JOIN menu_items m ON m.id=i.menu_item_id
        WHERE o.order_date>=${from}::date AND o.order_date<${to}::date+INTERVAL '1 day' AND o.delivery_status<>'скасовано'
        GROUP BY m.id,m.name ORDER BY orders_count DESC,portions DESC,m.name LIMIT 10`),
      this.db.$queryRaw<AnalyticsRow[]>(Prisma.sql`SELECT r.name,ROUND(AVG(v.rating),2) AS average_rating,COUNT(v.id) AS reviews_count
        FROM reviews v JOIN orders o ON o.id=v.order_id JOIN restaurants r ON r.id=o.restaurant_id
        WHERE v.created_at>=${from}::date AND v.created_at<${to}::date+INTERVAL '1 day'
        GROUP BY r.id,r.name ORDER BY average_rating DESC,reviews_count DESC,r.name LIMIT 10`),
      this.db.$queryRaw<AnalyticsRow[]>(Prisma.sql`SELECT delivery_status,COUNT(*) AS orders_count,SUM(total_amount) AS amount FROM orders
        WHERE order_date>=${from}::date AND order_date<${to}::date+INTERVAL '1 day' GROUP BY delivery_status ORDER BY orders_count DESC`),
      this.db.$queryRaw<AnalyticsRow[]>(Prisma.sql`SELECT r.name,COUNT(o.id) AS completed_orders,COALESCE(SUM(o.total_amount),0) AS amount
        FROM restaurants r LEFT JOIN orders o ON o.restaurant_id=r.id AND o.delivery_status='доставлено'
        AND o.order_date>=${from}::date AND o.order_date<${to}::date+INTERVAL '1 day'
        GROUP BY r.id,r.name ORDER BY completed_orders DESC,amount DESC,r.name LIMIT 10`)
    ]);
    return {from,to,summary:summary[0],dishes:dishes,ratings:ratings,status:status,restaurants:restaurants};
  }
}
