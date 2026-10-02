import assert from "node:assert/strict";
import test from "node:test";
import { hashCanonicalJson } from "./google-analytics.hash";
import {
  assertNoSecrets,
  reportSnapshotExternalId,
  sanitizeAdsLink,
  sanitizeAttribution,
  sanitizeCustomDimension,
  sanitizeKeyEvent,
  sanitizeProperty,
  sanitizeReportingIdentity,
  sanitizeReportSnapshot,
  sanitizeRetention,
  sanitizeStream,
} from "./google-analytics.sanitize";
import type { GaCompletedReport } from "./google-analytics.types";

const report: GaCompletedReport = {
  family: "daily_totals",
  property: "properties/310874507",
  startDate: "2023-04-01",
  endDate: "2023-04-01",
  requestCount: 1,
  rowCount: 1,
  dimensionHeaders: ["date"],
  metricHeaders: ["sessions"],
  quality: {
    sampled: false,
    dataLossFromOtherRow: false,
    subjectToThresholding: false,
  },
  propertyQuota: {
    tokensPerDay: { consumed: 1, remaining: 2, extra: "drop" },
  },
  rows: [
    {
      dimensionValues: [{ value: "20230401" }],
      metricValues: [{ value: "9" }],
      extraRowField: "drop-me",
    },
  ],
};

test("report snapshots keep allowlisted evidence and drop arbitrary fields", () => {
  const snapshot = sanitizeReportSnapshot(report);
  assert.deepEqual(Object.keys(snapshot).sort(), [
    "dimensionHeaders",
    "endDate",
    "family",
    "metricHeaders",
    "property",
    "quality",
    "quota",
    "requestCount",
    "rowCount",
    "rows",
    "startDate",
  ]);
  assert.deepEqual(snapshot.rows, [
    {
      dimensionValues: [{ value: "20230401" }],
      metricValues: [{ value: "9" }],
    },
  ]);
  assert.deepEqual(snapshot.quota, { tokensPerDay: { consumed: 1, remaining: 2 } });
  assertNoSecrets(snapshot);
});

test("OAuth material cannot enter snapshots", () => {
  assert.throws(
    () =>
      assertNoSecrets({
        family: "daily_totals",
        refresh_token: "nope",
      }),
    /snapshot_contains_secret/,
  );
  assert.throws(
    () => assertNoSecrets({ client_secret: "nope" }),
    /snapshot_contains_secret/,
  );
});

test("forbidden custom dimension definitions are marked excluded without values", () => {
  const sanitized = sanitizeCustomDimension({
    name: "properties/310874507/customDimensions/1",
    parameterName: "email_address",
    displayName: "Email",
    description: "user@example.com",
    scope: "EVENT",
  });
  assert.deepEqual(sanitized, {
    name: "properties/310874507/customDimensions/1",
    parameterName: "email_address",
    displayName: "Email",
    scope: "EVENT",
    excluded: true,
  });
  assert.equal(JSON.stringify(sanitized).includes("user@example.com"), false);
});

test("hash is deterministic for key order", () => {
  assert.equal(
    hashCanonicalJson({ b: 1, a: 2 }),
    hashCanonicalJson({ a: 2, b: 1 }),
  );
});

test("admin sanitizers drop creator email and keep interpretability fields", () => {
  const property = sanitizeProperty({
    name: "properties/310874507",
    displayName: "Udderly Ridiculous Farm Life - GA4",
    timeZone: "America/Toronto",
    currencyCode: "CAD",
    industryCategory: "PETS_AND_ANIMALS",
    creatorEmailAddress: "owner@example.com",
    serviceLevel: "GOOGLE_ANALYTICS_STANDARD",
    propertyType: "PROPERTY_TYPE_ORDINARY",
    parent: "accounts/197622407",
  });
  assert.equal(property.timeZone, "America/Toronto");
  assert.equal("creatorEmailAddress" in property, false);
  assert.throws(() => assertNoSecrets({ creatorEmailAddress: "owner@example.com" }));

  const stream = sanitizeStream({
    name: "properties/310874507/dataStreams/3445631200",
    type: "WEB_DATA_STREAM",
    displayName: "Web",
    webStreamData: {
      measurementId: "G-Z0FL7CST28",
      defaultUri: "https://udderlyridiculousfarmlife.com",
    },
    firebaseAppId: "drop",
  });
  assert.deepEqual(stream.webStreamData, {
    measurementId: "G-Z0FL7CST28",
    defaultUri: "https://udderlyridiculousfarmlife.com",
  });

  const retention = sanitizeRetention({
    eventDataRetention: "FOURTEEN_MONTHS",
    userDataRetention: "FOURTEEN_MONTHS",
    resetUserDataOnNewActivity: true,
  });
  assert.equal(retention.eventDataRetention, "FOURTEEN_MONTHS");

  const keyEvent = sanitizeKeyEvent({
    name: "properties/310874507/keyEvents/purchase",
    eventName: "purchase",
    countingMethod: "ONCE_PER_EVENT",
    createTime: "2022-04-13T00:00:00Z",
    defaultValue: { numericValue: "1", currencyCode: "CAD" },
  });
  assert.equal(keyEvent.eventName, "purchase");
  assert.deepEqual(keyEvent.defaultValue, { currencyCode: "CAD" });

  const attribution = sanitizeAttribution({
    acquisitionConversionEventLookbackWindow:
      "ACQUISITION_CONVERSION_EVENT_LOOKBACK_WINDOW_30_DAYS",
    otherConversionEventLookbackWindow:
      "OTHER_CONVERSION_EVENT_LOOKBACK_WINDOW_90_DAYS",
    reportingAttributionModel: "PAID_AND_ORGANIC_CHANNELS_DATA_DRIVEN",
    adsWebConversionDataExportScope: "PAID_AND_ORGANIC_CHANNELS",
  });
  assert.equal(
    attribution.reportingAttributionModel,
    "PAID_AND_ORGANIC_CHANNELS_DATA_DRIVEN",
  );

  const identity = sanitizeReportingIdentity({
    reportingIdentity: "BLENDED",
    extra: "drop",
  });
  assert.equal(identity.reportingIdentity, "BLENDED");

  const ads = sanitizeAdsLink({
    customerId: "6592635590",
    creatorEmailAddress: "ads@example.com",
    canManageClients: false,
  });
  assert.equal(ads.customerId, "6592635590");
  assert.equal("creatorEmailAddress" in ads, false);
});

test("Measurement Protocol secrets and author emails cannot enter snapshots", () => {
  assert.throws(() => assertNoSecrets({ api_secret: "mp-secret" }), /snapshot_contains_secret/);
  assert.throws(
    () => assertNoSecrets({ measurement_protocol: "secret" }),
    /snapshot_contains_secret/,
  );
});

test("report snapshot ids include property, family, and requested range", () => {
  assert.equal(
    reportSnapshotExternalId("310874507", "event", "2023-03-01", "2023-03-07"),
    "310874507:event:2023-03-01:2023-03-07",
  );
});
