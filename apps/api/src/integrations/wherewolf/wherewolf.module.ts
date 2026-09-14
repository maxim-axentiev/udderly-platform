import { Module } from "@nestjs/common";
import { WherewolfController } from "./wherewolf.controller";
import { WherewolfService } from "./wherewolf.service";

@Module({
  controllers: [WherewolfController],
  providers: [WherewolfService],
  exports: [WherewolfService],
})
export class WherewolfModule {}
