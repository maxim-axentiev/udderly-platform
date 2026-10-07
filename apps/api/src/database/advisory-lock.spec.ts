import assert from "node:assert/strict";
import test from "node:test";
import { withPostgresAdvisoryLock } from "./advisory-lock";

test("Search Console incremental uses a distinct lock name", async () => {
  const names: string[] = [];
  const reserved = Object.assign(
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      names.push(String(values[0] ?? strings.join("")));
      return [{ locked: true }];
    },
    { release() {} },
  );
  await withPostgresAdvisoryLock(
    { async reserve() { return reserved; } },
    "google-search-console-incremental",
    async () => undefined,
  );
  assert.equal(names[0], "google-search-console-incremental");
  assert.notEqual(names[0], "google-analytics-incremental");
});

test("holds a session lock for the run and unlocks afterward", async () => {
  const calls: string[] = [];
  const reserved = Object.assign(
    async (strings: TemplateStringsArray) => {
      const sql = strings.join("");
      if (sql.includes("pg_try_advisory_lock")) {
        calls.push("lock");
        return [{ locked: true }];
      }
      calls.push("unlock");
      return [{ locked: true }];
    },
    { release() { calls.push("release"); } },
  );
  const client = {
    async reserve() {
      calls.push("reserve");
      return reserved;
    },
  };
  const result = await withPostgresAdvisoryLock(client, "google-analytics-incremental", async () => {
    calls.push("run");
    return 7;
  });
  assert.equal(result, 7);
  assert.deepEqual(calls, ["reserve", "lock", "run", "unlock", "release"]);
});

test("busy lock fails without running the callback", async () => {
  let ran = false;
  const reserved = Object.assign(
    async () => [{ locked: false }],
    { release() {} },
  );
  await assert.rejects(
    () =>
      withPostgresAdvisoryLock(
        { async reserve() { return reserved; } },
        "google-analytics-incremental",
        async () => {
          ran = true;
        },
      ),
    /advisory_lock_busy/,
  );
  assert.equal(ran, false);
});

test("releases the reserved connection when the run fails", async () => {
  const calls: string[] = [];
  const reserved = Object.assign(
    async (strings: TemplateStringsArray) => {
      calls.push(strings.join("").includes("unlock") ? "unlock" : "lock");
      return [{ locked: true }];
    },
    { release() { calls.push("release"); } },
  );
  await assert.rejects(
    () =>
      withPostgresAdvisoryLock(
        { async reserve() { return reserved; } },
        "google-analytics-incremental",
        async () => {
          throw new Error("import_failed");
        },
      ),
    /import_failed/,
  );
  assert.deepEqual(calls, ["lock", "unlock", "release"]);
});
