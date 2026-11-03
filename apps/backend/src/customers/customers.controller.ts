import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
} from "@nestjs/common";
import { filters } from "../common/validation.js";
import { CustomersService } from "./customers.service.js";
@Controller("api/customers")
export class CustomersController {
  constructor(
    @Inject(CustomersService) private readonly service: CustomersService,
  ) {}
  @Get() list(@Query() query: unknown) {
    return this.service.list(filters(query));
  }
  @Post() @HttpCode(200) create(@Body() body: unknown) {
    return this.service.create(body);
  }
}
