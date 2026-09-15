import { loadEnvFiles } from "../../config/load-env";
import { SquareClient } from "./square.client";
import {
  SQUARE_AUDIT_WINDOW_DAYS,
  SQUARE_HISTORICAL_OFFSETS_DAYS,
  SQUARE_HISTORICAL_WINDOW_DAYS,
} from "./square.constants";
import { SquareApiError } from "./square.errors";
import {
  auditRecords,
  distribution,
  formatMoney,
  historicalRange,
  isPlainObject,
  minMaxTimestamps,
  moneyAmount,
  moneyCurrency,
  nestedArray,
  nestedObject,
  percent,
  populatedCount,
  stringValue,
  timestampRange,
  type FieldAudit,
} from "./square-schema-audit";

type CatalogMaps = {
  items: Record<string, unknown>[];
  variations: Record<string, unknown>[];
  categories: Record<string, unknown>[];
  itemById: Map<string, Record<string, unknown>>;
  variationById: Map<string, Record<string, unknown>>;
  categoryById: Map<string, Record<string, unknown>>;
};

async function main(): Promise<void> {
  loadEnvFiles();
  const accessToken = process.env.SQUARE_ACCESS_TOKEN?.trim();
  const applicationId = process.env.SQUARE_APPLICATION_ID?.trim();
  const locationId = process.env.SQUARE_LOCATION_ID?.trim();

  console.log("SQUARE AUDIT");
  console.log("");
  console.log("Connection:");
  console.log(
    `- configured: ${accessToken && applicationId && locationId ? "yes" : "no"}`,
  );
  console.log("- environment: production (connect.squareup.com)");
  console.log("- access: read-only REST");

  if (!accessToken || !applicationId || !locationId) {
    console.log("- API reachable: no (not configured)");
    console.log("");
    console.log(
      "Add SQUARE_ACCESS_TOKEN, SQUARE_APPLICATION_ID, and SQUARE_LOCATION_ID to the root .env file to run this audit.",
    );
    process.exitCode = 1;
    return;
  }

  const range = timestampRange(SQUARE_AUDIT_WINDOW_DAYS);
  console.log(`- window UTC: ${range.startAt} to ${range.endAt}`);
  console.log(`- configured location present in env: yes`);

  const client = new SquareClient({ accessToken, locationId });

  let locations: Record<string, unknown>[] = [];
  try {
    locations = await client.listLocations();
    console.log("- API reachable: yes");
  } catch (error) {
    console.log(`- API reachable: no (${safeFailure(error)})`);
    process.exitCode = 1;
    return;
  }

  printLocations(locations, locationId);

  let orders: Record<string, unknown>[] = [];
  let payments: Record<string, unknown>[] = [];
  let refunds: Record<string, unknown>[] = [];
  let catalogObjects: Record<string, unknown>[] = [];
  let customerPages: Record<string, unknown>[] = [];
  let reportedCustomerCount: number | undefined;
  let groups: Record<string, unknown>[] = [];
  let segments: Record<string, unknown>[] = [];
  let customAttributeDefinitions: Record<string, unknown>[] = [];

  try {
    orders = await client.searchOrders(range);
  } catch (error) {
    console.log(`- orders: ${safeFailure(error)}`);
  }

  try {
    payments = await client.listPayments(range);
  } catch (error) {
    console.log(`- payments: ${safeFailure(error)}`);
  }

  try {
    refunds = await client.listRefunds(range);
  } catch (error) {
    console.log(`- refunds: ${safeFailure(error)}`);
  }

  try {
    catalogObjects = await client.listCatalog([
      "ITEM",
      "ITEM_VARIATION",
      "CATEGORY",
    ]);
  } catch (error) {
    console.log(`- catalog: ${safeFailure(error)}`);
  }

  try {
    const searched = await client.searchCustomers();
    customerPages = searched.customers;
    reportedCustomerCount = searched.reportedCount;
  } catch (error) {
    console.log(`- customers: ${safeFailure(error)}`);
  }

  try {
    groups = await client.listCustomerGroups();
  } catch (error) {
    console.log(`- customer groups: ${safeFailure(error)}`);
  }

  try {
    segments = await client.listCustomerSegments();
  } catch (error) {
    console.log(`- customer segments: ${safeFailure(error)}`);
  }

  try {
    customAttributeDefinitions =
      await client.listCustomerCustomAttributeDefinitions();
  } catch (error) {
    console.log(`- customer custom attributes: ${safeFailure(error)}`);
  }

  const catalog = indexCatalog(catalogObjects);
  printOrders(orders);
  printLineItems(orders, catalog);
  printPayments(payments);
  printRefunds(refunds);
  printCustomers(
    customerPages,
    reportedCustomerCount,
    groups,
    segments,
    customAttributeDefinitions,
    orders,
    payments,
  );
  printCatalog(catalog);
  printLinkage(orders, payments, refunds, catalog);
  await printHistorical(client);
  printDataQuality(orders, payments, refunds, catalog, locations);
  printFutureActions();

  forgetCustomerValues(customerPages);
}

