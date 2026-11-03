import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { HttpError, object, phone, text } from "../common/validation.js";
@Injectable()
export class CustomersService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}
  list({ q = "", page = 1 }: { q?: string; page?: number }) {
    return this.db.page(
      Prisma.sql`SELECT id,full_name,email,phone,default_delivery_address FROM customers WHERE full_name ILIKE ${"%" + q + "%"} OR phone ILIKE ${"%" + q + "%"} OR COALESCE(email,'') ILIKE ${"%" + q + "%"} ORDER BY full_name,id`,
      page,
    );
  }
  create(input: unknown) {
    const b = object(input),
      email = text(b.email, "email", 100).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new HttpError(400, "Перевірте пошту", {
        email: "Наприклад, client@example.test",
      });
    return this.db.customer.create({
      data: {
        full_name: text(b.full_name, "full_name", 100),
        email,
        phone: phone(b.phone),
        default_delivery_address: text(
          b.default_delivery_address,
          "default_delivery_address",
          200,
        ),
      },
    });
  }
}
