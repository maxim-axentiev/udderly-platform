import { NestFactory } from "@nestjs/core";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { AppModule } from "../../app.module";
import { loadEnvFiles } from "../../config/load-env";
import { DatabaseService } from "../../database/database.service";
import {
  payments,
  products,
  productVariations,
  saleLineItems,
  sales,
} from "../../database/schema/commerce";
import { sourceIdentities } from "../../database/schema/source-identity";
import { sourceSnapshots } from "../../database/schema/source-snapshots";
import { SquareCommerceImportService } from "./square-commerce-import.service";
import { SquareCommerceNormalizeService } from "./square-commerce-normalize.service";
import { SquareCommerceReconcileService } from "./square-commerce-reconcile.service";
import { SquarePaymentOrderRecoveryService } from "./square-payment-order-recovery.service";
import {
  INTERNAL_PAYMENT,
  INTERNAL_PRODUCT,
  INTERNAL_PRODUCT_VARIATION,
  SQUARE_ITEM_ENTITY,
  SQUARE_ITEM_VARIATION_ENTITY,
  SQUARE_ORDER_ENTITY,
  SQUARE_ORDER_LINE_ENTITY,
  SQUARE_PAYMENT_ENTITY,
  SQUARE_PROVIDER,
} from "./square.constants";

const MAY = { from: "2026-05-01", to: "2026-05-31" } as const;
const APRIL = { from: "2026-04-01", to: "2026-04-30" } as const;
const MARCH = { date: "2026-03-15" } as const;
const MAY_CREATED = "2026-05-15T16:00:00.000Z";
const APRIL_CLOSED = "2026-04-20T16:00:00.000Z";
const MARCH_CREATED = "2026-03-15T16:00:00.000Z";

const ORDER_GROSS = "SYN-SQ-POR-ORDER-GROSS";
const ORDER_REUSE = "SYN-SQ-POR-ORDER-REUSE";
const ORDER_RETURN = "SYN-SQ-POR-ORDER-RETURN";
const ORDER_ADJUST = "SYN-SQ-POR-ORDER-ADJUST";
const ORDER_INVALID = "SYN-SQ-POR-ORDER-INVALID";
const ORDER_CATALOG = "SYN-SQ-POR-ORDER-CATALOG";
const ORDER_SANITIZE = "SYN-SQ-POR-ORDER-SANITIZE";
const ORDER_EXTRA = "SYN-SQ-POR-ORDER-EXTRA";
const PAY_GROSS = "SYN-SQ-POR-PAY-GROSS";
const PAY_REUSE = "SYN-SQ-POR-PAY-REUSE";
const PAY_RETURN = "SYN-SQ-POR-PAY-RETURN";
const PAY_ADJUST = "SYN-SQ-POR-PAY-ADJUST";
const PAY_INVALID = "SYN-SQ-POR-PAY-INVALID";
const PAY_CATALOG = "SYN-SQ-POR-PAY-CATALOG";
const PAY_DRY = "SYN-SQ-POR-PAY-DRY";
const PAY_RESOLVED = "SYN-SQ-POR-PAY-RESOLVED";
const VAR_OK = "SYN-SQ-POR-VAR-OK";
const ITEM_OK = "SYN-SQ-POR-ITEM-OK";
const VAR_MISSING = "SYN-SQ-POR-VAR-MISSING";
const ORDER_OPEN = "SYN-SQ-POR-ORDER-OPEN";
const ORDER_MARCH = "SYN-SQ-POR-ORDER-MARCH";
const ORDER_OPEN_H = "SYN-SQ-POR-ORDER-OPEN-H";
const ORDER_OPEN_I = "SYN-SQ-POR-ORDER-OPEN-I";
const ORDER_OPEN_J = "SYN-SQ-POR-ORDER-OPEN-J";
const ORDER_OPEN_K = "SYN-SQ-POR-ORDER-OPEN-K";
const PAY_FAILED_OPEN = "SYN-SQ-POR-PAY-FAIL-OPEN";
const PAY_MARCH = "SYN-SQ-POR-PAY-MARCH";
const PAY_FAIL_APPROVED = "SYN-SQ-POR-PAY-FAIL-APPR";
const PAY_FAIL_FEE = "SYN-SQ-POR-PAY-FAIL-FEE";
const PAY_FAIL_REFUND = "SYN-SQ-POR-PAY-FAIL-REF";
const PAY_COMPLETED_OPEN = "SYN-SQ-POR-PAY-COMP-OPEN";

