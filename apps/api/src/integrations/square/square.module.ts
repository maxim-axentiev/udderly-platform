import { Module } from "@nestjs/common";
import { SquareController } from "./square.controller";
import { SquareService } from "./square.service";

@Module({
  controllers: [SquareController],
  providers: [SquareService],
  exports: [SquareService],
})
export class SquareModule {}
