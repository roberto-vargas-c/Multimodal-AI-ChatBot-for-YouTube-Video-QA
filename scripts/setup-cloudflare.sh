#!/usr/bin/env bash
# One command from an empty Cloudflare account to the live jury: the Vectorize index with its metadata indexes, the D1 database
# with its tables, the Worker, and its secrets. Safe to run again: whatever exists is kept.
# Needs CLOUDFLARE_API_TOKEN (Workers Scripts, D1, Vectorize and Workers AI: Edit) and CLOUDFLARE_ACCOUNT_ID in the environment,
# and for the secrets ANTHROPIC_API_KEY, INGEST_TOKEN and optionally LANGSMITH_API_KEY, KEYSTONE_BOT_TOKEN, OWNER_TOKEN.
set -euo pipefail
cd "$(dirname "$0")/.."
NAME=keystone-jury
W="npx --yes wrangler"

# two indexes: the public one, and an owner-only one for copyrighted books (only searched with OWNER_TOKEN or INGEST_TOKEN)
for IDX in "$NAME" "$NAME-private"; do
  if ! $W vectorize get "$IDX" >/dev/null 2>&1; then
    echo "Creating the Vectorize index $IDX (bge-m3: 1024 dimensions, cosine)"
    $W vectorize create "$IDX" --dimensions=1024 --metric=cosine
  fi
  # the filters the tools use: by author (the jury), kind, source, building type and country
  for p in author kind sourceId typology country; do
    $W vectorize create-metadata-index "$IDX" --property-name="$p" --type=string >/dev/null 2>&1 || true
  done
done

id() { $W d1 list --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const x=JSON.parse(s).find(d=>d.name===process.argv[1]);console.log(x?x.uuid:"")}catch{console.log("")}})' "$NAME"; }
DB=$(id)
if [ -z "$DB" ]; then echo "Creating the D1 database"; $W d1 create "$NAME" >/dev/null; DB=$(id); fi
[ -n "$DB" ] || { echo "Could not find the D1 database id"; exit 1; }
sed -i.bak "s/\"database_id\": \"[^\"]*\"/\"database_id\": \"$DB\"/" wrangler.jsonc && rm -f wrangler.jsonc.bak
$W d1 migrations apply "$NAME" --remote

$W deploy

# the secrets that are set in this environment, all in one call
node -e '
const keys = ["ANTHROPIC_API_KEY", "LANGSMITH_API_KEY", "INGEST_TOKEN", "OWNER_TOKEN", "KEYSTONE_BOT_TOKEN"];
const o = Object.fromEntries(keys.filter(k => process.env[k]).map(k => [k, process.env[k]]));
process.stdout.write(JSON.stringify(o));' > .secrets.json
if [ "$(cat .secrets.json)" != "{}" ]; then $W secret bulk .secrets.json; fi
rm -f .secrets.json
echo "Done: https://$NAME.<your-subdomain>.workers.dev"
