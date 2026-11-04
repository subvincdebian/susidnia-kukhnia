import { Controller, Get, Inject, Query } from "@nestjs/common";
import { object } from "../common/validation.js";
import { GeoService, queryCoordinates } from "./geo.service.js";
import { Public } from '../auth/auth.guard.js';

@Public()
@Controller('api/geo')
export class GeoController {
  constructor(@Inject(GeoService) private readonly service: GeoService) {}
  @Get('config') configuration() { return this.service.configuration(); }
  @Get('search') search(@Query() input: unknown) {
    return this.service.search(object(input).q);
  }
  @Get('reverse') reverse(@Query() input: unknown) {
    return this.service.reverse(queryCoordinates(object(input)));
  }
  @Get('route') route(@Query() input: unknown) {
    const query = object(input);
    return this.service.route(queryCoordinates(query,'from_'),queryCoordinates(query,'to_'));
  }
}
