# ai-retry

ai-retry is an open source TypeScript library by the user for the Vercel AI SDK: when a call to a model fails (rate limit, overload, timeout, a bad response), it retries with backoff or falls back to another model. Published on npm, with some users who open issues.

## Stack

TypeScript, the AI SDK, Vitest with mocked model providers, tsdown, GitHub Actions, changesets.

## Timeline (days relative to today, negative is the past)

- -330 to -250: the first version: retries for errors that can be retried, the backoff strategy with jitter, the model fallback, the type exports, the README.
- -250 to -120: the abort handling (an abort signal stops the retries), retries of streams that fail before the first chunk, the Retry-After header, support for a new major version of the AI SDK.
- -120 to -2: issues from users: a fallback that ran for an error that should not retry, the types of the options, logging hooks, a release with a breaking change, the docs.

## Rules for the text

The library is about retries, so the word "retry" is common. Never write the words "retry wrapper": call it the retry logic, the library or the retry loop.

## Branches

None. Every session runs in the main checkout.