const ALL_EXTERNAL_IDS = [
  ORDER_GROSS,
  ORDER_REUSE,
  ORDER_RETURN,
  ORDER_ADJUST,
  ORDER_INVALID,
  ORDER_CATALOG,
  ORDER_SANITIZE,
  ORDER_EXTRA,
  PAY_GROSS,
  PAY_REUSE,
  PAY_RETURN,
  PAY_ADJUST,
  PAY_INVALID,
  PAY_CATALOG,
  PAY_DRY,
  PAY_RESOLVED,
  VAR_OK,
  ITEM_OK,
  VAR_MISSING,
  ORDER_OPEN,
  ORDER_MARCH,
  ORDER_OPEN_H,
  ORDER_OPEN_I,
  ORDER_OPEN_J,
  ORDER_OPEN_K,
  PAY_FAILED_OPEN,
  PAY_MARCH,
  PAY_FAIL_APPROVED,
  PAY_FAIL_FEE,
  PAY_FAIL_REFUND,
  PAY_COMPLETED_OPEN,
  `${ORDER_GROSS}:L1`,
  `${ORDER_REUSE}:L1`,
  `${ORDER_CATALOG}:L1`,
  `${ORDER_OPEN}:L1`,
  `${ORDER_MARCH}:L1`,
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
  const recovery = app.get(SquarePaymentOrderRecoveryService);

  try {
    await cleanup(database);
    await seedCatalog(database);

    await importer.persistCommerceObjects({
      payments: [
        payment(PAY_DRY, ORDER_GROSS, 19972),
        payment(PAY_RESOLVED, "SYN-SQ-POR-ORDER-ABSENT", 500),
      ],
    });
    await database.db.insert(sourceIdentities).values({
      provider: SQUARE_PROVIDER,
      entityType: SQUARE_PAYMENT_ENTITY,
      externalId: PAY_RESOLVED,
      internalEntityType: INTERNAL_PAYMENT,
      internalEntityId: "00000000-0000-4000-8000-000000000001",
    });

    const discovery = await recovery.discoverWindow(MAY);
    if (discovery.unresolvedPayments !== 1) {
      throw new Error("expected one unresolved payment missing its order snapshot");
    }
    if (discovery.distinctMissingOrderIds.length !== 1) {
      throw new Error("resolved payments must not be discovered");
    }
    if (discovery.paymentAmountAwaitingDependency !== 19972) {
      throw new Error("payment amount awaiting dependency must match source amount");
    }
    console.log("- A/B. unresolved missing-order payments are discovered; resolved payments are ignored");

    const snapshotsBeforeDry = await countSnapshots(database);
    const dry = await recovery.recoverWindow(MAY, { dryRun: true });
    if (!dry.dryRun || !dry.report.includes("Dry run only")) {
      throw new Error("dry-run must not retrieve or write");
    }
    if (dry.report.includes(PAY_DRY) || dry.report.includes(ORDER_GROSS)) {
      throw new Error("dry-run report must not include payment or order ids");
    }
    if ((await countSnapshots(database)) !== snapshotsBeforeDry) {
      throw new Error("dry-run must not insert snapshots");
    }
    console.log("- Q. dry-run performs no API calls or writes");

    const sanitizerPersist = await recovery.persistRetrievedOrders(
      [ORDER_SANITIZE],
      [
        {
          ...grossOrder(ORDER_SANITIZE, 100),
          buyer_email_address: "hidden@example.com",
          note: "do not persist",
        },
        grossOrder(ORDER_EXTRA, 200),
      ],
      MAY,
    );
    if (sanitizerPersist.ordersRequested !== 1 || sanitizerPersist.ordersReturned !== 1) {
      throw new Error("only requested order ids may be counted as returned");
    }
    if (sanitizerPersist.ordersMissing !== 0) {
      throw new Error("requested sanitizer order should be present");
    }
    const sanitized = await loadSnapshotPayload(database, ORDER_SANITIZE);
    if (sanitized.buyer_email_address || sanitized.note) {
      throw new Error("recovered orders must pass through the existing sanitizer");
    }
    if (await loadSnapshotPayload(database, ORDER_EXTRA).catch(() => undefined)) {
      throw new Error("unrequested returned orders must not be persisted");
    }
    console.log("- G. retrieved orders go through the existing sanitizer");

    const missingPersist = await recovery.persistRetrievedOrders(
      [ORDER_GROSS, "SYN-SQ-POR-ORDER-MISSING"],
      [grossOrder(ORDER_GROSS, 19972)],
      MAY,
    );
    if (missingPersist.ordersRequested !== 2) {
      throw new Error("requested count must include omitted ids");
    }
    if (missingPersist.ordersReturned !== 1 || missingPersist.ordersMissing !== 1) {
      throw new Error("omitted BatchRetrieveOrders ids must be reported, not fabricated");
    }
    if (missingPersist.closedAt.closedBeforeWindow !== 1) {
      throw new Error("April closed_at must count as before the May payment window");
    }
    console.log("- F. missing returned orders are reported, not fabricated");

    await importer.persistCommerceObjects({
      payments: [payment(PAY_GROSS, ORDER_GROSS, 19972)],
    });
    const mayFirst = await normalizer.normalizeWindow(MAY);
    if (mayFirst.dependencyOrdersApplied !== 1) {
      throw new Error("exact out-of-window order snapshot must apply as a dependency");
    }
    if (mayFirst.payments !== 2 || mayFirst.unresolvedPayments !== 1) {
      throw new Error("payments that share the recovered gross order must resolve");
    }
    if (mayFirst.sales !== 0) {
      throw new Error("May order loop must not count an April-closed dependency as a May sale");
    }
    const grossSale = await loadSale(database, ORDER_GROSS);
    if (grossSale.occurredAt?.toISOString() !== APRIL_CLOSED) {
      throw new Error("dependency sale must keep original order.closed_at");
    }
    if (!(await resolvedId(database, SQUARE_PAYMENT_ENTITY, PAY_GROSS))) {
      throw new Error("May payment must resolve to the dependency sale");
    }
    console.log("- H/I/J. out-of-window gross dependency creates a sale and attaches the payment");

    const mayAgain = await normalizer.normalizeWindow(MAY);
    if (mayAgain.dependencyOrdersApplied !== 0) {
      throw new Error("already-canonical dependency sales must not count as newly applied");
    }
    console.log("- K. already-canonical dependency orders are reused");

    const aprilAgain = await normalizer.normalizeWindow(APRIL);
    const sameSale = await loadSale(database, ORDER_GROSS);
    if (sameSale.id !== grossSale.id) {
      throw new Error("later month normalize must reuse the same canonical sale");
    }
    if (aprilAgain.sales < 1) {
      throw new Error("April normalize should apply the existing gross sale");
    }
    console.log("- P. later normalization of the dependency month is idempotent");

    const mayRecon = await reconcilor.reconcileWindow(MAY);
    if (mayRecon.totals.canonicalSales !== 0) {
      throw new Error("May reconcile must not count April-closed dependency sales");
    }

    await importer.persistCommerceObjects({
      orders: [grossOrder(ORDER_REUSE, 400)],
      payments: [payment(PAY_REUSE, ORDER_REUSE, 400)],
    });
    const aprilReuse = await normalizer.normalizeWindow(APRIL);
    if (aprilReuse.sales < 1) {
      throw new Error("reuse order should create a sale in its own month first");
    }
    const reuseSaleId = await resolvedId(database, SQUARE_ORDER_ENTITY, ORDER_REUSE);
    const mayReuse = await normalizer.normalizeWindow(MAY);
    if (mayReuse.dependencyOrdersApplied !== 0) {
      throw new Error("pre-existing canonical sale must not count as a newly applied dependency");
    }
    if ((await resolvedId(database, SQUARE_ORDER_ENTITY, ORDER_REUSE)) !== reuseSaleId) {
      throw new Error("pre-existing sale identity must be reused");
    }
    if (!(await resolvedId(database, SQUARE_PAYMENT_ENTITY, PAY_REUSE))) {
      throw new Error("payment against an already-canonical order must resolve");
    }

    await importer.persistCommerceObjects({
      orders: [
        returnOnlyOrder(ORDER_RETURN, -1000, -100),
        returnAdjustmentOrder(ORDER_ADJUST, 1375),
        invalidGrossOrder(ORDER_INVALID, 50),
        catalogOrder(ORDER_CATALOG, VAR_MISSING),
      ],
      payments: [
        payment(PAY_RETURN, ORDER_RETURN, 1000),
        payment(PAY_ADJUST, ORDER_ADJUST, 0),
        payment(PAY_INVALID, ORDER_INVALID, 50),
        payment(PAY_CATALOG, ORDER_CATALOG, 250),
      ],
    });
    const nonSale = await normalizer.normalizeWindow(MAY);
    if (await resolvedId(database, SQUARE_ORDER_ENTITY, ORDER_RETURN)) {
      throw new Error("return-only dependency must not create a sale");
    }
    if (await resolvedId(database, SQUARE_ORDER_ENTITY, ORDER_ADJUST)) {
      throw new Error("return-adjustment dependency must not create a sale");
    }
    if (await resolvedId(database, SQUARE_ORDER_ENTITY, ORDER_INVALID)) {
      throw new Error("invalid dependency must not create a sale");
    }
    if (await resolvedId(database, SQUARE_PAYMENT_ENTITY, PAY_RETURN)) {
      throw new Error("return-only dependency payment must remain unresolved");
    }
    if (await resolvedId(database, SQUARE_PAYMENT_ENTITY, PAY_ADJUST)) {
      throw new Error("return-adjustment dependency payment must remain unresolved");
    }
    if (await resolvedId(database, SQUARE_PAYMENT_ENTITY, PAY_INVALID)) {
      throw new Error("invalid dependency payment must remain unresolved");
    }
    if (nonSale.unresolvedPayments < 3) {
      throw new Error("non-sale dependencies must leave payments unresolved");
    }
    console.log("- L/M/N. non-sale dependency orders do not create sales");

    if (!(await resolvedId(database, SQUARE_ORDER_ENTITY, ORDER_CATALOG))) {
      throw new Error("gross dependency with unresolved catalog must still create a sale");
    }
    const catalogSale = await loadSale(database, ORDER_CATALOG);
    const lines = await listLines(database, catalogSale.id);
    if (lines.length !== 1) {
      throw new Error("unresolved catalog line must still be kept");
    }
    if (lines[0]?.productId || lines[0]?.productVariationId) {
      throw new Error("unresolved catalog ids must not be fuzzy-matched onto products");
    }
    if (nonSale.unresolvedCatalogLines < 1) {
      throw new Error("unresolved catalog dependency lines must increment the counter");
    }
    console.log("- O. unresolved catalog ids on dependency lines are kept, not fuzzy matched");

    await importer.persistCommerceObjects({
      orders: [
        openOrder(ORDER_OPEN, 19972, MARCH_CREATED),
        {
          ...grossOrder(ORDER_MARCH, 1000),
          created_at: MARCH_CREATED,
          updated_at: MARCH_CREATED,
          closed_at: MARCH_CREATED,
        },
      ],
      payments: [
        payment(PAY_FAILED_OPEN, ORDER_OPEN, 19972, {
          status: "FAILED",
          createdAt: MARCH_CREATED,
          approved: 0,
          refunded: 0,
        }),
        payment(PAY_MARCH, ORDER_MARCH, 1000, { createdAt: MARCH_CREATED }),
      ],
    });
    const march = await normalizer.normalizeWindow(MARCH);
    if (march.sales !== 1) {
      throw new Error("March must create only the closed-order sale");
    }
    if (march.payments !== 1) {
      throw new Error("Payments counter must count canonical payments only");
    }
    if (march.failedNonSettledPaymentAttemptsSkipped !== 1) {
      throw new Error("expected one failed non-settled attempt skip");
    }
    if (march.unresolvedPayments !== 0) {
      throw new Error("valid failed attempt must not remain unresolved");
    }
    if (await resolvedId(database, SQUARE_ORDER_ENTITY, ORDER_OPEN)) {
      throw new Error("OPEN dependency order must not create a sale");
    }
    if (await resolvedId(database, SQUARE_PAYMENT_ENTITY, PAY_FAILED_OPEN)) {
      throw new Error("failed non-settled attempt must not create a canonical payment");
    }
    const marchAgain = await normalizer.normalizeWindow(MARCH);
    if (
      marchAgain.failedNonSettledPaymentAttemptsSkipped !== 1 ||
      marchAgain.payments !== 1 ||
      (await resolvedId(database, SQUARE_ORDER_ENTITY, ORDER_OPEN))
    ) {
      throw new Error("failed-attempt normalize must remain idempotent");
    }
    const marchRecon = await reconcilor.reconcileWindow(MARCH);
    if (!marchRecon.passed) {
      throw new Error(
        `expected March PASS with skipped failed attempt, got ${marchRecon.differences.join("; ")}`,
      );
    }
    if (marchRecon.totals.sourcePayments !== 2) {
      throw new Error("source payment records must include the failed attempt");
    }
    if (marchRecon.totals.canonicalizableSourcePayments !== 1) {
      throw new Error("failed attempt must not be canonicalizable");
    }
    if (marchRecon.totals.failedNonSettledAttempts !== 1) {
      throw new Error("failed non-settled attempts must be counted");
    }
    if (marchRecon.totals.canonicalPayments !== 1) {
      throw new Error("canonical payments must exclude the failed attempt");
    }
    if (marchRecon.totals.sourcePaymentAmount !== 1000) {
      throw new Error("failed requested amount must be excluded from canonicalizable source total");
    }
    if (marchRecon.totals.failedAttemptRequestedAmount !== 19972) {
      throw new Error("failed attempt requested amount must be reported separately");
    }
    if (marchRecon.totals.canonicalPaymentAmount !== 1000) {
      throw new Error("canonical payment amount must match canonicalizable source");
    }
    console.log("- A-G/M. failed OPEN attempt is skipped, OPEN creates no sale, recon PASS");

    await importer.persistCommerceObjects({
      orders: [
        openOrder(ORDER_OPEN_H, 500, MARCH_CREATED),
        openOrder(ORDER_OPEN_I, 500, MARCH_CREATED),
        openOrder(ORDER_OPEN_J, 500, MARCH_CREATED),
        openOrder(ORDER_OPEN_K, 500, MARCH_CREATED),
      ],
      payments: [
        payment(PAY_FAIL_APPROVED, ORDER_OPEN_H, 500, {
          status: "FAILED",
          createdAt: MARCH_CREATED,
          approved: 500,
        }),
        payment(PAY_FAIL_FEE, ORDER_OPEN_I, 500, {
          status: "FAILED",
          createdAt: MARCH_CREATED,
          approved: 0,
          fee: 30,
        }),
        payment(PAY_FAIL_REFUND, ORDER_OPEN_J, 500, {
          status: "FAILED",
          createdAt: MARCH_CREATED,
          approved: 0,
          refunded: 100,
        }),
        payment(PAY_COMPLETED_OPEN, ORDER_OPEN_K, 500, {
          status: "COMPLETED",
          createdAt: MARCH_CREATED,
        }),
      ],
    });
    const ambiguous = await normalizer.normalizeWindow(MARCH);
    if (ambiguous.unresolvedPayments < 4) {
      throw new Error("ambiguous failed/open payments must remain unresolved");
    }
    if (await resolvedId(database, SQUARE_PAYMENT_ENTITY, PAY_FAIL_APPROVED)) {
      throw new Error("FAILED with approved funds must not be skipped as settled-empty");
    }
    if (await resolvedId(database, SQUARE_PAYMENT_ENTITY, PAY_FAIL_FEE)) {
      throw new Error("FAILED with processing fee must remain unresolved");
    }
    if (await resolvedId(database, SQUARE_PAYMENT_ENTITY, PAY_FAIL_REFUND)) {
      throw new Error("FAILED with refund activity must remain unresolved");
    }
    if (await resolvedId(database, SQUARE_PAYMENT_ENTITY, PAY_COMPLETED_OPEN)) {
      throw new Error("COMPLETED payment on OPEN order must remain unresolved");
    }
    const ambiguousRecon = await reconcilor.reconcileWindow(MARCH);
    if (ambiguousRecon.passed) {
      throw new Error("ambiguous unresolved payments must FAIL reconciliation");
    }
    console.log("- H/I/J/K. approved funds, fees, refunds, and non-FAILED stay FAIL");

    console.log("square payment order recovery tests passed");
  } finally {
    await cleanup(database);
    await app.close();
  }
}

