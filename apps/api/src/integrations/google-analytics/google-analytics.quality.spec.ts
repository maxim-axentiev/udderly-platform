import assert from "node:assert/strict";
import test from "node:test";
import { evaluateReportQuality, qualityFailure } from "./google-analytics.quality";

test("sampling fails closed", () => {
  const quality = evaluateReportQuality({
    metadata: { samplingMetadatas: [{ samplesReadCount: "1" }] },
  });
  assert.equal(quality.sampled, true);
  assert.equal(qualityFailure(quality), "google_analytics_sampled_report");
});

test("dataLossFromOtherRow fails closed", () => {
  const quality = evaluateReportQuality({
    metadata: { dataLossFromOtherRow: true },
  });
  assert.equal(qualityFailure(quality), "google_analytics_data_loss_from_other_row");
});

test("thresholding is explicit and not treated as complete", () => {
  const quality = evaluateReportQuality({
    metadata: { subjectToThresholding: true },
  });
  assert.equal(quality.subjectToThresholding, true);
  assert.equal(
    qualityFailure(quality),
    "google_analytics_provider_thresholded_data_suppressed",
  );
});

test("thresholding is reported as provider suppression, not unresolved or pagination", () => {
  const quality = evaluateReportQuality({
    metadata: { subjectToThresholding: true },
  });
  const message = qualityFailure(quality) ?? "";
  assert.ok(message.includes("thresholded"));
  assert.ok(!message.includes("unresolved"));
  assert.ok(!message.includes("pagination"));
});

test("complete reports have no quality failure", () => {
  assert.equal(qualityFailure(evaluateReportQuality({})), undefined);
});
