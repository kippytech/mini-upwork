// import { neonConfig, Pool } from "@neondatabase/serverless";
// import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from './schema.js';
//import ws from "ws";

// neonConfig.webSocketConstructor = ws;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not configured");
}

const pool = new Pool({
  connectionString: connectionString,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export const db = drizzle(pool, { schema });

export const closeDatabase = async (): Promise<void> => {
  await pool.end();
};