function money(amount: number): { amount: number; currency: string } {
  return { amount, currency: "CAD" };
}

function grossOrder(id: string, total: number): Record<string, unknown> {
  return {
    id,
    location_id: "L1",
    state: "COMPLETED",
    created_at: APRIL_CLOSED,
    updated_at: APRIL_CLOSED,
    closed_at: APRIL_CLOSED,
    version: 1,
    total_money: money(total),
    total_tax_money: money(0),
    total_discount_money: money(0),
    total_tip_money: money(0),
    total_service_charge_money: money(0),
    line_items: [
      {
        uid: "L1",
        name: "Milk",
        quantity: "1",
        catalog_object_id: VAR_OK,
        total_money: money(total),
      },
    ],
  };
}

function catalogOrder(id: string, catalogObjectId: string): Record<string, unknown> {
  return {
    ...grossOrder(id, 250),
    line_items: [
      {
        uid: "L1",
        name: "Historical",
        quantity: "1",
        catalog_object_id: catalogObjectId,
        catalog_version: 11,
        total_money: money(250),
      },
    ],
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
    created_at: APRIL_CLOSED,
    updated_at: APRIL_CLOSED,
    closed_at: APRIL_CLOSED,
    version: 1,
    net_amounts: {
      total_money: money(netTotal),
      tax_money: money(netTax),
    },
  };
}

