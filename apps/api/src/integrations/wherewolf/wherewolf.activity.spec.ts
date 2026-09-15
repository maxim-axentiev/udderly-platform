import assert from "node:assert/strict";
import test from "node:test";
import {
  extractWherewolfActivities,
  firstActivity,
} from "./wherewolf.activity";

test("A. activitiesAsObjects only yields id and name", () => {
  const activities = extractWherewolfActivities({
    activitiesAsObjects: [{ id: "532251", name: "Farm Glamping" }],
  });
  assert.deepEqual(activities, [{ id: "532251", name: "Farm Glamping" }]);
});

test("B. activities string array only yields ids without guessing names", () => {
  const activities = extractWherewolfActivities({
    activities: ["532251"],
  });
  assert.deepEqual(activities, [{ id: "532251" }]);
  assert.equal(firstActivity({ activities: ["532251"] })?.id, "532251");
  assert.equal(firstActivity({ activities: ["532251"] })?.name, undefined);
});

test("C. both present keep one id and the object name", () => {
  const activities = extractWherewolfActivities({
    activities: ["532251"],
    activitiesAsObjects: [{ id: 532251, name: "Farm Glamping" }],
  });
  assert.deepEqual(activities, [{ id: "532251", name: "Farm Glamping" }]);
});

test("D. empty or missing activities yield none", () => {
  assert.deepEqual(extractWherewolfActivities({}), []);
  assert.deepEqual(extractWherewolfActivities({ activities: [] }), []);
  assert.deepEqual(extractWherewolfActivities({ activitiesAsObjects: [] }), []);
  assert.equal(firstActivity({}), undefined);
});

test("G. duplicate ids across both fields collapse to one activity", () => {
  const activities = extractWherewolfActivities({
    activities: ["532251", "532251"],
    activitiesAsObjects: [
      { id: "532251", name: "Farm Glamping" },
      { id: "532251" },
    ],
  });
  assert.equal(activities.length, 1);
  assert.deepEqual(activities[0], { id: "532251", name: "Farm Glamping" });
});
