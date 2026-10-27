# chunkdown

chunkdown is an open source TypeScript library by the user: it splits Markdown into chunks for retrieval (RAG), keeps the structure (headings, lists, tables, code blocks) intact, and keeps each chunk under a size in characters or tokens. It is published on npm and has a few hundred users. Issues and pull requests come from other people now and then.

## Stack

TypeScript, the unified and remark parsers, Vitest, tsdown for the build, GitHub Actions, changesets for the releases.

## Timeline (days relative to today, negative is the past)

- -520 to -400: the first version: the splitter on the Markdown syntax tree, the size limit, tests with real documents, the README examples, the first release.
- -400 to -250: tables (split a large table by rows and repeat the header), code blocks, a token counter with a pluggable tokenizer, a CLI with flags, the docs.
- -250 to -2: issues from users: chunks that are too small, links that break at a chunk border, performance with large files, a new major version with a cleaner API, the support for front matter.

## Branches

None. Every session runs in the main checkout.