function returnAdjustmentOrder(id: string, returnedDiscount: number): Record<string, unknown> {
  return {
    id,
    location_id: "L1",
    state: "COMPLETED",
    created_at: APRIL_CLOSED,
    updated_at: APRIL_CLOSED,
    closed_at: APRIL_CLOSED,
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
        return_amounts: {
          discount_money: money(returnedDiscount),
        },
      },
    ],
  };
}

function invalidGrossOrder(id: string, netTotal: number): Record<string, unknown> {
  return {
    id,
    location_id: "L1",
    state: "COMPLETED",
    created_at: APRIL_CLOSED,
    updated_at: APRIL_CLOSED,
    closed_at: APRIL_CLOSED,
    version: 1,
    net_amounts: {
      total_money: money(netTotal),
    },
  };
}

function openOrder(
  id: string,
  total: number,
  createdAt: string,
): Record<string, unknown> {
  return {
    id,
    location_id: "L1",
    state: "OPEN",
    created_at: createdAt,
    updated_at: createdAt,
    version: 1,
    total_money: money(total),
    total_tax_money: money(0),
    total_discount_money: money(0),
    total_tip_money: money(0),
    total_service_charge_money: money(0),
    line_items: [
      {
        uid: "L1",
        name: "Open cart",
        quantity: "1",
        catalog_object_id: VAR_OK,
        total_money: money(total),
      },
    ],
  };
}