function printLocations(
  locations: Record<string, unknown>[],
  configuredId: string,
): void {
  console.log("");
  console.log("Locations:");
  console.log(`- accessible count: ${locations.length}`);

  const configured = locations.find(
    (location) => stringValue(location, "id") === configuredId,
  );
  console.log(`- configured location found: ${configured ? "yes" : "no"}`);

  if (configured) {
    console.log(`- configured name: ${safeName(configured)}`);
    console.log(`- configured status: ${stringValue(configured, "status") ?? "(none)"}`);
    console.log(`- configured country: ${stringValue(configured, "country") ?? "(none)"}`);
    console.log(`- configured currency: ${stringValue(configured, "currency") ?? "(none)"}`);
    console.log(`- configured type: ${stringValue(configured, "type") ?? "(none)"}`);
  }

  if (locations.length > 1) {
    console.log("- other accessible locations (name / status / country / currency):");
    for (const location of locations) {
      if (stringValue(location, "id") === configuredId) {
        continue;
      }
      console.log(
        `  - ${safeName(location)} / ${stringValue(location, "status") ?? "(none)"} / ${stringValue(location, "country") ?? "(none)"} / ${stringValue(location, "currency") ?? "(none)"}`,
      );
    }
  }
}

function printOrders(orders: Record<string, unknown>[]): void {
  console.log("");
  console.log("Orders (last 30 days, configured location):");
  console.log(`- number of orders: ${orders.length}`);
  printDistribution(
    "status",
    distribution(orders.map((order) => stringValue(order, "state"))),
  );

  const created = minMaxTimestamps(
    orders.map((order) => stringValue(order, "created_at")),
  );
  const closed = minMaxTimestamps(
    orders.map((order) => stringValue(order, "closed_at")),
  );
  const updated = minMaxTimestamps(
    orders.map((order) => stringValue(order, "updated_at")),
  );
  console.log(
    `- created_at range: ${created.min ?? "(none)"} to ${created.max ?? "(none)"}`,
  );
  console.log(
    `- closed_at populated: ${populatedCount(orders, "closed_at")} / ${orders.length} (${percent(populatedCount(orders, "closed_at"), orders.length)})`,
  );
  console.log(
    `- closed_at range: ${closed.min ?? "(none)"} to ${closed.max ?? "(none)"}`,
  );
  console.log(
    `- updated_at range: ${updated.min ?? "(none)"} to ${updated.max ?? "(none)"}`,
  );

  const sources = distribution(
    orders.map((order) => {
      const source = nestedObject(order, "source");
      return source ? stringValue(source, "name") : undefined;
    }),
  );
  printDistribution("source.name", sources);

  const withCustomer = populatedCount(orders, "customer_id");
  console.log(
    `- customer_id populated: ${withCustomer} / ${orders.length} (${percent(withCustomer, orders.length)})`,
  );
  console.log(
    `- Known Square customer orders: ${withCustomer} / ${orders.length}`,
  );
  console.log(`  ${percent(withCustomer, orders.length)}`);

  const withLineItems = orders.filter(
    (order) => nestedArray(order, "line_items").length > 0,
  ).length;
  const withFulfillments = orders.filter(
    (order) => nestedArray(order, "fulfillments").length > 0,
  ).length;
  const withDiscounts = orders.filter(
    (order) => nestedArray(order, "discounts").length > 0,
  ).length;
  const withTaxes = orders.filter(
    (order) => nestedArray(order, "taxes").length > 0,
  ).length;
  const withServiceCharges = orders.filter(
    (order) => nestedArray(order, "service_charges").length > 0,
  ).length;
  const withReturns = orders.filter(
    (order) => nestedArray(order, "returns").length > 0,
  ).length;
  const withRefunds = orders.filter(
    (order) => nestedArray(order, "refunds").length > 0,
  ).length;
  const withTenders = orders.filter(
    (order) => nestedArray(order, "tenders").length > 0,
  ).length;

  console.log(
    `- line_items present: ${withLineItems} / ${orders.length} (${percent(withLineItems, orders.length)})`,
  );
  console.log(
    `- fulfillments present: ${withFulfillments} / ${orders.length} (${percent(withFulfillments, orders.length)})`,
  );
  console.log(
    `- discounts present: ${withDiscounts} / ${orders.length} (${percent(withDiscounts, orders.length)})`,
  );
  console.log(
    `- taxes present: ${withTaxes} / ${orders.length} (${percent(withTaxes, orders.length)})`,
  );
  console.log(
    `- service_charges present: ${withServiceCharges} / ${orders.length} (${percent(withServiceCharges, orders.length)})`,
  );
  console.log(
    `- tenders present: ${withTenders} / ${orders.length} (${percent(withTenders, orders.length)})`,
  );
  console.log(
    `- returns present: ${withReturns} / ${orders.length} (${percent(withReturns, orders.length)})`,
  );
  console.log(
    `- order.refunds present: ${withRefunds} / ${orders.length} (${percent(withRefunds, orders.length)})`,
  );

  const totalMoney = sumMoney(orders, "total_money");
  const netAmounts = orders
    .map((order) => nestedObject(order, "net_amounts"))
    .filter((value): value is Record<string, unknown> => Boolean(value));
  console.log(
    `- total_money sum: ${formatMoney(totalMoney.amount, totalMoney.currency)}`,
  );
  console.log(
    `- net_amounts present: ${netAmounts.length} / ${orders.length} (${percent(netAmounts.length, orders.length)})`,
  );
  if (netAmounts.length > 0) {
    console.log(
      `- net_amounts.total_money sum: ${formatMoney(sumNestedMoney(netAmounts, "total_money").amount, totalMoney.currency)}`,
    );
    console.log(
      `- net_amounts.tax_money sum: ${formatMoney(sumNestedMoney(netAmounts, "tax_money").amount, totalMoney.currency)}`,
    );
    console.log(
      `- net_amounts.discount_money sum: ${formatMoney(sumNestedMoney(netAmounts, "discount_money").amount, totalMoney.currency)}`,
    );
    console.log(
      `- net_amounts.tip_money sum: ${formatMoney(sumNestedMoney(netAmounts, "tip_money").amount, totalMoney.currency)}`,
    );
    console.log(
      `- net_amounts.service_charge_money sum: ${formatMoney(sumNestedMoney(netAmounts, "service_charge_money").amount, totalMoney.currency)}`,
    );
  }

  printFieldStructure("order field structure", orders);
}

