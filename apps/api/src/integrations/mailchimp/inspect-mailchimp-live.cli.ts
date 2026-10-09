import postgres from "postgres";
import { loadEnvFiles } from "../../config/load-env";
import {
  assertLiveLocalComposeIdentity,
  loadApprovedMailchimpDatabaseUrl,
} from "./inspect-mailchimp-db-target";
import {
  addCalendarDays,
  lastCompletedDate,
  mailchimpDatesInclusive,
} from "./mailchimp.range";
import { MAILCHIMP_REPORTING_TIME_ZONE } from "./mailchimp.constants";

async function main(): Promise<void> {
  loadEnvFiles();
  const target = await loadApprovedMailchimpDatabaseUrl();
  const identity = await assertLiveLocalComposeIdentity(target.databaseUrl);
  const key = process.env.MAILCHIMP_API_KEY ?? "";
  const wherewolf = process.env.WHEREWOLF_API_KEY ?? "";
  const dash = key.lastIndexOf("-");
  const dc = dash >= 0 ? key.slice(dash + 1) : "";
  const dcOk = /^[a-z]{1,4}\d{1,3}$/i.test(dc);
  console.log(
    `config host=${target.host} port=${target.port} database=${target.database}`,
  );
  console.log(
    `live db=${identity.db} server=${identity.serverAddr} port=${identity.serverPort} data_directory=${identity.dataDirectory}`,
  );
  console.log(
    `mailchimp_key_present=${Boolean(key)} dc_readable=${dcOk} key_length=${key.length} distinct_from_wherewolf=${Boolean(key) && Boolean(wherewolf) && key !== wherewolf}`,
  );

  const to = lastCompletedDate(MAILCHIMP_REPORTING_TIME_ZONE);
  const from = addCalendarDays(to, -6);
  console.log(`planned_window ${from}..${to} timezone=${MAILCHIMP_REPORTING_TIME_ZONE} days=${mailchimpDatesInclusive(from, to).length}`);

  const sql = postgres(target.databaseUrl, { max: 1, onnotice: () => undefined });
  try {
    const mig = await sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`;
    const tables = await sql`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename LIKE 'mailchimp%'
      ORDER BY 1
    `;
    console.log(`drizzle_migrations=${mig[0]?.n} mailchimp_tables=${tables.length}`);

    const warehouse = await sql`
      SELECT
        (SELECT count(*) FROM analytics_daily_total)::int AS ga_daily,
        (SELECT count(*) FROM search_console_query)::int AS gsc_query,
        (SELECT count(*) FROM search_console_country)::int AS gsc_country,
        (SELECT count(*) FROM search_console_page)::int AS gsc_page,
        (SELECT count(*) FROM search_console_device)::int AS gsc_device,
        (SELECT count(*) FROM search_console_search_appearance)::int AS gsc_appearance,
        (SELECT count(*) FROM search_console_daily_total)::int AS gsc_daily,
        (SELECT count(*) FROM meta_ads_account)::int AS meta_account,
        (SELECT count(*) FROM meta_ads_campaign_daily)::int AS meta_campaign_daily,
        (SELECT count(*) FROM booking)::int AS booking,
        (SELECT count(*) FROM visit)::int AS visit,
        (SELECT count(*) FROM integration_events)::int AS events,
        (SELECT count(*) FROM integration_events WHERE provider = 'fareharbor')::int AS fareharbor_events,
        (SELECT count(*) FROM integration_events WHERE provider = 'wherewolf')::int AS wherewolf_events,
        (SELECT count(*) FROM source_snapshot WHERE provider = 'google_analytics')::int AS ga_snapshots,
        (SELECT count(*) FROM source_snapshot WHERE provider = 'google_search_console')::int AS gsc_snapshots,
        (SELECT count(*) FROM source_snapshot WHERE provider = 'meta_ads')::int AS meta_snapshots,
        (SELECT count(*) FROM source_snapshot WHERE provider = 'mailchimp')::int AS mailchimp_snapshots,
        (SELECT count(*) FROM source_identity WHERE provider = 'mailchimp')::int AS mailchimp_identities
    `;
    console.log(`warehouse ${JSON.stringify(warehouse[0])}`);

    const facts = await sql`
      SELECT
        (SELECT count(*) FROM mailchimp_account)::int AS account,
        (SELECT count(*) FROM mailchimp_audience)::int AS audience,
        (SELECT count(*) FROM mailchimp_audience_monthly)::int AS monthly,
        (SELECT count(*) FROM mailchimp_audience_daily)::int AS daily,
        (SELECT count(*) FROM mailchimp_campaign)::int AS campaign,
        (SELECT count(*) FROM mailchimp_campaign_report)::int AS report,
        (SELECT count(*) FROM mailchimp_campaign_link)::int AS link
    `;
    console.log(`mailchimp_facts ${JSON.stringify(facts[0])}`);

    const days = await sql`
      SELECT metric_date::text AS day, count(*)::int AS lists
      FROM mailchimp_audience_daily
      GROUP BY 1
      ORDER BY 1
    `;
    console.log(`daily_coverage ${JSON.stringify(days)}`);

    const months = await sql`
      SELECT year_month, count(*)::int AS lists
      FROM mailchimp_audience_monthly
      GROUP BY 1
      ORDER BY 1
    `;
    console.log(`monthly_coverage ${JSON.stringify(months)}`);

    const completeness = await sql`
      SELECT
        (SELECT count(*) FROM mailchimp_campaign)::int AS campaigns,
        (SELECT count(*) FROM mailchimp_campaign_report)::int AS reports,
        (SELECT count(*) FROM mailchimp_campaign c
          LEFT JOIN mailchimp_campaign_report r
            ON r.campaign_external_id = c.campaign_external_id
          WHERE r.id IS NULL)::int AS campaigns_without_report,
        (SELECT count(*) FROM mailchimp_campaign_report r
          WHERE r.unique_clicks > 0
            AND NOT EXISTS (
              SELECT 1 FROM mailchimp_campaign_link l
              WHERE l.campaign_external_id = r.campaign_external_id
            ))::int AS reports_with_clicks_missing_links
    `;
    console.log(`campaign_report_completeness ${JSON.stringify(completeness[0])}`);

    const snapshots = await sql`
      SELECT entity_type, count(*)::int AS n
      FROM source_snapshot
      WHERE provider = 'mailchimp'
      GROUP BY 1
      ORDER BY 1
    `;
    console.log(`mailchimp_snapshots_by_type ${JSON.stringify(snapshots)}`);

    const banned = await sql`
      SELECT entity_type, count(*)::int AS n
      FROM source_snapshot
      WHERE provider = 'mailchimp'
        AND (
          payload::text ILIKE '%email_address%'
          OR payload::text ILIKE '%"members"%'
          OR payload::text ILIKE '%share_password%'
          OR payload::text ILIKE '%merge_fields%'
        )
      GROUP BY 1
    `;
    console.log(`banned_payload_hits ${JSON.stringify(banned)}`);

    const timezone = await sql`
      SELECT timezone_name, count(*)::int AS n
      FROM mailchimp_account
      GROUP BY 1
    `;
    console.log(`account_timezone ${JSON.stringify(timezone)}`);

    const grains = await sql`
      SELECT
        (SELECT count(DISTINCT account_external_id) FROM mailchimp_account)::int AS account_ids,
        (SELECT count(DISTINCT list_external_id) FROM mailchimp_audience)::int AS audience_ids,
        (SELECT count(*) FROM (
          SELECT DISTINCT list_external_id, year_month FROM mailchimp_audience_monthly
        ) m)::int AS monthly_grains,
        (SELECT count(*) FROM (
          SELECT DISTINCT list_external_id, metric_date FROM mailchimp_audience_daily
        ) d)::int AS daily_grains,
        (SELECT count(DISTINCT campaign_external_id) FROM mailchimp_campaign)::int AS campaign_ids,
        (SELECT count(DISTINCT campaign_external_id) FROM mailchimp_campaign_report)::int AS report_ids,
        (SELECT count(*) FROM (
          SELECT DISTINCT campaign_external_id, link_external_id FROM mailchimp_campaign_link
        ) l)::int AS link_grains,
        (SELECT count(DISTINCT payload_hash) FROM source_snapshot WHERE provider = 'mailchimp')::int AS distinct_snapshot_hashes,
        (SELECT count(*) FROM source_snapshot WHERE provider = 'mailchimp')::int AS snapshots,
        (SELECT count(*) FROM source_identity WHERE provider = 'mailchimp')::int AS identities
    `;
    console.log(`mailchimp_grains ${JSON.stringify(grains[0])}`);
  } finally {
    await sql.end({ timeout: 2 });
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