function payment(
  id: string,
  orderId: string,
  amount: number,
  options: {
    status?: string;
    createdAt?: string;
    approved?: number;
    refunded?: number;
    fee?: number;
  } = {},
): Record<string, unknown> {
  const createdAt = options.createdAt ?? MAY_CREATED;
  return {
    id,
    order_id: orderId,
    location_id: "L1",
    status: options.status ?? "COMPLETED",
    created_at: createdAt,
    updated_at: createdAt,
    source_type: "CARD",
    amount_money: money(amount),
    ...(options.approved === undefined
      ? {}
      : { approved_money: money(options.approved) }),
    ...(options.refunded === undefined
      ? {}
      : { refunded_money: money(options.refunded) }),
    ...(options.fee === undefined
      ? {}
      : { processing_fee: [{ type: "INITIAL", amount_money: money(options.fee) }] }),
  };
}

async function seedCatalog(database: DatabaseService): Promise<void> {
  const [product] = await database.db
    .insert(products)
    .values({ name: "SYNTHETIC Payment Order Recovery Product", status: "active" })
    .returning({ id: products.id });
  if (!product) {
    throw new Error("product seed failed");
  }
  const [variation] = await database.db
    .insert(productVariations)
    .values({
      productId: product.id,
      name: "Each",
      sku: "SYN-POR-SKU",
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
      externalId: ITEM_OK,
      internalEntityType: INTERNAL_PRODUCT,
      internalEntityId: product.id,
    },
    {
      provider: SQUARE_PROVIDER,
      entityType: SQUARE_ITEM_VARIATION_ENTITY,
      externalId: VAR_OK,
      internalEntityType: INTERNAL_PRODUCT_VARIATION,
      internalEntityId: variation.id,
    },
  ]);
}