function printLineItems(
  orders: Record<string, unknown>[],
  catalog: CatalogMaps,
): void {
  const lineItems = orders.flatMap((order) =>
    nestedArray(order, "line_items").filter(isPlainObject),
  );

  console.log("");
  console.log("Line items / retail mix:");
  console.log(`- line item count: ${lineItems.length}`);
  const withCatalogId = populatedCount(lineItems, "catalog_object_id");
  const withCatalogVersion = lineItems.filter(
    (item) => item.catalog_version !== undefined && item.catalog_version !== null,
  ).length;
  const withVariationName = populatedCount(lineItems, "variation_name");
  const withName = populatedCount(lineItems, "name");
  const withQuantity = populatedCount(lineItems, "quantity");
  console.log(
    `- catalog_object_id populated: ${withCatalogId} / ${lineItems.length} (${percent(withCatalogId, lineItems.length)})`,
  );
  console.log(
    `- catalog_version populated: ${withCatalogVersion} / ${lineItems.length} (${percent(withCatalogVersion, lineItems.length)})`,
  );
  console.log(
    `- variation_name populated: ${withVariationName} / ${lineItems.length} (${percent(withVariationName, lineItems.length)})`,
  );
  console.log(
    `- name populated: ${withName} / ${lineItems.length} (${percent(withName, lineItems.length)})`,
  );
  console.log(
    `- quantity populated: ${withQuantity} / ${lineItems.length} (${percent(withQuantity, lineItems.length)})`,
  );

  const withModifiers = lineItems.filter(
    (item) => nestedArray(item, "modifiers").length > 0,
  ).length;
  const withAppliedDiscounts = lineItems.filter(
    (item) => nestedArray(item, "applied_discounts").length > 0,
  ).length;
  const withAppliedTaxes = lineItems.filter(
    (item) => nestedArray(item, "applied_taxes").length > 0,
  ).length;
  console.log(
    `- modifiers present: ${withModifiers} / ${lineItems.length} (${percent(withModifiers, lineItems.length)})`,
  );
  console.log(
    `- applied_discounts present: ${withAppliedDiscounts} / ${lineItems.length} (${percent(withAppliedDiscounts, lineItems.length)})`,
  );
  console.log(
    `- applied_taxes present: ${withAppliedTaxes} / ${lineItems.length} (${percent(withAppliedTaxes, lineItems.length)})`,
  );

  let skuPopulated = 0;
  const productSales = new Map<
    string,
    { label: string; count: number; quantity: number; gross: number; currency: string }
  >();
  const categorySales = new Map<
    string,
    { label: string; count: number; quantity: number; gross: number; currency: string }
  >();
  const modifierNames = new Map<string, number>();

  for (const item of lineItems) {
    const catalogObjectId = stringValue(item, "catalog_object_id");
    const variation = catalogObjectId
      ? catalog.variationById.get(catalogObjectId)
      : undefined;
    const variationData = variation
      ? nestedObject(variation, "item_variation_data")
      : undefined;
    const sku = variationData ? stringValue(variationData, "sku") : undefined;
    if (sku) {
      skuPopulated += 1;
    }

    const itemId = variationData ? stringValue(variationData, "item_id") : undefined;
    const catalogItem = itemId ? catalog.itemById.get(itemId) : undefined;
    const itemData = catalogItem ? nestedObject(catalogItem, "item_data") : undefined;
    const categoryName = categoryNameForItem(itemData, catalog);
    const productName = stringValue(item, "name") ?? "(unnamed)";
    const variationName = stringValue(item, "variation_name");
    const label = variationName ? `${productName} / ${variationName}` : productName;
    const quantity = Number(stringValue(item, "quantity") ?? "0") || 0;
    const grossMoney = item.gross_sales_money ?? item.total_money;
    const gross = moneyAmount(grossMoney) ?? 0;
    const currency = moneyCurrency(grossMoney) ?? "CAD";

    bumpSale(productSales, catalogObjectId ?? `name:${label}`, label, quantity, gross, currency);
    bumpSale(
      categorySales,
      categoryName ?? "(uncategorized)",
      categoryName ?? "(uncategorized)",
      quantity,
      gross,
      currency,
    );

    for (const modifier of nestedArray(item, "modifiers").filter(isPlainObject)) {
      const modifierName = stringValue(modifier, "name") ?? "(unnamed modifier)";
      modifierNames.set(modifierName, (modifierNames.get(modifierName) ?? 0) + 1);
    }
  }

  console.log(
    `- SKU retrievable from catalog variation: ${skuPopulated} / ${lineItems.length} (${percent(skuPopulated, lineItems.length)})`,
  );

  console.log("- item frequency / gross sales (top 25):");
  printSaleRows(productSales, 25);
  console.log("- category sales (from catalog category names):");
  printSaleRows(categorySales, 50);
  if (modifierNames.size > 0) {
    console.log("- modifier names observed:");
    for (const [name, count] of [...modifierNames.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )) {
      console.log(`  - ${name}: ${count}`);
    }
  }

  printFieldStructure("line item field structure", lineItems);
}

