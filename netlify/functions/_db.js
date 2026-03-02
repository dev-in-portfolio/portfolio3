const { Client } = require("pg");

async function withClient(fn){
  const url = process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL || process.env.NETLIFY_DATABASE_URL_UNPOOLED;
  if(!url){
    return { statusCode: 503, body: JSON.stringify({ error: "DATABASE_URL not set" }) };
  }
  const client = new Client({ connectionString: url });
  try{
    await client.connect();
    return await fn(client);
  }catch(err){
    return { statusCode: 500, body: JSON.stringify({ error: "database error" }) };
  }finally{
    await client.end().catch(() => {});
  }
}

function parseBody(event){
  try{
    return event.body ? JSON.parse(event.body) : {};
  }catch{
    return {};
  }
}

function isValidSlug(slug){
  return typeof slug === "string" && /^[a-z0-9-]{2,64}$/.test(slug);
}

module.exports = { withClient, parseBody, isValidSlug };
