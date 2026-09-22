import { NestFactory } from "@nestjs/core";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { AppModule } from "../../app.module";
import { loadEnvFiles } from "../../config/load-env";
import { DatabaseService } from "../../database/database.service";
import {
  payments,
  products,
  productVariations,
  refunds,
  saleLineItems,
  sales,
} from "../../database/schema/commerce";
import { sourceIdentities } from "../../database/schema/source-identity";
import { sourceSnapshots } from "../../database/schema/source-snapshots";
import { SquareCommerceImportService } from "./square-commerce-import.service";
import { SquareCommerceNormalizeService } from "./square-commerce-normalize.service";
import { SquareCommerceReconcileService } from "./square-commerce-reconcile.service";
import {
  INTERNAL_PRODUCT,
  INTERNAL_PRODUCT_VARIATION,
  SQUARE_CUSTOMER_ENTITY,
  SQUARE_ITEM_ENTITY,
  SQUARE_ITEM_VARIATION_ENTITY,
  SQUARE_ORDER_ENTITY,
  SQUARE_ORDER_LINE_ENTITY,
  SQUARE_PAYMENT_ENTITY,
  SQUARE_PROVIDER,
  SQUARE_REFUND_ENTITY,
} from "./square.constants";

const FARM_DATE = "2026-09-15";
const CREATED = "2026-09-15T16:00:00.000Z";
const ORDER_A = "SYN-SQ-COM-ORDER-A";
const ORDER_EMPTY = "SYN-SQ-COM-ORDER-EMPTY";
const ORDER_CANCELED = "SYN-SQ-COM-ORDER-CANCELED";
const ORDER_LINES = "SYN-SQ-COM-ORDER-LINES";
const ORDER_STALE = "SYN-SQ-COM-ORDER-STALE";
const ORDER_TIP = "SYN-SQ-COM-ORDER-TIP";
const ORDER_CLOSED_TODAY = "SYN-SQ-COM-ORDER-CLOSED-TODAY";
const ORDER_CLOSED_TOMORROW = "SYN-SQ-COM-ORDER-CLOSED-TOMORROW";
const ORDER_BOUND_IN = "SYN-SQ-COM-ORDER-BOUND-IN";
const ORDER_BOUND_OUT = "SYN-SQ-COM-ORDER-BOUND-OUT";
const ORDER_NOUID = "SYN-SQ-COM-ORDER-NOUID";
const ORDER_GROSS = "SYN-SQ-COM-ORDER-GROSS";
const ORDER_RETURN_A = "SYN-SQ-COM-ORDER-RETURN-A";
const ORDER_RETURN_B = "SYN-SQ-COM-ORDER-RETURN-B";
const ORDER_INVALID_MONEY = "SYN-SQ-COM-ORDER-INVALID-MONEY";
const PAY_CASH = "SYN-SQ-COM-PAY-CASH";
const PAY_CARD = "SYN-SQ-COM-PAY-CARD";
const PAY_EXT = "SYN-SQ-COM-PAY-EXT";
const PAY_ORPHAN = "SYN-SQ-COM-PAY-ORPHAN";
const PAY_TIP = "SYN-SQ-COM-PAY-TIP";
const PAY_CREDIT = "SYN-SQ-COM-PAY-CREDIT";
const PAY_GROSS = "SYN-SQ-COM-PAY-GROSS";
const REF_GROSS = "SYN-SQ-COM-REF-GROSS";
const REF_A = "SYN-SQ-COM-REF-A";
const ORDER_RECON = "SYN-SQ-COM-RECON-ORDER";
const ORDER_RECON_RETURN = "SYN-SQ-COM-RECON-RETURN";
const ORDER_RECON_ADJUSTMENT = "SYN-SQ-COM-RECON-ADJUSTMENT";
const PAY_RECON = "SYN-SQ-COM-RECON-PAY";
const REF_RECON = "SYN-SQ-COM-RECON-REF";
const ORDER_RETURN_EVIDENCE = "SYN-SQ-COM-RETURN-EVIDENCE";
const CUST = "SYN-SQ-COM-CUST";
const VAR = "SYN-SQ-COM-VAR";
const ITEM = "SYN-SQ-COM-ITEM";

const ALL_EXTERNAL_IDS = [
  ORDER_A,
  ORDER_EMPTY,
  ORDER_CANCELED,
  ORDER_LINES,
  ORDER_STALE,
  ORDER_TIP,
  ORDER_CLOSED_TODAY,
  ORDER_CLOSED_TOMORROW,
  ORDER_BOUND_IN,
  ORDER_BOUND_OUT,
  ORDER_NOUID,
  ORDER_GROSS,
  ORDER_RETURN_A,
  ORDER_RETURN_B,
  ORDER_INVALID_MONEY,
  PAY_CASH,
  PAY_CARD,
  PAY_EXT,
  PAY_ORPHAN,
  PAY_TIP,
  PAY_CREDIT,
  PAY_GROSS,
  REF_GROSS,
  REF_A,
  ORDER_RECON,
  ORDER_RECON_RETURN,
  ORDER_RECON_ADJUSTMENT,
  PAY_RECON,
  REF_RECON,
  ORDER_RETURN_EVIDENCE,
  CUST,
  VAR,
  ITEM,
  `${ORDER_LINES}:L1`,
  `${ORDER_LINES}:L2`,
  `${ORDER_LINES}:L3`,
  `${ORDER_TIP}:L1`,
];

