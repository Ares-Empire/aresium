# Deploying the language update

For the lead to run after review/merge. No database migration, seed, environment change or proxy
change is needed. The server serves the static files directly; there is no frontend bundle.
Keep the existing `.env`, database and import files.

## Current deployment

The 2026-10-24 build inventory (`S-aresus-server.md`, “today's server”) identifies the dashboard as
`aresium.service`, deployed at `/root/aresium`, with Postgres in `aresium-db-1` and the website at
`https://aresium.de/`. The checked-in bot/reminder units also use `/root/aresium`; the dashboard unit
is managed on the server and is not in this repo. `npm run web` runs `tsx src/web/server.ts`
(default `127.0.0.1:5173`, with existing `HOST`/`PORT` overrides).

## Server steps

After the lead merges the reviewed change into the deployed branch, run on the server:

```sh
cd /root/aresium
git rev-parse HEAD
systemctl cat aresium.service
git pull --ff-only
npm ci
npm test
npm run typecheck
systemctl restart aresium.service
systemctl is-active aresium.service
```

Record the first SHA for rollback. Confirm the existing unit's working directory and entry point
before restarting. Leave the bot/reminder units, Postgres, Caddy and DNS as they are.

Verify unauthenticated responses without credentials (both must return JSON 401 with matching
`Content-Language` and a short login sentence):

```sh
curl -i -H 'Accept-Language: en' https://aresium.de/api/pulse
curl -i -H 'Accept-Language: de' https://aresium.de/api/pulse
```

In an authenticated app/session, request `/api/pulse` once in each language: the same spending
appears as `€1,339 spent in October` / `1.339 € im Oktober ausgegeben` (with current values), or
the translated empty state. Compare `/api/data` bodies between languages; they must match.
Open the website with a German browser language, reload, and check that its API requests send
`Accept-Language: en` and its pages stay English. Do not upload real data just to smoke-test.

Rollback: restore the recorded preceding revision using the existing source deployment procedure,
run `npm ci`, and `systemctl restart aresium.service`. There is no database change to roll back.