function printPayments(payments: Record<string, unknown>[]): void {
  console.log("");
  console.log("Payments (last 30 days, configured location):");
  console.log(`- payment count: ${payments.length}`);
  printDistribution(
    "status",
    distribution(payments.map((payment) => stringValue(payment, "status"))),
  );
  const withOrder = populatedCount(payments, "order_id");
  const withCustomer = populatedCount(payments, "customer_id");
  const withLocation = populatedCount(payments, "location_id");
  console.log(
    `- order_id populated: ${withOrder} / ${payments.length} (${percent(withOrder, payments.length)})`,
  );
  console.log(
    `- customer_id populated: ${withCustomer} / ${payments.length} (${percent(withCustomer, payments.length)})`,
  );
  console.log(
    `- location_id populated: ${withLocation} / ${payments.length} (${percent(withLocation, payments.length)})`,
  );

  const amount = sumMoney(payments, "amount_money");
  const tip = sumMoney(payments, "tip_money");
  const total = sumMoney(payments, "total_money");
  const approved = sumMoney(payments, "approved_money");
  console.log(`- amount_money sum: ${formatMoney(amount.amount, amount.currency)}`);
  console.log(
    `- tip_money populated: ${payments.filter((payment) => moneyAmount(payment.tip_money) !== undefined).length} / ${payments.length}`,
  );
  console.log(`- tip_money sum: ${formatMoney(tip.amount, tip.currency)}`);
  console.log(`- total_money sum: ${formatMoney(total.amount, total.currency)}`);
  console.log(
    `- approved_money sum: ${formatMoney(approved.amount, approved.currency)}`,
  );

  const fees = payments.flatMap((payment) =>
    nestedArray(payment, "processing_fee").filter(isPlainObject),
  );
  console.log(
    `- processing_fee entries: ${fees.length} across ${payments.filter((payment) => nestedArray(payment, "processing_fee").length > 0).length} payments`,
  );
  console.log(
    `- processing_fee amount sum: ${formatMoney(sumNestedMoney(fees, "amount_money").amount, amount.currency)}`,
  );

  const created = minMaxTimestamps(
    payments.map((payment) => stringValue(payment, "created_at")),
  );
  const updated = minMaxTimestamps(
    payments.map((payment) => stringValue(payment, "updated_at")),
  );
  console.log(
    `- created_at range: ${created.min ?? "(none)"} to ${created.max ?? "(none)"}`,
  );
  console.log(
    `- updated_at range: ${updated.min ?? "(none)"} to ${updated.max ?? "(none)"}`,
  );

  const sourceTypes = distribution(
    payments.map((payment) => stringValue(payment, "source_type")),
  );
  printDistribution("source_type", sourceTypes);
  printCollapsedTenderMix(sourceTypes);
  printFieldStructure("payment field structure", payments);
}

function printRefunds(refunds: Record<string, unknown>[]): void {
  console.log("");
  console.log("Refunds (last 30 days, configured location):");
  console.log(`- refund count: ${refunds.length}`);
  printDistribution(
    "status",
    distribution(refunds.map((refund) => stringValue(refund, "status"))),
  );
  const amount = sumMoney(refunds, "amount_money");
  console.log(`- amount_money sum: ${formatMoney(amount.amount, amount.currency)}`);
  const withPayment = populatedCount(refunds, "payment_id");
  const withOrder = populatedCount(refunds, "order_id");
  console.log(
    `- payment_id populated: ${withPayment} / ${refunds.length} (${percent(withPayment, refunds.length)})`,
  );
  console.log(
    `- order_id populated: ${withOrder} / ${refunds.length} (${percent(withOrder, refunds.length)})`,
  );
  const created = minMaxTimestamps(
    refunds.map((refund) => stringValue(refund, "created_at")),
  );
  const updated = minMaxTimestamps(
    refunds.map((refund) => stringValue(refund, "updated_at")),
  );
  console.log(
    `- created_at range: ${created.min ?? "(none)"} to ${created.max ?? "(none)"}`,
  );
  console.log(
    `- updated_at range: ${updated.min ?? "(none)"} to ${updated.max ?? "(none)"}`,
  );
  console.log("- reason text: not printed (may contain personal data)");
  printFieldStructure("refund field structure", refunds);
}