async function main(): Promise<void> {
  loadEnvFiles();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });
  const database = app.get(DatabaseService);
  const importer = app.get(SquareCommerceImportService);
  const normalizer = app.get(SquareCommerceNormalizeService);
  const reconcilor = app.get(SquareCommerceReconcileService);

  try {
    await cleanup(database);
    await seedCatalog(database);

    const first = await importer.persistCommerceObjects({
      orders: [
        order(ORDER_A, {
          customerId: CUST,
          total: 500,
          tax: 25,
          discount: 50,
          serviceCharge: 10,
          tip: 0,
          source: "Point of Sale",
          lines: [
            line("L1", {
              name: "Gouda",
              variationName: "Each",
              catalogObjectId: VAR,
              quantity: "1.5",
              gross: 500,
              discount: 50,
              tax: 25,
              total: 475,
            }),
          ],
        }),
        order(ORDER_EMPTY, { total: 0, lines: [] }),
        order(ORDER_CANCELED, { state: "CANCELED", total: 200 }),
        order(ORDER_LINES, {
          total: 800,
          lines: [
            line("L1", {
              name: "Milk",
              catalogObjectId: VAR,
              quantity: "1",
              gross: 400,
              total: 400,
            }),
            line("L2", {
              name: "Custom",
              quantity: "1",
              gross: 400,
              total: 400,
            }),
          ],
        }),
        order(ORDER_STALE, { total: 100, version: 1 }),
        order(ORDER_TIP, {
          total: 1100,
          tax: 50,
          discount: 100,
          serviceCharge: 25,
          tip: 100,
          lines: [
            line("L1", {
              name: "Ice Cream",
              quantity: "1",
              gross: 1025,
              discount: 100,
              tax: 50,
              total: 1000,
            }),
          ],
        }),
        order(ORDER_CLOSED_TODAY, {
          total: 150,
          createdAt: "2026-09-14T16:00:00.000Z",
          closedAt: CREATED,
        }),
        order(ORDER_CLOSED_TOMORROW, {
          total: 175,
          createdAt: CREATED,
          closedAt: "2026-09-16T16:00:00.000Z",
        }),
        order(ORDER_BOUND_IN, {
          total: 10,
          createdAt: "2026-09-15T03:00:00.000Z",
          closedAt: "2026-09-15T04:00:00.000Z",
        }),
        order(ORDER_BOUND_OUT, {
          total: 11,
          createdAt: "2026-09-15T03:00:00.000Z",
          closedAt: "2026-09-15T03:59:59.000Z",
        }),
        order(ORDER_NOUID, {
          total: 80,
          version: 1,
          lines: [
            line(undefined, { name: "Alpha", quantity: "1", gross: 40, total: 40 }),
            line(undefined, { name: "Beta", quantity: "1", gross: 40, total: 40 }),
          ],
        }),
        order(ORDER_GROSS, {
          total: 10500,
          tax: 1300,
          tip: 500,
          netTotal: 8000,
          netTax: 1000,
          netTip: 500,
        }),
        returnOnlyOrder(ORDER_RETURN_A, -1000, -100),
        returnOnlyOrder(ORDER_RETURN_B, -525, -75),
        invalidGrossOrder(ORDER_INVALID_MONEY, 0),
      ],
      payments: [
        payment(PAY_CASH, ORDER_A, {
          amount: 500,
          method: "CASH",
        }),
        payment(PAY_CARD, ORDER_EMPTY, {
          amount: 0,
          method: "CARD",
        }),
        payment(PAY_EXT, ORDER_CANCELED, {
          amount: 200,
          method: "EXTERNAL",
        }),
        payment(PAY_ORPHAN, "SYN-SQ-COM-MISSING-ORDER", {
          amount: 50,
          method: "CARD",
        }),
        payment(PAY_TIP, ORDER_TIP, {
          amount: 1000,
          tip: 100,
          fee: 30,
          method: "CARD",
        }),
        payment(PAY_CREDIT, ORDER_A, {
          amount: 0,
          method: "CARD",
          fees: [
            { type: "INITIAL", amount: 300 },
            { type: "ADJUSTMENT", amount: -400 },
          ],
        }),
        payment(PAY_GROSS, ORDER_GROSS, {
          amount: 10000,
          tip: 500,
          method: "CARD",
        }),
      ],
      refunds: [
        refund(REF_A, PAY_CASH, ORDER_A, 200),
        refund(REF_GROSS, PAY_GROSS, ORDER_GROSS, 2000),
      ],
    });
    if (first.ordersFetched !== 15 || first.paymentsFetched !== 7) {
      throw new Error("expected synthetic commerce fetch counts");
    }
    if (first.refundsFetched !== 2 || first.snapshotsInserted < 1) {
      throw new Error("expected refund snapshot");
    }

    const again = await importer.persistCommerceObjects({
      orders: [order(ORDER_EMPTY, { total: 0, lines: [] })],
    });
    if (again.snapshotsInserted !== 0 || again.snapshotsUnchanged < 1) {
      throw new Error("unchanged import must reuse snapshots");
    }
    console.log("- unchanged import does not duplicate snapshots");

    const firstNorm = await normalizer.normalizeWindow({ date: FARM_DATE });
    if (firstNorm.invalidProcessingFees < 1) {
      throw new Error("net fee credit must be reported, not stored as a fee");
    }
    if (firstNorm.sales !== 10) {
      throw new Error("expected 10 gross sales from valid Square orders");
    }
    if (firstNorm.returnOnlyOrdersSkipped !== 2) {
      throw new Error("expected 2 return-only orders skipped");
    }
    if (firstNorm.invalidOrderMoneySkipped !== 1) {
      throw new Error("expected 1 invalid-order-money skip");
    }

    const saleA = await loadSale(database, ORDER_A);
    if (saleA.kind !== "retail" || saleA.status !== "completed") {
      throw new Error("order did not create one retail sale");
    }
    if (saleA.discountAmount !== 50 || saleA.taxAmount !== 25) {
      throw new Error("explicit discount/tax mapping failed");
    }
    if (saleA.serviceChargeAmount !== 10) {
      throw new Error("service charge mapping failed");
    }
    const saleAAgain = await loadSale(database, ORDER_A);
    if (saleAAgain.id !== saleA.id) {
      throw new Error("repeat order normalize is not idempotent");
    }
    console.log("- order creates one sale and is idempotent");

    const empty = await loadSale(database, ORDER_EMPTY);
    const emptyLines = await listLines(database, empty.id);
    if (emptyLines.length !== 0) {
      throw new Error("empty order must still create a sale without lines");
    }
    console.log("- order with no line items still creates a sale");

    const canceled = await loadSale(database, ORDER_CANCELED);
    if (canceled.status !== "canceled") {
      throw new Error("canceled order must remain stored");
    }
    console.log("- canceled closed order is imported");

    await loadSale(database, ORDER_CLOSED_TODAY);
    if (await resolvedId(database, SQUARE_ORDER_ENTITY, ORDER_CLOSED_TOMORROW)) {
      throw new Error("order closed the following day must not be a sale on the requested day");
    }
    await loadSale(database, ORDER_BOUND_IN);
    if (await resolvedId(database, SQUARE_ORDER_ENTITY, ORDER_BOUND_OUT)) {
      throw new Error("Toronto day-boundary order closed before local midnight must be excluded");
    }
    console.log("- closed_at farm-day membership, including Toronto midnight");

    const resolvedLine = (await listLines(database, saleA.id)).find(
      (row) => row.isActive,
    );
    if (!resolvedLine?.productVariationId || !resolvedLine.productId) {
      throw new Error("catalog line must resolve variation and product");
    }
    if (Number(resolvedLine.quantity) !== 1.5) {
      throw new Error("decimal quantity must be stored");
    }

    const linesSale = await loadSale(database, ORDER_LINES);
    const lines = await listLines(database, linesSale.id);
    const custom = lines.find((row) => row.description === "Custom");
    if (!custom || custom.productId || custom.productVariationId) {
      throw new Error("line without catalog id must remain valid and unmapped");
    }
    console.log("- catalog resolution, missing catalog id, and decimal qty");

    const noUidSale = await loadSale(database, ORDER_NOUID);
    const noUidFirst = await listLines(database, noUidSale.id);
    const firstAlpha = noUidFirst.find((row) => row.description === "Alpha" && row.isActive);
    const firstBeta = noUidFirst.find((row) => row.description === "Beta" && row.isActive);
    if (!firstAlpha || !firstBeta) {
      throw new Error("no-uid lines must create on first version");
    }
    await importer.persistCommerceObjects({
      orders: [
        order(ORDER_NOUID, {
          total: 80,
          version: 1,
          lines: [
            line(undefined, { name: "Alpha", quantity: "1", gross: 40, total: 40 }),
            line(undefined, { name: "Beta", quantity: "1", gross: 40, total: 40 }),
          ],
        }),
      ],
    });
    await normalizer.normalizeWindow({ date: FARM_DATE });
    const noUidRepeat = await listLines(database, noUidSale.id);
    const repeatAlpha = noUidRepeat.find((row) => row.description === "Alpha" && row.isActive);
    if (!repeatAlpha || repeatAlpha.id !== firstAlpha.id) {
      throw new Error("same-version no-uid line must stay idempotent");
    }

    await importer.persistCommerceObjects({
      orders: [
        order(ORDER_NOUID, {
          total: 80,
          version: 2,
          updatedAt: "2026-09-15T18:30:00.000Z",
          lines: [
            line(undefined, { name: "Beta", quantity: "1", gross: 40, total: 40 }),
            line(undefined, { name: "Alpha", quantity: "1", gross: 40, total: 40 }),
          ],
        }),
      ],
    });
    await normalizer.normalizeWindow({ date: FARM_DATE });
    const swapped = await listLines(database, noUidSale.id);
    const activeSwapped = swapped.filter((row) => row.isActive);
    const inactiveSwapped = swapped.filter((row) => !row.isActive);
    if (activeSwapped.length !== 2 || inactiveSwapped.length !== 2) {
      throw new Error("swapped no-uid lines must inactivate old version identities");
    }
    if (inactiveSwapped.some((row) => row.id === firstAlpha.id) === false) {
      throw new Error("old no-uid line must become inactive rather than rewritten");
    }
    const newAlpha = activeSwapped.find((row) => row.description === "Alpha");
    if (!newAlpha || newAlpha.id === firstAlpha.id) {
      throw new Error("position swap must not reuse the previous version line identity");
    }
    await importer.persistCommerceObjects({
      orders: [
        order(ORDER_NOUID, {
          total: 80,
          version: 2,
          updatedAt: "2026-09-15T18:30:00.000Z",
          lines: [
            line(undefined, { name: "Beta", quantity: "1", gross: 40, total: 40 }),
            line(undefined, { name: "Alpha", quantity: "1", gross: 40, total: 40 }),
          ],
        }),
      ],
    });
    await normalizer.normalizeWindow({ date: FARM_DATE });
    const swappedAgain = await listLines(database, noUidSale.id);
    const stillAlpha = swappedAgain.find((row) => row.description === "Alpha" && row.isActive);
    if (!stillAlpha || stillAlpha.id !== newAlpha.id) {
      throw new Error("newest no-uid version must remain idempotent");
    }
    console.log("- no-uid lines are version-scoped and do not rewrite on position swap");

    const tipSale = await loadSale(database, ORDER_TIP);
    if (tipSale.totalAmount !== 1000) {
      throw new Error("tip must be excluded from sale total");
    }
    const tipPay = await loadPayment(database, PAY_TIP);
    if (tipPay.tipAmount !== 100 || tipPay.amount !== 1000) {
      throw new Error("payment tip must stay separate");
    }
    if (tipPay.processingFeeAmount !== 30) {
      throw new Error("processing fee must be stored separately as a positive cost");
    }
    const creditPay = await loadPayment(database, PAY_CREDIT);
    if (creditPay.processingFeeAmount !== null) {
      throw new Error("net fee credit must leave processing_fee_amount null");
    }
    console.log("- tip excluded from sale; fee stored on payment");

    const cash = await loadPayment(database, PAY_CASH);
    const card = await loadPayment(database, PAY_CARD);
    const external = await loadPayment(database, PAY_EXT);
    if (cash.method !== "cash" || card.method !== "card" || external.method !== "external") {
      throw new Error("payment method mapping failed");
    }
    if (cash.saleId !== saleA.id) {
      throw new Error("payment must resolve the exact order sale");
    }
    if (await resolvedId(database, SQUARE_PAYMENT_ENTITY, PAY_ORPHAN)) {
      throw new Error("unresolved payment must not invent a sale");
    }
    console.log("- cash/card/external methods; unresolved payment writes nothing");

    const refundRow = await loadRefund(database, REF_A);
    if (refundRow.paymentId !== cash.id || refundRow.saleId !== saleA.id) {
      throw new Error("refund must resolve payment and sale");
    }
    if (refundRow.amount !== 200) {
      throw new Error("refund amount must stay positive");
    }
    console.log("- refund resolves payment + sale with a positive amount");

    const grossSale = await loadSale(database, ORDER_GROSS);
    if (grossSale.totalAmount !== 10000 || grossSale.taxAmount !== 1300) {
      throw new Error("net_amounts after a return must not reduce original sale totals");
    }
    const grossRefund = await loadRefund(database, REF_GROSS);
    if (grossRefund.amount !== 2000 || grossRefund.saleId !== grossSale.id) {
      throw new Error("return must be a separate refund on the original sale");
    }
    if (grossSale.totalAmount - grossRefund.amount !== 8000) {
      throw new Error("sale minus refund must equal provider net result");
    }
    console.log("- original sale totals stay gross; refunds are separate");

    if (await resolvedId(database, SQUARE_ORDER_ENTITY, ORDER_RETURN_A)) {
      throw new Error("return-only order must not create a canonical sale");
    }
    if (await resolvedId(database, SQUARE_ORDER_ENTITY, ORDER_RETURN_B)) {
      throw new Error("return-only order must not create a canonical sale");
    }
    if (await resolvedId(database, SQUARE_ORDER_ENTITY, ORDER_INVALID_MONEY)) {
      throw new Error("invalid order money must not create a canonical sale");
    }
    const returnSnapshots = await countSnapshots(database, [
      ORDER_RETURN_A,
      ORDER_RETURN_B,
    ]);
    if (returnSnapshots !== 2) {
      throw new Error("return-only orders must remain as source snapshots");
    }
    console.log("- return-only and invalid-money orders do not create sales");

    const customer = await database.db
      .select({
        internalEntityType: sourceIdentities.internalEntityType,
        internalEntityId: sourceIdentities.internalEntityId,
      })
      .from(sourceIdentities)
      .where(
        and(
          eq(sourceIdentities.provider, SQUARE_PROVIDER),
          eq(sourceIdentities.entityType, SQUARE_CUSTOMER_ENTITY),
          eq(sourceIdentities.externalId, CUST),
        ),
      )
      .limit(1);
    if (!customer[0] || customer[0].internalEntityId) {
      throw new Error("customer id must stay unresolved and not create PERSON");
    }
    console.log("- customer id does not create PERSON");

    await importer.persistCommerceObjects({
      orders: [
        order(ORDER_A, {
          customerId: CUST,
          total: 600,
          tax: 25,
          discount: 50,
          serviceCharge: 10,
          tip: 0,
          version: 2,
          updatedAt: "2026-09-15T18:00:00.000Z",
          source: "Point of Sale",
          lines: [
            line("L1", {
              name: "Gouda",
              variationName: "Each",
              catalogObjectId: VAR,
              quantity: "1.5",
              gross: 600,
              discount: 50,
              tax: 25,
              total: 575,
            }),
          ],
        }),
      ],
    });
    await normalizer.normalizeWindow({ date: FARM_DATE });
    const updated = await loadSale(database, ORDER_A);
    if (updated.id !== saleA.id || updated.totalAmount !== 600) {
      throw new Error("changed order must update the same sale");
    }
    console.log("- changed order updates the same sale");

    await importer.persistCommerceObjects({
      orders: [
        order(ORDER_LINES, {
          total: 400,
          version: 2,
          updatedAt: "2026-09-15T18:00:00.000Z",
          lines: [
            line("L1", {
              name: "Milk",
              catalogObjectId: VAR,
              quantity: "1",
              gross: 400,
              total: 400,
            }),
          ],
        }),
      ],
    });
    await normalizer.normalizeWindow({ date: FARM_DATE });
    const afterRemoval = await listLines(database, linesSale.id);
    const active = afterRemoval.filter((row) => row.isActive);
    const removed = afterRemoval.filter((row) => !row.isActive);
    if (active.length !== 1 || removed.length !== 1) {
      throw new Error("removed line must be inactive, not deleted");
    }
    console.log("- removed line does not remain current");

    const staleRows = await database.db
      .select({
        id: sourceSnapshots.id,
        observedAt: sourceSnapshots.observedAt,
      })
      .from(sourceSnapshots)
      .where(
        and(
          eq(sourceSnapshots.provider, SQUARE_PROVIDER),
          eq(sourceSnapshots.entityType, SQUARE_ORDER_ENTITY),
          eq(sourceSnapshots.externalId, ORDER_STALE),
        ),
      );
    const oldest = staleRows.sort(
      (left, right) => left.observedAt.getTime() - right.observedAt.getTime(),
    )[0];
    await importer.persistCommerceObjects({
      orders: [
        order(ORDER_STALE, {
          total: 999,
          version: 2,
          updatedAt: "2026-09-15T19:00:00.000Z",
        }),
      ],
    });
    await normalizer.normalizeWindow({ date: FARM_DATE });
    if (!oldest) {
      throw new Error("stale snapshot missing");
    }
    const staleApply = await normalizer.applySnapshot(oldest.id);
    if (staleApply.outcome !== "skipped_stale") {
      throw new Error("older snapshot must not roll newer state backward");
    }
    const staleSale = await loadSale(database, ORDER_STALE);
    if (staleSale.totalAmount !== 999) {
      throw new Error("canonical sale was rolled back");
    }
    console.log("- older snapshot cannot roll newer state backward");

    const second = await normalizer.normalizeWindow({ date: FARM_DATE });
    if (second.unresolvedPayments < 1) {
      throw new Error("expected unresolved orphan payment to remain counted");
    }
    if (second.invalidProcessingFees < 1) {
      throw new Error("net fee credit must remain reported on rerun");
    }
    if (second.returnOnlyOrdersSkipped !== 2 || second.invalidOrderMoneySkipped !== 1) {
      throw new Error("return-only and invalid-money counters must stay idempotent");
    }
    if (second.sales !== 10) {
      throw new Error("repeated normalize must not turn return-only orders into sales");
    }
    const saleCount = await countIdentities(database, SQUARE_ORDER_ENTITY, [
      ORDER_A,
      ORDER_EMPTY,
      ORDER_CANCELED,
      ORDER_LINES,
      ORDER_STALE,
      ORDER_TIP,
      ORDER_CLOSED_TODAY,
      ORDER_BOUND_IN,
      ORDER_NOUID,
      ORDER_GROSS,
    ]);
    if (saleCount !== 10) {
      throw new Error("idempotent normalize created extra sales");
    }
    console.log("- repeated normalize does not duplicate commerce rows");

    await cleanup(database);
    await seedCatalog(database);
    await importer.persistCommerceObjects({
      orders: [
        order(ORDER_RECON, {
          total: 1100,
          tax: 50,
          discount: 0,
          tip: 100,
          lines: [
            line("L1", {
              name: "Gouda",
              catalogObjectId: VAR,
              quantity: "1",
              gross: 1000,
              tax: 50,
              total: 1000,
            }),
            line("L2", {
              name: "Custom",
              quantity: "1",
              gross: 0,
              total: 0,
            }),
          ],
        }),
        returnOnlyOrder(ORDER_RECON_RETURN, -1525, -175),
        invalidReturnEvidenceOrder(ORDER_RECON_ADJUSTMENT, 1375),
      ],
      payments: [
        payment(PAY_RECON, ORDER_RECON, {
          amount: 1000,
          tip: 100,
          fee: 30,
          method: "CARD",
        }),
      ],
      refunds: [refund(REF_RECON, PAY_RECON, ORDER_RECON, 200)],
    });
    const reconNorm = await normalizer.normalizeWindow({ date: FARM_DATE });
    if (reconNorm.sales !== 1) {
      throw new Error("recon window must create exactly one sale");
    }
    if (reconNorm.returnOnlyOrdersSkipped !== 1) {
      throw new Error("expected one return-only skip in recon window");
    }
    if (reconNorm.returnAdjustmentNonSalesSkipped !== 1) {
      throw new Error("expected one return-adjustment non-sale skip");
    }
    if (reconNorm.invalidOrderMoneySkipped !== 0) {
      throw new Error("return-adjustment must not count as invalid order money");
    }
    if (await resolvedId(database, SQUARE_ORDER_ENTITY, ORDER_RECON_ADJUSTMENT)) {
      throw new Error("return-adjustment non-sale must not create a canonical sale");
    }
    const reconAgain = await normalizer.normalizeWindow({ date: FARM_DATE });
    if (
      reconAgain.sales !== 1 ||
      reconAgain.returnAdjustmentNonSalesSkipped !== 1 ||
      reconAgain.returnOnlyOrdersSkipped !== 1
    ) {
      throw new Error("return-adjustment normalize must remain idempotent");
    }
    const clean = await reconcilor.reconcileWindow({ date: FARM_DATE });
    if (!clean.passed) {
      throw new Error(
        `expected clean reconciliation PASS, got ${clean.differences.join("; ")}`,
      );
    }
    if (clean.totals.returnOnlyOrders !== 1 || clean.totals.invalidOrders !== 0) {
      throw new Error("return-only order must not fail reconciliation");
    }
    if (clean.totals.returnAdjustmentNonSales !== 1) {
      throw new Error("return-adjustment non-sale must not fail reconciliation");
    }
    if (clean.totals.sourceOrders !== 3 || clean.totals.grossSaleOrders !== 1) {
      throw new Error("recon window order classification counts are wrong");
    }
    if (clean.totals.unresolvedVariations !== 0) {
      throw new Error("mapped variation must not count as unresolved");
    }
    const reconRefund = await loadRefund(database, REF_RECON);
    if (reconRefund.amount !== 200) {
      throw new Error("refund must still normalize independently");
    }
    console.log("- clean reconciliation passes; return-only and return-adjustment do not fail");

    await importer.persistCommerceObjects({
      orders: [
        order(ORDER_RECON, {
          total: 1100,
          tax: 50,
          tip: 100,
          version: 2,
          updatedAt: "2026-09-15T18:00:00.000Z",
          lines: [
            line("L1", {
              name: "Gouda",
              catalogObjectId: VAR,
              quantity: "1",
              gross: 1000,
              tax: 50,
              total: 1000,
            }),
          ],
        }),
      ],
    });
    await normalizer.normalizeWindow({ date: FARM_DATE });
    const afterLineRemoval = await reconcilor.reconcileWindow({ date: FARM_DATE });
    if (!afterLineRemoval.passed) {
      throw new Error("inactive lines that match newer source state must not fail");
    }
    if (afterLineRemoval.totals.inactiveCanonicalLines !== 1) {
      throw new Error("expected one inactive canonical line after source removal");
    }
    console.log("- inactive lines matching newer source state do not fail");

    await cleanup(database);
    const returnEvidence = invalidReturnEvidenceOrder(ORDER_RETURN_EVIDENCE, 1375);
    const firstReturn = await importer.persistCommerceObjects({
      orders: [returnEvidence],
    });
    if (firstReturn.snapshotsInserted !== 1) {
      throw new Error("return evidence order must insert a snapshot");
    }
    const sameReturn = await importer.persistCommerceObjects({
      orders: [returnEvidence],
    });
    if (sameReturn.snapshotsInserted !== 0 || sameReturn.snapshotsUnchanged < 1) {
      throw new Error("unchanged return evidence must reuse the snapshot hash");
    }
    const changedReturn = await importer.persistCommerceObjects({
      orders: [invalidReturnEvidenceOrder(ORDER_RETURN_EVIDENCE, 1400)],
    });
    if (changedReturn.snapshotsInserted !== 1) {
      throw new Error("changed return evidence must insert a newer snapshot");
    }
    const evidenceSnapshots = await countSnapshots(database, [ORDER_RETURN_EVIDENCE]);
    if (evidenceSnapshots !== 2) {
      throw new Error("old return-evidence snapshot must be retained");
    }
    const adjustmentNorm = await normalizer.normalizeWindow({ date: FARM_DATE });
    if (adjustmentNorm.returnAdjustmentNonSalesSkipped !== 1) {
      throw new Error("return-adjustment snapshot must skip sale creation");
    }
    if (adjustmentNorm.sales !== 0) {
      throw new Error("return-adjustment must not create a sale");
    }
    if (await resolvedId(database, SQUARE_ORDER_ENTITY, ORDER_RETURN_EVIDENCE)) {
      throw new Error("return-adjustment snapshot must remain source evidence only");
    }
    console.log("- return evidence snapshots are hash-idempotent and versioned");

    await cleanup(database);
    console.log("");
    console.log("Square commerce tests passed.");
  } finally {
    await app.close();
  }
}

