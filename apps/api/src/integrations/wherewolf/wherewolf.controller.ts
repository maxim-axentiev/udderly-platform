import { Controller, Get, Header } from "@nestjs/common";
import { WherewolfService } from "./wherewolf.service";

@Controller("integrations/wherewolf")
export class WherewolfController {
  constructor(private readonly wherewolf: WherewolfService) {}

  @Get("status")
  @Header("Cache-Control", "no-store")
  status() {
    return this.wherewolf.getConnectionStatus();
  }
}