function printCustomers(
  customers: Record<string, unknown>[],
  reportedCount: number | undefined,
  groups: Record<string, unknown>[],
  segments: Record<string, unknown>[],
  definitions: Record<string, unknown>[],
  orders: Record<string, unknown>[],
  payments: Record<string, unknown>[],
): void {
  console.log("");
  console.log("Customers (directory structure only; no PII values):");
  console.log(`- SearchCustomers count field: ${reportedCount ?? "(not returned)"}`);
  console.log(`- customer records retrieved: ${customers.length}`);
  console.log(
    "- note: Square count only includes profiles with public information.",
  );

  const ids = customers
    .map((customer) => stringValue(customer, "id"))
    .filter((value): value is string => Boolean(value));
  console.log(`- id populated: ${ids.length} / ${customers.length}`);
  if (ids.length > 0) {
    const lengths = new Map<number, number>();
    for (const id of ids) {
      lengths.set(id.length, (lengths.get(id.length) ?? 0) + 1);
    }
    console.log(
      `- id length distribution: ${[...lengths.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([length, count]) => `${length} chars x ${count}`)
        .join(", ")}`,
    );
    const sample = ids[0] ?? "";
    console.log(
      `- id shape (no value): length ${sample.length}, charset ${idCharset(sample)}`,
    );
  }

  console.log(
    `- created_at populated: ${populatedCount(customers, "created_at")} / ${customers.length} (${percent(populatedCount(customers, "created_at"), customers.length)})`,
  );
  console.log(
    `- updated_at populated: ${populatedCount(customers, "updated_at")} / ${customers.length} (${percent(populatedCount(customers, "updated_at"), customers.length)})`,
  );
  console.log(
    `- reference_id populated: ${populatedCount(customers, "reference_id")} / ${customers.length} (${percent(populatedCount(customers, "reference_id"), customers.length)})`,
  );
  console.log(
    `- email_address populated: ${populatedCount(customers, "email_address")} / ${customers.length} (${percent(populatedCount(customers, "email_address"), customers.length)})`,
  );
  console.log(
    `- phone_number populated: ${populatedCount(customers, "phone_number")} / ${customers.length} (${percent(populatedCount(customers, "phone_number"), customers.length)})`,
  );
  const withName = customers.filter((customer) => {
    return (
      Boolean(stringValue(customer, "given_name")) ||
      Boolean(stringValue(customer, "family_name")) ||
      Boolean(stringValue(customer, "company_name"))
    );
  }).length;
  console.log(
    `- name populated (given, family, or company): ${withName} / ${customers.length} (${percent(withName, customers.length)})`,
  );
  const withAddress = customers.filter((customer) =>
    isPlainObject(customer.address),
  ).length;
  console.log(
    `- address object populated: ${withAddress} / ${customers.length} (${percent(withAddress, customers.length)})`,
  );
  const withGroups = customers.filter(
    (customer) => nestedArray(customer, "group_ids").length > 0,
  ).length;
  const withSegments = customers.filter(
    (customer) => nestedArray(customer, "segment_ids").length > 0,
  ).length;
  console.log(
    `- group_ids present: ${withGroups} / ${customers.length} (${percent(withGroups, customers.length)})`,
  );
  console.log(
    `- segment_ids present: ${withSegments} / ${customers.length} (${percent(withSegments, customers.length)})`,
  );
  console.log(`- customer groups available: ${groups.length}`);
  for (const group of groups) {
    console.log(`  - ${safeName(group)}`);
  }
  console.log(`- customer segments available: ${segments.length}`);
  for (const segment of segments) {
    console.log(`  - ${safeName(segment)}`);
  }
  console.log(
    `- custom attribute definitions: ${definitions.length} (keys/types only)`,
  );
  for (const definition of definitions) {
    const key = stringValue(definition, "key") ?? "(no key)";
    const schema = nestedObject(definition, "schema");
    const schemaKeys = schema ? Object.keys(schema).sort().join(", ") : "(none)";
    console.log(`  - ${key} schema keys: ${schemaKeys}`);
  }

  const orderCustomer = populatedCount(orders, "customer_id");
  const paymentCustomer = populatedCount(payments, "customer_id");
  console.log(
    `- Orders with customerId: ${orderCustomer} / ${orders.length}`,
  );
  console.log(`  ${percent(orderCustomer, orders.length)}`);
  console.log(
    `- Payments with customerId: ${paymentCustomer} / ${payments.length}`,
  );
  console.log(`  ${percent(paymentCustomer, payments.length)}`);

  printFieldStructure(
    "customer field structure (paths/types only)",
    customers,
  );
}

function printCatalog(catalog: CatalogMaps): void {
  console.log("");
  console.log("Catalog:");
  console.log(`- item count: ${catalog.items.length}`);
  console.log(`- variation count: ${catalog.variations.length}`);
  console.log(`- category count: ${catalog.categories.length}`);

  const deletedItems = catalog.items.filter((item) => item.is_deleted === true).length;
  const deletedVariations = catalog.variations.filter(
    (item) => item.is_deleted === true,
  ).length;
  const archivedItems = catalog.items.filter((item) => {
    const data = nestedObject(item, "item_data");
    return data?.is_archived === true;
  }).length;
  console.log(`- items with is_deleted true: ${deletedItems}`);
  console.log(`- variations with is_deleted true: ${deletedVariations}`);
  console.log(`- items with item_data.is_archived true: ${archivedItems}`);

  const variationsWithSku = catalog.variations.filter((variation) => {
    const data = nestedObject(variation, "item_variation_data");
    return Boolean(data && stringValue(data, "sku"));
  }).length;
  console.log(
    `- variation SKUs populated: ${variationsWithSku} / ${catalog.variations.length} (${percent(variationsWithSku, catalog.variations.length)})`,
  );

  console.log("- category names:");
  for (const category of catalog.categories) {
    const data = nestedObject(category, "category_data");
    const name = data ? stringValue(data, "name") : undefined;
    const id = stringValue(category, "id");
    console.log(`  - ${name ?? "(unnamed)"} (id present: ${id ? "yes" : "no"})`);
  }

  console.log("- item names:");
  const itemNames = new Map<string, number>();
  for (const item of catalog.items) {
    const data = nestedObject(item, "item_data");
    const name = data ? stringValue(data, "name") ?? "(unnamed)" : "(unnamed)";
    itemNames.set(name, (itemNames.get(name) ?? 0) + 1);
    const id = stringValue(item, "id");
    const category = categoryNameForItem(data, catalog);
    console.log(
      `  - ${name} | category: ${category ?? "(uncategorized)"} | id present: ${id ? "yes" : "no"} | version: ${item.version ?? "(none)"}`,
    );
  }

  console.log("- variation names:");
  for (const variation of catalog.variations) {
    const data = nestedObject(variation, "item_variation_data");
    const name = data ? stringValue(data, "name") ?? "(unnamed)" : "(unnamed)";
    const itemId = data ? stringValue(data, "item_id") : undefined;
    const parent = itemId ? catalog.itemById.get(itemId) : undefined;
    const parentName = parent
      ? stringValue(nestedObject(parent, "item_data") ?? {}, "name")
      : undefined;
    const sku = data ? stringValue(data, "sku") : undefined;
    console.log(
      `  - ${parentName ?? "(no parent item)"} / ${name} | sku populated: ${sku ? "yes" : "no"} | id present: ${stringValue(variation, "id") ? "yes" : "no"} | version: ${variation.version ?? "(none)"}`,
    );
  }

  const duplicateNames = [...itemNames.entries()].filter(([, count]) => count > 1);
  console.log(`- duplicate item names: ${duplicateNames.length}`);
  for (const [name, count] of duplicateNames) {
    console.log(`  - ${name}: ${count}`);
  }

  printFieldStructure("catalog item field structure", catalog.items);
  printFieldStructure("catalog variation field structure", catalog.variations);
  printFieldStructure("catalog category field structure", catalog.categories);
}