function money(amount: number): { amount: number; currency: string } {
  return { amount, currency: "CAD" };
}

function line(
  uid: string | undefined,
  options: {
    name: string;
    variationName?: string;
    catalogObjectId?: string;
    quantity: string;
    gross: number;
    discount?: number;
    tax?: number;
    total: number;
  },
): Record<string, unknown> {
  return {
    uid,
    name: options.name,
    variation_name: options.variationName,
    catalog_object_id: options.catalogObjectId,
    quantity: options.quantity,
    gross_sales_money: money(options.gross),
    total_discount_money: money(options.discount ?? 0),
    total_tax_money: money(options.tax ?? 0),
    total_money: money(options.total),
  };
}

function order(
  id: string,
  options: {
    state?: string;
    customerId?: string;
    total: number;
    tax?: number;
    discount?: number;
    serviceCharge?: number;
    tip?: number;
    source?: string;
    version?: number;
    updatedAt?: string;
    createdAt?: string;
    closedAt?: string;
    lines?: Record<string, unknown>[];
    netTotal?: number;
    netTax?: number;
    netDiscount?: number;
    netTip?: number;
    netServiceCharge?: number;
  },
): Record<string, unknown> {
  const tip = options.tip ?? 0;
  const tax = options.tax ?? 0;
  const discount = options.discount ?? 0;
  const serviceCharge = options.serviceCharge ?? 0;
  return {
    id,
    location_id: "L1",
    state: options.state ?? "COMPLETED",
    created_at: options.createdAt ?? CREATED,
    updated_at: options.updatedAt ?? options.closedAt ?? CREATED,
    closed_at: options.closedAt ?? CREATED,
    customer_id: options.customerId,
    version: options.version ?? 1,
    source: options.source ? { name: options.source } : undefined,
    total_money: money(options.total),
    total_tax_money: money(tax),
    total_discount_money: money(discount),
    total_tip_money: money(tip),
    total_service_charge_money: money(serviceCharge),
    net_amounts: {
      total_money: money(options.netTotal ?? options.total),
      tax_money: money(options.netTax ?? tax),
      discount_money: money(options.netDiscount ?? discount),
      tip_money: money(options.netTip ?? tip),
      service_charge_money: money(options.netServiceCharge ?? serviceCharge),
    },
    line_items: options.lines,
  };
}

