export const SQUARE_API_BASE_URL = "https://connect.squareup.com";
export const SQUARE_API_VERSION = "2026-08-19";
export const SQUARE_REQUEST_TIMEOUT_MS = 30_000;
export const SQUARE_MAX_RETRIES = 5;
export const SQUARE_PAGE_DELAY_MS = 50;
export const SQUARE_MAX_PAGES = 500;

export const SQUARE_ORDERS_PAGE_LIMIT = 500;
export const SQUARE_PAYMENTS_PAGE_LIMIT = 100;
export const SQUARE_REFUNDS_PAGE_LIMIT = 100;
export const SQUARE_CUSTOMERS_PAGE_LIMIT = 100;

export const SQUARE_AUDIT_WINDOW_DAYS = 30;
export const SQUARE_HISTORICAL_WINDOW_DAYS = 7;
export const SQUARE_HISTORICAL_OFFSETS_DAYS = [400, 1100] as const;

export const SQUARE_PROVIDER = "square";
export const SQUARE_CATEGORY_ENTITY = "category";
export const SQUARE_ITEM_ENTITY = "item";
export const SQUARE_ITEM_VARIATION_ENTITY = "item_variation";
export const SQUARE_ORDER_ENTITY = "order";
export const SQUARE_PAYMENT_ENTITY = "payment";
export const SQUARE_REFUND_ENTITY = "refund";
export const SQUARE_ORDER_LINE_ENTITY = "order_line";
export const SQUARE_CUSTOMER_ENTITY = "customer";
export const SQUARE_CATALOG_TYPES = [
  "CATEGORY",
  "ITEM",
  "ITEM_VARIATION",
] as const;

export const INTERNAL_PRODUCT_CATEGORY = "product_category";
export const INTERNAL_PRODUCT = "product";
export const INTERNAL_PRODUCT_VARIATION = "product_variation";
export const INTERNAL_SALE = "sale";
export const INTERNAL_SALE_LINE_ITEM = "sale_line_item";
export const INTERNAL_PAYMENT = "payment";
export const INTERNAL_REFUND = "refund";

export const SQUARE_SALE_KIND_RETAIL = "retail";
export const SQUARE_METHOD_CARD = "card";
export const SQUARE_METHOD_CASH = "cash";
export const SQUARE_METHOD_EXTERNAL = "external";
export const SQUARE_METHOD_OTHER = "other";

export const SQUARE_STATUS_ACTIVE = "active";
export const SQUARE_STATUS_ARCHIVED = "archived";
export const SQUARE_STATUS_DELETED = "deleted";

export const SQUARE_SENSITIVE_NEST_KEYS = new Set([
  "address",
  "bank_account_details",
  "billing_address",
  "buy_now_pay_later_details",
  "buyer_email_address",
  "card",
  "card_details",
  "cash_app_details",
  "custom_attributes",
  "email_address",
  "external_details",
  "family_name",
  "fingerprint",
  "given_name",
  "nickname",
  "note",
  "notes",
  "phone_number",
  "reason",
  "receipt_number",
  "receipt_url",
  "shipping_address",
  "square_account_details",
  "square_gift_card_details",
  "wallet_details",
]);
