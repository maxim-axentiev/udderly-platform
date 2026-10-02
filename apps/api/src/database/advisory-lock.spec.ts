import assert from "node:assert/strict";
import test from "node:test";
import { withPostgresAdvisoryLock } from "./advisory-lock";

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
