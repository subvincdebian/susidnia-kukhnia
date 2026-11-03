import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  filters,
  integer,
  object,
  text,
  HttpError,
} from "../common/validation.js";
import { OrdersService } from "./orders.service.js";
@Controller("api/orders")
export class OrdersController {
  constructor(@Inject(OrdersService) private readonly service: OrdersService) {}
  @Get() list(@Query() query: unknown) {
    return this.service.list(filters(query));
  }
  @Get("recent") recent(@Query() query: unknown) {
    const raw = text(object(query).ids ?? "", "ids", 360, 0);
    if (!raw) return [];
    const values = raw.split(",");
    if (values.length > 30 || values.some((value) => !/^\d+$/.test(value)))
      throw new HttpError(400, "Некоректний список замовлень");
    return this.service.recent([
      ...new Set(values.map((value) => integer(Number(value), "ids"))),
    ]);
  }
  @Get(":id") get(@Param("id") id: string) {
    return this.service.get(integer(Number(id), "id"));
  }
  @Post() @HttpCode(200) create(@Body() body: unknown) {
    return this.service.create(body);
  }
  @Post("checkout") @HttpCode(200) checkout(@Body() body: unknown) {
    return this.service.checkout(body);
  }
  @Patch(":id/status") status(@Param("id") id: string, @Body() body: unknown) {
    return this.service.changeStatus(integer(Number(id), "id"), body);
  }
  @Post(":id/payment") @HttpCode(200) pay(
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.service.pay(integer(Number(id), "id"), body);
  }
  @Patch(":id/note") note(@Param("id") id: string, @Body() body: unknown) {
    return this.service.saveNote(integer(Number(id), "id"), body);
  }
  @Patch(":id/address") address(@Param("id") id: string, @Body() body: unknown) {
    return this.service.changeAddress(integer(Number(id), "id"), body);
  }
  @Post(":id/courier-location") @HttpCode(200) location(@Param("id") id: string, @Body() body: unknown) {
    return this.service.updateCourierLocation(integer(Number(id), "id"), body);
  }
  @Get(":id/messages") messages(@Param("id") id: string) {
    return this.service.messages(integer(Number(id), "id"));
  }
  @Post(":id/messages") @HttpCode(200) message(@Param("id") id: string, @Body() body: unknown) {
    return this.service.sendMessage(integer(Number(id), "id"), body);
  }
}
