import { defineConfig } from 'prisma/config';
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? process.env.DELIVERY_DATABASE_URL ?? 'postgresql://localhost:56433/food_delivery' },
});
