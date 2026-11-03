import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient, Prisma } from '../generated/prisma/client.js';
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  readonly sql: pg.Pool;
  constructor(connectionString: string) {
    const pool=new pg.Pool({connectionString,max:8,connectionTimeoutMillis:5000,idleTimeoutMillis:10000,options:'-c timezone=Europe/Kyiv'});
    pool.on('error',error=>console.error('PostgreSQL connection error',{name:error.name}));
    super({adapter:new PrismaPg(pool)});
    this.sql=pool;
  }
  async onModuleDestroy() { await this.$disconnect(); await this.sql.end(); }
  async page<T>(sql: Prisma.Sql,page=1,size=10) {
    const [count]=await this.$queryRaw<{count:bigint}[]>(Prisma.sql`SELECT COUNT(*) FROM (${sql}) counted`);
    const total=Number(count?.count??0),pages=Math.max(1,Math.ceil(total/size));page=Math.min(page,pages);
    const items=await this.$queryRaw<T[]>(Prisma.sql`${sql} LIMIT ${size} OFFSET ${(page-1)*size}`);
    return {items,total,page,pages,size};
  }
}
