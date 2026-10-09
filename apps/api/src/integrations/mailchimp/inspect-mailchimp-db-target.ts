import postgres from "postgres";
import { loadEnvFiles } from "../../config/load-env";

export type ApprovedMailchimpDbTarget = {
  host: string;
  port: string;
  database: string;
  databaseUrl: string;
};

export function parseApprovedMailchimpDatabaseUrl(
  databaseUrl: string,
): ApprovedMailchimpDbTarget {
  const parsed = new URL(databaseUrl.replace(/^postgresql:/, "http:"));
  const host = parsed.hostname;
  const port = parsed.port || "5432";
  const database = parsed.pathname.replace(/^\//, "");
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error("refusing_non_local_host");
  }
  if (port !== "5432") {
    throw new Error("refusing_unexpected_port");
  }
  if (database !== "udderly") {
    throw new Error("refusing_unexpected_database");
  }
  if (parsed.hostname === "postgres" || parsed.hostname.endsWith(".internal")) {
    throw new Error("refusing_non_approved_database_target");
  }
  return { host, port, database, databaseUrl };
}

export async function loadApprovedMailchimpDatabaseUrl(): Promise<ApprovedMailchimpDbTarget> {
  loadEnvFiles();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL missing");
  }
  return parseApprovedMailchimpDatabaseUrl(databaseUrl);
}

export async function assertLiveLocalComposeIdentity(
  databaseUrl: string,
): Promise<{
  db: string;
  serverAddr: string;
  serverPort: number;
  dataDirectory: string;
}> {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  try {
    const rows = await sql`
      SELECT current_database() AS db,
             inet_server_addr()::text AS server_addr,
             inet_server_port()::int AS server_port,
             current_setting('data_directory') AS data_directory
    `;
    const identity = rows[0] as {
      db: string;
      server_addr: string;
      server_port: number;
      data_directory: string;
    };
    if (identity.db !== "udderly") {
      throw new Error("refusing_unexpected_current_database");
    }
    if (identity.server_port !== 5432) {
      throw new Error("refusing_unexpected_server_port");
    }
    if (identity.data_directory !== "/var/lib/postgresql/data") {
      throw new Error("refusing_unexpected_data_directory");
    }
    if (!identity.server_addr.startsWith("172.")) {
      throw new Error("refusing_unexpected_postgres_server_addr");
    }
    return {
      db: identity.db,
      serverAddr: identity.server_addr,
      serverPort: identity.server_port,
      dataDirectory: identity.data_directory,
    };
  } finally {
    await sql.end({ timeout: 2 });
  }
}