function printLinkage(
  orders: Record<string, unknown>[],
  payments: Record<string, unknown>[],
  refunds: Record<string, unknown>[],
  catalog: CatalogMaps,
): void {
  console.log("");
  console.log("Linkage analysis:");
  console.log("- observed Square ID fields:");
  console.log("  - order.id");
  console.log("  - order.location_id");
  console.log("  - order.customer_id");
  console.log("  - order.line_items[].catalog_object_id (typically a variation id)");
  console.log("  - order.line_items[].catalog_version");
  console.log("  - payment.id");
  console.log("  - payment.order_id");
  console.log("  - payment.customer_id");
  console.log("  - payment.location_id");
  console.log("  - refund.id");
  console.log("  - refund.payment_id");
  console.log("  - refund.order_id");
  console.log("  - catalog object.id (ITEM, ITEM_VARIATION, CATEGORY)");
  console.log("  - catalog item_variation_data.item_id");
  console.log("  - catalog item_data.category_id and/or item_data.categories[].id");

  const ordersById = new Map<string, Record<string, unknown>>();
  for (const order of orders) {
    const id = stringValue(order, "id");
    if (id) {
      ordersById.set(id, order);
    }
  }

  const paymentsById = new Map<string, Record<string, unknown>>();
  for (const payment of payments) {
    const id = stringValue(payment, "id");
    if (id) {
      paymentsById.set(id, payment);
    }
  }

  const paymentsWithOrder = payments.filter((payment) =>
    stringValue(payment, "order_id"),
  );
  const paymentsOrderFound = paymentsWithOrder.filter((payment) =>
    ordersById.has(stringValue(payment, "order_id") ?? ""),
  ).length;
  const ordersWithPayment = orders.filter((order) => {
    const id = stringValue(order, "id");
    return (
      id !== undefined &&
      payments.some((payment) => stringValue(payment, "order_id") === id)
    );
  }).length;

  console.log(
    `- payments whose order_id matches a retrieved order: ${paymentsOrderFound} / ${payments.length}`,
  );
  console.log(
    `- orders with at least one retrieved payment: ${ordersWithPayment} / ${orders.length}`,
  );

  let bothPopulated = 0;
  let matchingCustomer = 0;
  let mismatchedCustomer = 0;
  for (const payment of payments) {
    const orderId = stringValue(payment, "order_id");
    const paymentCustomer = stringValue(payment, "customer_id");
    const order = orderId ? ordersById.get(orderId) : undefined;
    const orderCustomer = order ? stringValue(order, "customer_id") : undefined;
    if (paymentCustomer && orderCustomer) {
      bothPopulated += 1;
      if (paymentCustomer === orderCustomer) {
        matchingCustomer += 1;
      } else {
        mismatchedCustomer += 1;
      }
    }
  }
  console.log(
    `- related order+payment pairs with both customer_id values: ${bothPopulated}`,
  );
  console.log(`- customer_id exact matches: ${matchingCustomer}`);
  console.log(`- customer_id mismatches: ${mismatchedCustomer}`);

  const refundsPaymentFound = refunds.filter((refund) =>
    paymentsById.has(stringValue(refund, "payment_id") ?? ""),
  ).length;
  const refundsOrderFound = refunds.filter((refund) =>
    ordersById.has(stringValue(refund, "order_id") ?? ""),
  ).length;
  console.log(
    `- refunds whose payment_id matches a retrieved payment: ${refundsPaymentFound} / ${refunds.length}`,
  );
  console.log(
    `- refunds whose order_id matches a retrieved order: ${refundsOrderFound} / ${refunds.length}`,
  );

  const lineItems = orders.flatMap((order) =>
    nestedArray(order, "line_items").filter(isPlainObject),
  );
  const catalogHits = lineItems.filter((item) => {
    const id = stringValue(item, "catalog_object_id");
    return Boolean(id && catalog.variationById.has(id));
  }).length;
  const catalogItemHits = lineItems.filter((item) => {
    const id = stringValue(item, "catalog_object_id");
    return Boolean(id && catalog.itemById.has(id));
  }).length;
  console.log(
    `- line items whose catalog_object_id matches a variation: ${catalogHits} / ${lineItems.length}`,
  );
  console.log(
    `- line items whose catalog_object_id matches an ITEM (not variation): ${catalogItemHits} / ${lineItems.length}`,
  );
}

