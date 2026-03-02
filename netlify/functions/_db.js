import pg from "pg";

let pool;

export function getPool(){
  if(pool) return pool;
  const connectionString = process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL || process.env.NETLIFY_DATABASE_URL_UNPOOLED;
  if(!connectionString){
    return null;
  }
  pool = new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  return pool;
}
