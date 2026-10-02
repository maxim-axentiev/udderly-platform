type ReservedSql = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<
    Array<{ locked?: boolean | string | number | null }>
  >;
  release(): void;
};

export type PostgresLockClient = {
  reserve(): Promise<ReservedSql>;
};

export async function withPostgresAdvisoryLock<T>(
  client: PostgresLockClient,
  lockName: string,
  run: () => Promise<T>,
): Promise<T> {
  const reserved = await client.reserve();
  try {
    const rows = await reserved`select pg_try_advisory_lock(hashtextextended(${lockName}, 0)) as locked`;
    const locked = rows[0]?.locked;
    if (locked !== true && locked !== "t" && locked !== "true" && locked !== 1) {
      throw new Error("advisory_lock_busy");
    }
    try {
      return await run();
    } finally {
      await reserved`select pg_advisory_unlock(hashtextextended(${lockName}, 0))`;
    }
  } finally {
    reserved.release();
  }
}
