import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { WherewolfController } from "./wherewolf.controller";
import { WherewolfService } from "./wherewolf.service";
import { WherewolfImportService } from "./wherewolf-import.service";
import { WherewolfExperienceMapService } from "./wherewolf-experience-map.service";
import { WherewolfNormalizer } from "./wherewolf-normalizer";
import { WherewolfNormalizeService } from "./wherewolf-normalize.service";
import { WherewolfInspectService } from "./wherewolf-inspect.service";

@Module({
  imports: [DatabaseModule],
  controllers: [WherewolfController],
  providers: [
    WherewolfService,
    WherewolfImportService,
    WherewolfExperienceMapService,
    WherewolfNormalizer,
    WherewolfNormalizeService,
    WherewolfInspectService,
  ],
  exports: [
    WherewolfService,
    WherewolfImportService,
    WherewolfExperienceMapService,
    WherewolfNormalizeService,
    WherewolfInspectService,
  ],
})
export class WherewolfModule {}