function returnOnlyOrder(
  id: string,
  netTotal: number,
  netTax: number,
): Record<string, unknown> {
  return {
    id,
    location_id: "L1",
    state: "COMPLETED",
    created_at: CREATED,
    updated_at: CREATED,
    closed_at: CREATED,
    version: 1,
    net_amounts: {
      total_money: money(netTotal),
      tax_money: money(netTax),
    },
  };
}

function invalidGrossOrder(id: string, netTotal: number): Record<string, unknown> {
  return {
    id,
    location_id: "L1",
    state: "COMPLETED",
    created_at: CREATED,
    updated_at: CREATED,
    closed_at: CREATED,
    version: 1,
    net_amounts: {
      total_money: money(netTotal),
    },
  };
}

function invalidReturnEvidenceOrder(
  id: string,
  returnedDiscount: number,
): Record<string, unknown> {
  return {
    id,
    location_id: "L1",
    state: "COMPLETED",
    created_at: CREATED,
    updated_at: CREATED,
    closed_at: CREATED,
    version: 1,
    net_amounts: {
      total_money: money(0),
      tax_money: money(0),
      discount_money: money(-returnedDiscount),
      tip_money: money(0),
      service_charge_money: money(0),
    },
    return_amounts: {
      total_money: money(0),
      tax_money: money(0),
      discount_money: money(returnedDiscount),
      tip_money: money(0),
      service_charge_money: money(0),
    },
    returns: [
      {
        uid: "RET-UID",
        source_order_id: "SRC-ORDER-1",
        note: "do not persist",
        return_discounts: [{ name: "Staff discount" }],
        return_amounts: {
          discount_money: money(returnedDiscount),
        },
      },
    ],
  };
}

