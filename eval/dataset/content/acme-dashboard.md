# acme-dashboard

acme-dashboard is a web dashboard that the user builds and runs for a client, Acme Logistics: the dispatchers and the managers of Acme see their shipments, delivery times and costs in charts and tables, and make reports. From about day -1020 on, there is also a mobile app for the drivers (written by another agency) that uses the same API. The people: the user, Jonas (the product owner at Acme), Priya (a designer, part time), and the agency of the mobile app.

## Stack

React with Vite and TypeScript, a Node API with Express, Postgres, charts with ECharts, tests with Vitest and Playwright. Hosted on Render. Login with email and password, and later SSO for the managers.

## Timeline (days relative to today, negative is the past)

- -1095 to -1010: the first version. The shipments table, the first charts, the date picker, the settings page, user invites. The login uses a session cookie that the Express session middleware keeps in memory, then in Postgres. Near day -1020 the mobile app agency asks how their app can log in. Never write JWT or JSON web tokens in this period.
- Day -1010: the login switches to JWT; already written.
- -1010 to -640: the login uses JWT access tokens that live 30 days. Entries mention the tokens in passing: a bug with the token expiry in the mobile app, a logout that does not really log out, a token in local storage. Other work: the chart legend, table filters, the dark theme, the report builder, CSV export of tables.
- Day -640: short-lived tokens with refresh token rotation; already written.
- -640 to -300: entries mention the refresh tokens: a race when two tabs refresh at once, the mobile app losing its refresh token, a reuse alarm that logs users out by mistake. Around days -420 to -310, a deny list for logged-out tokens in Postgres, which grows. Other work: the new table (branch table-v3), new charts (branch new-charts), SSO for the managers, the onboarding flow (branch onboarding), performance of large tables.
- Day -300: the login moves back to server-side sessions; already written.
- -300 to -2: sessions are rows in Postgres: a cleanup job for old sessions, "log out of all devices", the session list on the settings page. Other work: the report builder v2, scheduled reports by email, the CSV export of large tables (slow exports, timeouts), accessibility fixes, upgrades of React and Vite, the costs page.

## Near misses to include

- The login and its tokens or sessions appear in many entries, as above, so that the three changes are not the only entries about the login.
- The CSV export appears now and then; its timeout fix on day -1 is a key entry, so before it, entries may say that large exports are slow, but not fix it by streaming.

## Branches

new-charts (about days -600 to -450), table-v3 (about days -520 to -380), onboarding (about days -400 to -330). Most sessions run in the main checkout.