async function printHistorical(client: SquareClient): Promise<void> {
  console.log("");
  console.log("Historical access:");
  console.log(
    "- Square SearchOrders and ListPayments accept RFC 3339 date ranges and cursor pagination.",
  );
  console.log(
    "- This audit did not download the full account history. Small older windows were tested.",
  );

  const confirmed: string[] = [];
  for (const offset of SQUARE_HISTORICAL_OFFSETS_DAYS) {
    const range = historicalRange(offset, SQUARE_HISTORICAL_WINDOW_DAYS);
    console.log(
      `- probe ${SQUARE_HISTORICAL_WINDOW_DAYS}-day window ending ${range.endAt}:`,
    );
    try {
      const orders = await client.searchOrders(range);
      console.log(`  - orders returned: ${orders.length}`);
      const created = minMaxTimestamps(
        orders.map((order) => stringValue(order, "created_at")),
      );
      if (created.min) {
        confirmed.push(created.min);
        console.log(`  - oldest order created_at in window: ${created.min}`);
      }
    } catch (error) {
      console.log(`  - orders: ${safeFailure(error)}`);
    }

    try {
      const payments = await client.listPayments(range);
      console.log(`  - payments returned: ${payments.length}`);
      const created = minMaxTimestamps(
        payments.map((payment) => stringValue(payment, "created_at")),
      );
      if (created.min) {
        confirmed.push(created.min);
        console.log(`  - oldest payment created_at in window: ${created.min}`);
      }
    } catch (error) {
      console.log(`  - payments: ${safeFailure(error)}`);
    }
  }

  if (confirmed.length > 0) {
    confirmed.sort();
    console.log(`- oldest date safely confirmed accessible: ${confirmed[0]}`);
  } else {
    console.log("- oldest date safely confirmed accessible: none in probe windows");
  }
}

function printDataQuality(
  orders: Record<string, unknown>[],
  payments: Record<string, unknown>[],
  refunds: Record<string, unknown>[],
  catalog: CatalogMaps,
  locations: Record<string, unknown>[],
): void {
  console.log("");
  console.log("Data quality questions:");
  const anonymousOrders = orders.length - populatedCount(orders, "customer_id");
  const anonymousPayments =
    payments.length - populatedCount(payments, "customer_id");
  console.log(
    `- anonymous orders (no customer_id): ${anonymousOrders} / ${orders.length}`,
  );
  console.log(
    `- anonymous payments (no customer_id): ${anonymousPayments} / ${payments.length}`,
  );

  const lineItems = orders.flatMap((order) =>
    nestedArray(order, "line_items").filter(isPlainObject),
  );
  const missingCatalog = lineItems.length - populatedCount(lineItems, "catalog_object_id");
  console.log(
    `- line items missing catalog_object_id (possible manual/custom entry): ${missingCatalog} / ${lineItems.length}`,
  );

  const uncategorizedItems = catalog.items.filter((item) => {
    const data = nestedObject(item, "item_data");
    return !categoryNameForItem(data, catalog);
  }).length;
  console.log(`- catalog items without a category: ${uncategorizedItems}`);

  const variationsWithoutSku = catalog.variations.filter((variation) => {
    const data = nestedObject(variation, "item_variation_data");
    return !data || !stringValue(data, "sku");
  }).length;
  console.log(
    `- catalog variations without SKU: ${variationsWithoutSku} / ${catalog.variations.length}`,
  );

  const orderIds = new Set(
    orders
      .map((order) => stringValue(order, "id"))
      .filter((value): value is string => Boolean(value)),
  );
  const paymentsWithoutOrder = payments.filter(
    (payment) => !stringValue(payment, "order_id"),
  ).length;
  const paymentsOrderMissing = payments.filter((payment) => {
    const orderId = stringValue(payment, "order_id");
    return Boolean(orderId && !orderIds.has(orderId));
  }).length;
  const ordersWithoutPayment = orders.filter((order) => {
    const id = stringValue(order, "id");
    return (
      id !== undefined &&
      !payments.some((payment) => stringValue(payment, "order_id") === id)
    );
  }).length;
  console.log(`- payments without order_id: ${paymentsWithoutOrder}`);
  console.log(
    `- payments whose order_id was not in the 30-day order set: ${paymentsOrderMissing}`,
  );
  console.log(`- 30-day orders without a 30-day payment: ${ordersWithoutPayment}`);

  const refundsWithoutPayment = refunds.filter(
    (refund) => !stringValue(refund, "payment_id"),
  ).length;
  const refundsWithoutOrder = refunds.filter(
    (refund) => !stringValue(refund, "order_id"),
  ).length;
  console.log(`- refunds without payment_id: ${refundsWithoutPayment}`);
  console.log(`- refunds without order_id: ${refundsWithoutOrder}`);
  console.log(`- accessible locations: ${locations.length}`);
}

function printFutureActions(): void {
  console.log("");
  console.log("Possible future Square actions (not implemented):");
  console.log("READ capabilities audited now:");
  console.log("  - Locations, Orders Search, Payments, Refunds");
  console.log("  - Catalog list (items, variations, categories)");
  console.log("  - Customers search (structure/linkage only)");
  console.log("  - Customer groups, segments, custom attribute definitions");
  console.log("WRITE capabilities Square supports that may matter later:");
  console.log("  - Catalog create/update/delete for farm-store items and categories");
  console.log("  - Inventory counts and adjustments");
  console.log("  - Payment refunds (RefundPayment)");
  console.log("  - Order updates (fulfillment, discounts, state changes)");
  console.log("  - Customer create/update, including reference_id and group membership");
  console.log("  - Webhooks for payments, orders, refunds, and catalog (not created now)");
  console.log("These remain investigation-only. This integration does not write to Square.");
}

function indexCatalog(objects: Record<string, unknown>[]): CatalogMaps {
  const items: Record<string, unknown>[] = [];
  const variations: Record<string, unknown>[] = [];
  const categories: Record<string, unknown>[] = [];
  const itemById = new Map<string, Record<string, unknown>>();
  const variationById = new Map<string, Record<string, unknown>>();
  const categoryById = new Map<string, Record<string, unknown>>();

  for (const object of objects) {
    const type = stringValue(object, "type");
    const id = stringValue(object, "id");
    if (type === "ITEM") {
      items.push(object);
      if (id) {
        itemById.set(id, object);
      }
    } else if (type === "ITEM_VARIATION") {
      variations.push(object);
      if (id) {
        variationById.set(id, object);
      }
    } else if (type === "CATEGORY") {
      categories.push(object);
      if (id) {
        categoryById.set(id, object);
      }
    }
  }

  return {
    items,
    variations,
    categories,
    itemById,
    variationById,
    categoryById,
  };
}