function payment(
  id: string,
  orderId: string,
  options: {
    amount: number;
    tip?: number;
    fee?: number;
    fees?: { type: string; amount: number }[];
    method: string;
  },
): Record<string, unknown> {
  const processingFee =
    options.fees?.map((entry) => ({
      type: entry.type,
      amount_money: money(entry.amount),
    })) ??
    (options.fee === undefined
      ? undefined
      : [{ type: "INITIAL", amount_money: money(options.fee) }]);
  return {
    id,
    order_id: orderId,
    location_id: "L1",
    status: "COMPLETED",
    created_at: CREATED,
    updated_at: CREATED,
    source_type: options.method,
    amount_money: money(options.amount),
    tip_money: money(options.tip ?? 0),
    processing_fee: processingFee,
  };
}

function refund(
  id: string,
  paymentId: string,
  orderId: string,
  amount: number,
): Record<string, unknown> {
  return {
    id,
    payment_id: paymentId,
    order_id: orderId,
    location_id: "L1",
    status: "COMPLETED",
    created_at: CREATED,
    amount_money: money(amount),
    reason: "do not persist",
  };
}

async function seedCatalog(database: DatabaseService): Promise<void> {
  const [product] = await database.db
    .insert(products)
    .values({ name: "SYNTHETIC Commerce Product", status: "active" })
    .returning({ id: products.id });
  if (!product) {
    throw new Error("product seed failed");
  }
  const [variation] = await database.db
    .insert(productVariations)
    .values({
      productId: product.id,
      name: "Each",
      sku: "SYN-SKU",
      status: "active",
    })
    .returning({ id: productVariations.id });
  if (!variation) {
    throw new Error("variation seed failed");
  }
  await database.db.insert(sourceIdentities).values([
    {
      provider: SQUARE_PROVIDER,
      entityType: SQUARE_ITEM_ENTITY,
      externalId: ITEM,
      internalEntityType: INTERNAL_PRODUCT,
      internalEntityId: product.id,
    },
    {
      provider: SQUARE_PROVIDER,
      entityType: SQUARE_ITEM_VARIATION_ENTITY,
      externalId: VAR,
      internalEntityType: INTERNAL_PRODUCT_VARIATION,
      internalEntityId: variation.id,
    },
  ]);
}

