# billing-api

billing-api is the subscription billing service of nebula (a hosted event search product of the same company). It knows the plans, meters the usage of each customer, makes the invoices, takes payments through Stripe, and sends the receipts and reminders. The people: the user, Mara (backend), and Ines from finance, who checks the invoices each month and talks to the accountants.

## Stack

Node and TypeScript with Fastify, Postgres, the Stripe SDK, a job runner on Postgres (pg-boss), invoice PDFs rendered with a headless browser, emails through an email provider.

## Timeline (days relative to today, negative is the past)

- -900 to -700: the first version. The plan catalog, the price table, the usage meter that reads counts from nebula, the first invoices, Stripe customers and subscriptions, the trial logic. Stripe SDK v13.
- -700 to -520: tax rules for the EU (VAT, reverse charge), coupon codes, the dunning emails for failed payments, payment retries. Stripe webhooks with signature checks. The emails go through the old email provider, and some customers say that the receipts are in their spam folder.
- About 16 months ago (about days -510 to -480): one busy month with three key entries (the move to Postmark, SEPA direct debit, the rounding of totals); already written. The filler of this month is about smaller things: the invoice numbers, the tests, a slow query, a customer question. It may name the problems that led to the key entries (spam complaints, EU customers asking for direct debit, Ines finding totals that are 1 cent off), but not the solutions.
- -480 to -11: Postmark is the email provider now; SEPA debits and mandates are normal topics. The invoice PDF renderer gets slow for invoices with many lines. The invoices table grows large, and from about day -60 on, entries plan to partition it. Stripe SDK upgrades to v14, v15 and v16 (the upgrade to v17 is a key entry on day -3). The webhook handler and its retries. Refunds through the API (idempotency for refunds is a key entry on day -1, so before it, no idempotency keys on refunds). The new invoice PDF renderer is planned from about day -40 on, behind a flag, but its rollout plan is a key entry.
- There is no filler in the last 10 days.

## Near misses to include

- Emails, payments and invoice totals appear often, also outside the busy month.
- The Stripe SDK appears often: upgrades, error handling, pagination shims (the shims are removed on day -3).

## Branches

None. Every session runs in the main checkout.
