import {
  netProcessingFeeCost,
  sanitizeMoney,
  sanitizeProcessingFees,
} from "./square.commerce.money";

export function sanitizeSquareOrder(
  object: unknown,
): Record<string, unknown> | undefined {
  if (!isPlainObject(object)) {
    return undefined;
  }
  const id = stringValue(object.id);
  if (!id) {
    return undefined;
  }

  const payload: Record<string, unknown> = { id };
  copyString(payload, object, "location_id");
  copyString(payload, object, "state");
  copyString(payload, object, "created_at");
  copyString(payload, object, "updated_at");
  copyString(payload, object, "closed_at");
  copyString(payload, object, "customer_id");
  if (typeof object.version === "number") {
    payload.version = object.version;
  }

  const source = nestedObject(object.source);
  if (source) {
    const name = stringValue(source.name);
    const type = stringValue(source.type);
    if (name || type) {
      payload.source = {
        ...(name ? { name } : {}),
        ...(type ? { type } : {}),
      };
    }
  }

  copyOrderMoneyAmounts(payload, object, "net_amounts");
  copyOrderMoneyAmounts(payload, object, "return_amounts");
  copyMoney(payload, object, "total_money");
  copyMoney(payload, object, "total_tax_money");
  copyMoney(payload, object, "total_discount_money");
  copyMoney(payload, object, "total_tip_money");
  copyMoney(payload, object, "total_service_charge_money");

  const lineItems = nestedArray(object.line_items)
    .map(sanitizeLineItem)
    .filter((item): item is Record<string, unknown> => Boolean(item));
  if (lineItems.length > 0) {
    payload.line_items = lineItems;
  }

  const tenders = nestedArray(object.tenders)
    .map(sanitizeTender)
    .filter((item): item is Record<string, unknown> => Boolean(item));
  if (tenders.length > 0) {
    payload.tenders = tenders;
  }

  const returns = nestedArray(object.returns)
    .map(sanitizeReturn)
    .filter((item): item is Record<string, unknown> => Boolean(item));
  if (returns.length > 0) {
    payload.returns = returns;
  }

  return payload;
}

export function sanitizeSquarePayment(
  object: unknown,
): Record<string, unknown> | undefined {
  if (!isPlainObject(object)) {
    return undefined;
  }
  const id = stringValue(object.id);
  if (!id) {
    return undefined;
  }

  const payload: Record<string, unknown> = { id };
  copyString(payload, object, "order_id");
  copyString(payload, object, "location_id");
  copyString(payload, object, "status");
  copyString(payload, object, "created_at");
  copyString(payload, object, "updated_at");
  copyString(payload, object, "customer_id");
  copyString(payload, object, "source_type");
  copyMoney(payload, object, "amount_money");
  copyMoney(payload, object, "total_money");
  copyMoney(payload, object, "tip_money");
  copyMoney(payload, object, "refunded_money");
  copyMoney(payload, object, "approved_money");

  const fees = sanitizeProcessingFees(object.processing_fee);
  if (fees.length > 0) {
    payload.processing_fee = fees;
  }
  const feeNet = netProcessingFeeCost(fees);
  if (feeNet.status === "cost") {
    payload.processing_fee_amount = feeNet.amount;
  } else if (feeNet.status === "invalid_net_credit") {
    payload.processing_fee_invalid = "net_credit";
    payload.processing_fee_net_signed = feeNet.netSigned;
  }

  return payload;
}

export function sanitizeSquareRefund(
  object: unknown,
): Record<string, unknown> | undefined {
  if (!isPlainObject(object)) {
    return undefined;
  }
  const id = stringValue(object.id);
  if (!id) {
    return undefined;
  }
  const payload: Record<string, unknown> = { id };
  copyString(payload, object, "payment_id");
  copyString(payload, object, "order_id");
  copyString(payload, object, "location_id");
  copyString(payload, object, "status");
  copyString(payload, object, "created_at");
  copyString(payload, object, "updated_at");
  copyMoney(payload, object, "amount_money");
  return payload;
}

function sanitizeLineItem(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const payload: Record<string, unknown> = {};
  copyString(payload, value, "uid");
  copyString(payload, value, "catalog_object_id");
  if (typeof value.catalog_version === "number") {
    payload.catalog_version = value.catalog_version;
  }
  copyString(payload, value, "variation_name");
  copyString(payload, value, "name");
  copyString(payload, value, "quantity");
  copyMoney(payload, value, "base_price_money");
  copyMoney(payload, value, "gross_sales_money");
  copyMoney(payload, value, "total_discount_money");
  copyMoney(payload, value, "total_tax_money");
  copyMoney(payload, value, "total_money");
  copyMoney(payload, value, "variation_total_price_money");

  const modifiers = nestedArray(value.modifiers)
    .map(sanitizeModifier)
    .filter((item): item is Record<string, unknown> => Boolean(item));
  if (modifiers.length > 0) {
    payload.modifiers = modifiers;
  }

  return Object.keys(payload).length > 0 ? payload : undefined;
}

function sanitizeModifier(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const payload: Record<string, unknown> = {};
  copyString(payload, value, "uid");
  copyString(payload, value, "name");
  copyString(payload, value, "catalog_object_id");
  copyString(payload, value, "quantity");
  copyMoney(payload, value, "base_price_money");
  copyMoney(payload, value, "total_price_money");
  return Object.keys(payload).length > 0 ? payload : undefined;
}

function sanitizeReturn(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const payload: Record<string, unknown> = {};
  copyString(payload, value, "uid");
  copyString(payload, value, "source_order_id");
  copyOrderMoneyAmounts(payload, value, "return_amounts");
  payload.return_line_item_count = nestedArray(value.return_line_items).length;
  payload.return_discount_count = nestedArray(value.return_discounts).length;
  payload.return_tax_count = nestedArray(value.return_taxes).length;
  payload.return_service_charge_count = nestedArray(
    value.return_service_charges,
  ).length;
  payload.return_tip_count = nestedArray(value.return_tips).length;
  return payload;
}

function copyOrderMoneyAmounts(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  key: string,
): void {
  const money = nestedObject(source[key]);
  if (!money) {
    return;
  }
  const amounts: Record<string, unknown> = {};
  copyMoney(amounts, money, "total_money");
  copyMoney(amounts, money, "tax_money");
  copyMoney(amounts, money, "discount_money");
  copyMoney(amounts, money, "tip_money");
  copyMoney(amounts, money, "service_charge_money");
  if (Object.keys(amounts).length > 0) {
    target[key] = amounts;
  }
}

function sanitizeTender(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const payload: Record<string, unknown> = {};
  copyString(payload, value, "id");
  copyString(payload, value, "type");
  copyString(payload, value, "payment_id");
  return Object.keys(payload).length > 0 ? payload : undefined;
}

function copyString(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  key: string,
): void {
  const value = stringValue(source[key]);
  if (value) {
    target[key] = value;
  }
}

function copyMoney(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  key: string,
): void {
  const money = sanitizeMoney(source[key]);
  if (money) {
    target[key] = money;
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function nestedObject(value: unknown): Record<string, unknown> | undefined {
  return isPlainObject(value) ? value : undefined;
}

function nestedArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