async function loadSale(
  database: DatabaseService,
  externalId: string,
): Promise<{
  id: string;
  kind: string;
  status: string;
  totalAmount: number;
  discountAmount: number;
  taxAmount: number;
  serviceChargeAmount: number;
}> {
  const id = await resolvedId(database, SQUARE_ORDER_ENTITY, externalId);
  if (!id) {
    throw new Error(`missing sale ${externalId}`);
  }
  const [row] = await database.db
    .select({
      id: sales.id,
      kind: sales.kind,
      status: sales.status,
      totalAmount: sales.totalAmount,
      discountAmount: sales.discountAmount,
      taxAmount: sales.taxAmount,
      serviceChargeAmount: sales.serviceChargeAmount,
    })
    .from(sales)
    .where(eq(sales.id, id))
    .limit(1);
  if (!row) {
    throw new Error("sale row missing");
  }
  return row;
}

async function listLines(
  database: DatabaseService,
  saleId: string,
): Promise<
  {
    id: string;
    description: string | null;
    quantity: string;
    productId: string | null;
    productVariationId: string | null;
    isActive: boolean;
  }[]
> {
  return database.db
    .select({
      id: saleLineItems.id,
      description: saleLineItems.description,
      quantity: saleLineItems.quantity,
      productId: saleLineItems.productId,
      productVariationId: saleLineItems.productVariationId,
      isActive: saleLineItems.isActive,
    })
    .from(saleLineItems)
    .where(eq(saleLineItems.saleId, saleId));
}