async function loadSale(
  database: DatabaseService,
  externalId: string,
): Promise<{ id: string; occurredAt: Date | null }> {
  const id = await resolvedId(database, SQUARE_ORDER_ENTITY, externalId);
  if (!id) {
    throw new Error(`missing sale ${externalId}`);
  }
  const [row] = await database.db
    .select({ id: sales.id, occurredAt: sales.occurredAt })
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
): Promise<{ productId: string | null; productVariationId: string | null }[]> {
  return database.db
    .select({
      productId: saleLineItems.productId,
      productVariationId: saleLineItems.productVariationId,
    })
    .from(saleLineItems)
    .where(eq(saleLineItems.saleId, saleId));
}

async function loadSnapshotPayload(
  database: DatabaseService,
  externalId: string,
): Promise<Record<string, unknown>> {
  const [row] = await database.db
    .select({ payload: sourceSnapshots.payload })
    .from(sourceSnapshots)
    .where(
      and(
        eq(sourceSnapshots.provider, SQUARE_PROVIDER),
        eq(sourceSnapshots.externalId, externalId),
      ),
    )
    .limit(1);
  if (!row) {
    throw new Error(`missing snapshot ${externalId}`);
  }
  return row.payload;
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

async function countSnapshots(database: DatabaseService): Promise<number> {
  const rows = await database.db
    .select({ id: sourceSnapshots.id })
    .from(sourceSnapshots)
    .where(
      and(
        eq(sourceSnapshots.provider, SQUARE_PROVIDER),
        or(
          inArray(sourceSnapshots.externalId, ALL_EXTERNAL_IDS),
          like(sourceSnapshots.externalId, "SYN-SQ-POR-%"),
        ),
      ),
    );
  return rows.length;
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
          like(sourceIdentities.externalId, "SYN-SQ-POR-%"),
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
          like(sourceIdentities.externalId, "SYN-SQ-POR-%"),
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
          like(sourceSnapshots.externalId, "SYN-SQ-POR-%"),
        ),
      ),
    );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "test failed";
  console.error(message);
  process.exitCode = 1;
});
