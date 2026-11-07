# Automatic import: research (2026-11-07)

Today every payment reaches Aresium from a file exported by hand. This note collects what could make that
automatic, on any platform. **Status:** research done; which route to build waits on Patrik (the board's
"For you").

## In short

- **Bank:** automatic is possible through **FinTS**, the German banks' own interface for banking software, with no
  company in between. It needs a free product registration (2–3 weeks) and an approval in SecureGo plus now and
  then. The same TypeScript code can run on the server (Patrik) and inside the iPhone app (phone mode).
- **PayPal:** has no FinTS. The best private route reads PayPal's receipt emails. The bank's text already names the
  shop for PayPal payments paid from the bank ("Ihr Einkauf bei …"), but payments paid from PayPal balance never
  reach the bank.
- **Nothing on the iPhone reads German bank data by itself:** Apple's FinanceKit covers the US and UK only.

## Bank: FinTS (recommended)

**How it works.** Aresium logs in to the bank's FinTS address with the online-banking login (VR-NetKey and PIN) and
fetches the account report as **camt.052**, which both readers already read (`src/import/camt.ts`,
`src/engine/readers/camt.ts`). The phone's matching of the same payment across formats (same day, amount and
IBAN) keeps a fetched report from counting twice next to files imported by hand.

**Library.** [lib-fints](https://github.com/robocode13/lib-fints): TypeScript, LGPL-2.1-or-later, v1.5.3 of
2026-10-28, one dependency (fast-xml-parser). It works at the VR banks with SecureGo plus approval (TAN method 946)
when the request names a from and a to date ([issue #10](https://github.com/robocode13/lib-fints/issues/10)). It
needs only `fetch`, `Buffer` and `TextDecoder`, so the engine's JavaScriptCore can run it with `fetch` bridged to
URLSession. Alternatives: python-fints (most used), hbci4j (runs Hibiscus); HBCI4Swift is GPL and macOS only.

**VR banks (Atruvia).**
- Address `https://fints1.atruvia.de/cgi-bin/hbciservlet` or `fints2…`, depending on the bank.
- Since 2025-08-01 the only method left is SecureGo plus "Direktfreigabe" (946): the person taps approve in the
  app, nothing is typed. The bank lets the software wait up to about 5 minutes.
- Since about 2025-11-25 transactions come only as camt (MT940 was switched off).

**How often an approval is needed.**
- The last 90 days can be read without one. The bank asks again at least every 180 days (EU rule since
  2023-07-25); whether Atruvia asks every 90 or every 180 days is not verified. Older history always needs one.
- For a nightly job: when the bank asks (code 3955), Aresium sends a push ("approve in SecureGo plus") and waits.
  If nobody approves in time, the job waits as "needs approval" until the next sync started by hand.

**Product registration.**
- Banks accept only registered software since 2019. It is free.
- A PDF form goes by email to registrierung@hbci-zka.de and the number comes in about 10–15 working days
  ([fints.org](https://www.fints.org/de/hersteller/produktregistrierung)). One number covers the product ("Aresium").
- Private hobby projects report getting numbers, though the form asks for a company name.
- Keep the number out of the public repos (server secret, app build setting): if forks reused it, it could be
  blocked for every Aresium user.

**Patrik's server.** Nightly job, the PIN stored encrypted with the server's secrets, the report through the
existing import. About 3–5 days of work.

**Phone mode.**
- Phone mode runs the same module in the engine, keeps the PIN in the Keychain and syncs when the app opens. About
  1–2 more weeks of work.
- It covers banks with FinTS: Sparkassen, Volks- and Raiffeisenbanken (Sparda included), ING, DKB and comdirect.
  Others are not verified. N26, Trade Republic and Revolut have no FinTS.

**Legal.**
- Patrik's own accounts: allowed. The bank's terms only forbid keeping the PIN unprotected.
- Phone mode: BaFin's guidance on the ZAG says software that runs only on the user's own device is not an account
  information service, so no licence is needed
  ([BaFin](https://www.bafin.de/SharedDocs/Veroeffentlichungen/DE/Merkblatt/mb_111222_zag.html)). That holds only
  while no login data and no payments pass through an Aresium server, logs included.
- Bank access on the server for other people would need a BaFin registration (§34 ZAG).

**Open risk: Apple.** App Review guideline 5.1.1(ix) asks that banking and financial-services apps come from a
legal entity, not an individual developer. External TestFlight's beta review could refuse a bank login in an app
from a personal developer account. Patrik's own builds (internal TestFlight) are not reviewed.

## Bank fallback: Enable Banking

- **What it is:** a licensed account information provider in Finland. It is used by Actual Budget, Firefly III and
  Sure.
- **Cost:** a newly registered app runs in a "restricted" mode for individual non-commercial use, reading only
  accounts linked to it ([docs](https://enablebanking.com/docs/api/linked-accounts/)). Users quote its terms as
  free; the price is not stated on that page.
- **Setup:** an app key and a redirect URL on aresium.de. Consent lasts up to 180 days, set per bank; the Volksbank
  value is not verified. Many banks allow about 4 background fetches a day.
- **Against it:** a company sees the payments, and NetKey and PIN are typed on its page. It is for Patrik's own
  accounts only: other people's accounts would need a contract.
- GoCardless Bank Account Data takes no new sign-ups since July 2025. Tink, TrueLayer, Yapily, Plaid, Salt Edge and
  finAPI are for businesses.

## PayPal

1. **Receipt emails (recommended).**
   - PayPal emails every payment, money received and refund, with the name, amount, date and **transaction code**.
     The code is the id the PayPal CSV reader gives each row (`src/import/paypal-csv.ts`), so a later CSV import adds
     nothing twice.
   - The server would see only these mails: a Gmail filter that forwards PayPal's mails, or IMAP on one label.
   - Templates differ (payment, refund, subscription, pay later) and change without notice, so the AI should read
     the fields, not a fixed pattern.
   - The fields come from experience; check them against real mails first.
2. **PayPal's own API** (Transaction Search). It needs a business account. Converting is described as one-way, and
   what it changes for money sent by friends is not verified. Not recommended.
3. **MoneyMoney** for Mac (€79.99). It syncs PayPal and FinTS banks and can export by AppleScript
   (`export transactions … as "plist"`), but it has no refresh command, must stay running and unlocked, and its maker
   is short of support since 2026. It only fits if the Mac does the work.

## Small extras

- **Wallet tap.** A Shortcuts automation on an Apple Pay tap can hand amount, shop and card to an App Intent without
  opening the app. It covers taps in shops only, not online payments, and fails for some cards. The VR girocard is
  not in Apple Pay. At most a quick early entry for phone mode, matched to the bank later.
- **Folder watcher on the Mac.** An export saved to Downloads is uploaded by itself, so only the export click is
  left. A stopgap only.

## Ruled out

- **Apple FinanceKit:** US and UK only, for organisations.
- **Browser automation** of online banking or PayPal: it breaks on page changes and bot checks, puts the PIN in a
  script, and PayPal's terms forbid it.
- **iOS background refresh:** iOS decides when it runs, and the job can't wait for an approval.
- **EBICS:** for business customers.