async function loadPayment(
  database: DatabaseService,
  externalId: string,
): Promise<{
  id: string;
  saleId: string;
  amount: number;
  tipAmount: number;
  processingFeeAmount: number | null;
  method: string | null;
}> {
  const id = await resolvedId(database, SQUARE_PAYMENT_ENTITY, externalId);
  if (!id) {
    throw new Error(`missing payment ${externalId}`);
  }
  const [row] = await database.db
    .select({
      id: payments.id,
      saleId: payments.saleId,
      amount: payments.amount,
      tipAmount: payments.tipAmount,
      processingFeeAmount: payments.processingFeeAmount,
      method: payments.method,
    })
    .from(payments)
    .where(eq(payments.id, id))
    .limit(1);
  if (!row) {
    throw new Error("payment row missing");
  }
  return row;
}

async function loadRefund(
  database: DatabaseService,
  externalId: string,
): Promise<{ id: string; saleId: string | null; paymentId: string | null; amount: number }> {
  const id = await resolvedId(database, SQUARE_REFUND_ENTITY, externalId);
  if (!id) {
    throw new Error(`missing refund ${externalId}`);
  }
  const [row] = await database.db
    .select({
      id: refunds.id,
      saleId: refunds.saleId,
      paymentId: refunds.paymentId,
      amount: refunds.amount,
    })
    .from(refunds)
    .where(eq(refunds.id, id))
    .limit(1);
  if (!row) {
    throw new Error("refund row missing");
  }
  return row;
}

