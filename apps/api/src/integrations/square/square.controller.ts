import { Controller, Get, Header } from "@nestjs/common";
import { SquareService } from "./square.service";

@Controller("integrations/square")
export class SquareController {
  constructor(private readonly square: SquareService) {}

  @Get("status")
  @Header("Cache-Control", "no-store")
  status() {
    return this.square.getConnectionStatus();
  }
}
