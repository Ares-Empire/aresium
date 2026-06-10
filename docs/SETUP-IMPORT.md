# Importing your data (VR Bank + PayPal)

No third-party APIs, no business account, no consent expiry. You export a file
from each service and drop it into the `imports/` folder, then run one command.

```bash
npm run import
```

The importer reads every `.xml` (CAMT) and `.csv` (VR Bank or PayPal — auto-detected)
file in `imports/`, loads them into the database, and categorises them. It's
**idempotent** — re-importing an overlapping date range never creates duplicates.

> ⚠️ **Use the website in a browser, not the mobile apps.** Neither the VR Banking
> app nor the PayPal app exposes a transaction export — only the desktop/web
> versions do. That's the usual reason export "isn't there".

---

## VR Bank → CSV (recommended) or CAMT

Verified steps (VR OnlineBanking web):

1. Log in at your VR Bank website (e.g. `www.vbXY.de`) → **Zum Login** → VR-NetKey + PIN.
2. Go to **Banking & Verträge → Start**, click your account, then **Umsätze**.
3. Click the **Export** icon (the ↧ download icon above the list, or the **⋮** menu).
4. Pick a format:
   - **CSV** — always available. Use this.
   - **CAMT** (camt.052/053) — only shown if your bank activated it for the account.
     If you see it, it's slightly richer; the importer takes it too.
   - **MT940** — also offered, but the importer doesn't read it yet (tell me if
     that's all you have and I'll add it).
5. Set the **Zeitraum** (date range) and click **Exportieren**.

> 🔑 **The 90-day TAN rule:** a range **up to 90 days needs no TAN**. Asking for
> older than 90 days requires entering a TAN. For your first run, just grab the
> last 90 days (or do several ≤90-day exports if you want more history).

Save the file into `imports/`.

## PayPal → CSV

Verified steps (PayPal web, your normal personal account — no business account):

1. Log in at **paypal.com**.
2. Go to **Aktivitäten** (Activity): `paypal.com/myaccount/activities`.
3. Click the **download icon** (↧) near the top right of the activity list.
4. Choose **Benutzerdefiniert** (Custom).
5. Set the date range (up to 12 months per report; history goes back ~7 years).
6. Select **CSV** as the format and generate the report.
7. Click **Herunterladen** (Download) when it's ready (usually instant; large
   reports can take a few minutes and arrive by email).

Save the `.csv` into `imports/`.

---

## Then

```bash
npm run import        # load + categorise everything in imports/
npm run db:studio     # browse the result
```

## If a file doesn't parse

VR Bank CSV columns and PayPal locales vary. If the importer can't find the
amount/id column it **stops and prints the headers it found** — send me that line
and I'll add the mapping in a minute.

## Useful commands

- `npm run import` — import everything in `imports/`
- `npm run reset:data` — wipe imported transactions/accounts (keeps categories), to start over
- `npm run db:studio` — visual database browser

## Typical routine

- **First time:** export the last 90 days from each (no TAN), import, look around.
- **Ongoing:** every week/month, export the recent range and re-run `npm run import`.