async function countIdentities(
  database: DatabaseService,
  entityType: string,
  externalIds: string[],
): Promise<number> {
  const rows = await database.db
    .select({ internalEntityId: sourceIdentities.internalEntityId })
    .from(sourceIdentities)
    .where(
      and(
        eq(sourceIdentities.provider, SQUARE_PROVIDER),
        eq(sourceIdentities.entityType, entityType),
        inArray(sourceIdentities.externalId, externalIds),
      ),
    );
  return rows.filter((row) => row.internalEntityId).length;
}

async function countSnapshots(
  database: DatabaseService,
  externalIds: string[],
): Promise<number> {
  const rows = await database.db
    .select({ id: sourceSnapshots.id })
    .from(sourceSnapshots)
    .where(
      and(
        eq(sourceSnapshots.provider, SQUARE_PROVIDER),
        eq(sourceSnapshots.entityType, SQUARE_ORDER_ENTITY),
        inArray(sourceSnapshots.externalId, externalIds),
      ),
    );
  return rows.length;
}

async function resolvedId(
  database: DatabaseService,
  entityType: string,
  externalId: string,
): Promise<string | undefined> {
  const rows = await database.db
    .select({ internalEntityId: sourceIdentities.internalEntityId })
    .from(sourceIdentities)
    .where(
      and(
        eq(sourceIdentities.provider, SQUARE_PROVIDER),
        eq(sourceIdentities.entityType, entityType),
        eq(sourceIdentities.externalId, externalId),
      ),
    )
    .limit(1);
  return rows[0]?.internalEntityId ?? undefined;
}

async function cleanup(database: DatabaseService): Promise<void> {
  const identities = await database.db
    .select({
      entityType: sourceIdentities.entityType,
      internalEntityId: sourceIdentities.internalEntityId,
    })
    .from(sourceIdentities)
    .where(
      and(
        eq(sourceIdentities.provider, SQUARE_PROVIDER),
        or(
          inArray(sourceIdentities.externalId, ALL_EXTERNAL_IDS),
          like(sourceIdentities.externalId, "SYN-SQ-COM-%"),
        ),
      ),
    );

  const saleIds = identities
    .filter((row) => row.entityType === SQUARE_ORDER_ENTITY)
    .map((row) => row.internalEntityId)
    .filter((id): id is string => Boolean(id));
  const paymentIds = identities
    .filter((row) => row.entityType === SQUARE_PAYMENT_ENTITY)
    .map((row) => row.internalEntityId)
    .filter((id): id is string => Boolean(id));
  const refundIds = identities
    .filter((row) => row.entityType === SQUARE_REFUND_ENTITY)
    .map((row) => row.internalEntityId)
    .filter((id): id is string => Boolean(id));
  const variationIds = identities
    .filter((row) => row.entityType === SQUARE_ITEM_VARIATION_ENTITY)
    .map((row) => row.internalEntityId)
    .filter((id): id is string => Boolean(id));
  const productIds = identities
    .filter((row) => row.entityType === SQUARE_ITEM_ENTITY)
    .map((row) => row.internalEntityId)
    .filter((id): id is string => Boolean(id));
  const lineIds = identities
    .filter((row) => row.entityType === SQUARE_ORDER_LINE_ENTITY)
    .map((row) => row.internalEntityId)
    .filter((id): id is string => Boolean(id));

  if (refundIds.length > 0) {
    await database.db.delete(refunds).where(inArray(refunds.id, refundIds));
  }
  if (paymentIds.length > 0) {
    await database.db.delete(payments).where(inArray(payments.id, paymentIds));
  }
  if (lineIds.length > 0) {
    await database.db
      .delete(saleLineItems)
      .where(inArray(saleLineItems.id, lineIds));
  }
  if (saleIds.length > 0) {
    await database.db
      .delete(saleLineItems)
      .where(inArray(saleLineItems.saleId, saleIds));
    await database.db.delete(sales).where(inArray(sales.id, saleIds));
  }
  if (variationIds.length > 0) {
    await database.db
      .delete(productVariations)
      .where(inArray(productVariations.id, variationIds));
  }
  if (productIds.length > 0) {
    await database.db.delete(products).where(inArray(products.id, productIds));
  }

  await database.db
    .delete(sourceIdentities)
    .where(
      and(
        eq(sourceIdentities.provider, SQUARE_PROVIDER),
        or(
          inArray(sourceIdentities.externalId, ALL_EXTERNAL_IDS),
          like(sourceIdentities.externalId, "SYN-SQ-COM-%"),
        ),
      ),
    );
  await database.db
    .delete(sourceSnapshots)
    .where(
      and(
        eq(sourceSnapshots.provider, SQUARE_PROVIDER),
        or(
          inArray(sourceSnapshots.externalId, ALL_EXTERNAL_IDS),
          like(sourceSnapshots.externalId, "SYN-SQ-COM-%"),
        ),
      ),
    );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "test failed";
  console.error(message);
  process.exitCode = 1;
});
