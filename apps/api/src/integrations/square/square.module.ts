import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { SquareController } from "./square.controller";
import { SquareService } from "./square.service";
import { SquareCatalogImportService } from "./square-catalog-import.service";
import { SquareCatalogNormalizer } from "./square-catalog-normalizer";
import { SquareCatalogNormalizeService } from "./square-catalog-normalize.service";
import { SquareCommerceImportService } from "./square-commerce-import.service";
import { SquareCommerceNormalizer } from "./square-commerce-normalizer";
import { SquareCommerceNormalizeService } from "./square-commerce-normalize.service";
import { SquareCommerceReconcileService } from "./square-commerce-reconcile.service";

@Module({
  imports: [DatabaseModule],
  controllers: [SquareController],
  providers: [
    SquareService,
    SquareCatalogImportService,
    SquareCatalogNormalizer,
    SquareCatalogNormalizeService,
    SquareCommerceImportService,
    SquareCommerceNormalizer,
    SquareCommerceNormalizeService,
    SquareCommerceReconcileService,
  ],
  exports: [
    SquareService,
    SquareCatalogImportService,
    SquareCatalogNormalizeService,
    SquareCommerceImportService,
    SquareCommerceNormalizeService,
    SquareCommerceReconcileService,
  ],
})
export class SquareModule {}