function categoryNameForItem(
  itemData: Record<string, unknown> | undefined,
  catalog: CatalogMaps,
): string | undefined {
  if (!itemData) {
    return undefined;
  }

  const categoryIds = new Set<string>();
  const legacy = stringValue(itemData, "category_id");
  if (legacy) {
    categoryIds.add(legacy);
  }

  for (const entry of nestedArray(itemData, "categories").filter(isPlainObject)) {
    const id = stringValue(entry, "id");
    if (id) {
      categoryIds.add(id);
    }
  }

  const reporting = nestedObject(itemData, "reporting_category");
  const reportingId = reporting ? stringValue(reporting, "id") : undefined;
  if (reportingId) {
    categoryIds.add(reportingId);
  }

  const names = [...categoryIds]
    .map((id) => {
      const category = catalog.categoryById.get(id);
      const data = category ? nestedObject(category, "category_data") : undefined;
      return data ? stringValue(data, "name") : undefined;
    })
    .filter((name): name is string => Boolean(name));

  return names.length > 0 ? names.join(" | ") : undefined;
}

function bumpSale(
  map: Map<
    string,
    { label: string; count: number; quantity: number; gross: number; currency: string }
  >,
  key: string,
  label: string,
  quantity: number,
  gross: number,
  currency: string,
): void {
  const existing = map.get(key) ?? {
    label,
    count: 0,
    quantity: 0,
    gross: 0,
    currency,
  };
  existing.count += 1;
  existing.quantity += quantity;
  existing.gross += gross;
  existing.currency = currency;
  map.set(key, existing);
}

function printSaleRows(
  map: Map<
    string,
    { label: string; count: number; quantity: number; gross: number; currency: string }
  >,
  limit: number,
): void {
  const rows = [...map.values()].sort(
    (a, b) => b.gross - a.gross || b.count - a.count || a.label.localeCompare(b.label),
  );
  for (const row of rows.slice(0, limit)) {
    console.log(
      `  - ${row.label}: ${row.count} line(s), qty ${row.quantity}, ${formatMoney(row.gross, row.currency)}`,
    );
  }
  if (rows.length > limit) {
    console.log(`  - … ${rows.length - limit} more not listed`);
  }
}

function printCollapsedTenderMix(
  sourceTypes: Array<{ label: string; count: number; percent: number }>,
): void {
  const buckets = { Card: 0, Cash: 0, Other: 0 };
  let total = 0;
  for (const entry of sourceTypes) {
    total += entry.count;
    const label = entry.label.toUpperCase();
    if (label === "CARD") {
      buckets.Card += entry.count;
    } else if (label === "CASH") {
      buckets.Cash += entry.count;
    } else {
      buckets.Other += entry.count;
    }
  }

  console.log("- aggregate tender/payment-method types:");
  for (const [label, count] of Object.entries(buckets)) {
    console.log(`  ${label}: ${percent(count, total)} (${count})`);
  }
}

function printDistribution(
  label: string,
  rows: Array<{ label: string; count: number; percent: number }>,
): void {
  console.log(`- ${label} distribution:`);
  if (rows.length === 0) {
    console.log("  (none)");
    return;
  }
  for (const row of rows) {
    console.log(`  - ${row.label}: ${row.count} (${row.percent}%)`);
  }
}

function printFieldStructure(title: string, records: unknown[]): void {
  const fields = auditRecords(records);
  console.log(`- ${title}:`);
  printFields(fields);
}

function printFields(fields: FieldAudit[]): void {
  if (fields.length === 0) {
    console.log("  (none)");
    return;
  }

  for (const field of fields) {
    console.log(
      `  - ${field.path}: ${field.types.join(" | ")}, populated ${field.populated}/${field.present} (${field.populatedPercent}%)`,
    );
  }
}

function sumMoney(
  records: Record<string, unknown>[],
  key: string,
): { amount?: number; currency: string } {
  let amount = 0;
  let seen = false;
  let currency = "USD";
  for (const record of records) {
    const money = record[key];
    const value = moneyAmount(money);
    if (value !== undefined) {
      amount += value;
      seen = true;
      currency = moneyCurrency(money) ?? currency;
    }
  }
  return { amount: seen ? amount : undefined, currency };
}

function sumNestedMoney(
  records: Record<string, unknown>[],
  key: string,
): { amount?: number; currency: string } {
  return sumMoney(records, key);
}

function safeName(record: Record<string, unknown>): string {
  return stringValue(record, "name") ?? "(unnamed)";
}

function idCharset(value: string): string {
  if (/^[A-Z0-9]+$/.test(value)) {
    return "A-Z0-9";
  }
  if (/^[A-Za-z0-9:_-]+$/.test(value)) {
    return "alphanumeric/punctuation";
  }
  return "mixed";
}

function forgetCustomerValues(customers: Record<string, unknown>[]): void {
  for (const customer of customers) {
    for (const key of Object.keys(customer)) {
      if (
        key === "given_name" ||
        key === "family_name" ||
        key === "email_address" ||
        key === "phone_number" ||
        key === "address" ||
        key === "note"
      ) {
        customer[key] = undefined;
      }
    }
  }
}

function safeFailure(error: unknown): string {
  if (error instanceof SquareApiError) {
    return error.message;
  }

  return "request failed";
}

void main().catch((error: unknown) => {
  console.error(safeFailure(error));
  process.exitCode = 1;
});
