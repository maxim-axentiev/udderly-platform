import postgres from "postgres";
import {
  assertLiveLocalComposeIdentity,
  loadApprovedMailchimpDatabaseUrl,
} from "./inspect-mailchimp-db-target";

async function main(): Promise<void> {
  const target = await loadApprovedMailchimpDatabaseUrl();
  console.log(
    `config host=${target.host} port=${target.port} database=${target.database}`,
  );
  const identity = await assertLiveLocalComposeIdentity(target.databaseUrl);
  console.log(
    `live db=${identity.db} server=${identity.serverAddr} port=${identity.serverPort} data_directory=${identity.dataDirectory}`,
  );

  const sql = postgres(target.databaseUrl, { max: 1, onnotice: () => undefined });
  try {
    const tags = await sql`
      SELECT hash, created_at
      FROM drizzle.__drizzle_migrations
      ORDER BY created_at, id
    `;
    const tables = await sql`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename LIKE 'mailchimp%'
      ORDER BY 1
    `;
    const meta = await sql`
      SELECT to_regclass('public.meta_ads_account') IS NOT NULL AS present
    `;
    console.log(`drizzle_migrations=${tags.length}`);
    for (const row of tags) {
      console.log(`migration_hash_prefix=${String(row.hash).slice(0, 12)}`);
    }
    console.log(`mailchimp_tables=${tables.length}`);
    console.log(`meta_ads_account_present=${Boolean(meta[0]?.present)}`);
  } finally {
    await sql.end({ timeout: 2 });
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
