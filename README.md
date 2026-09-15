# Intent Longbox

**Snap a photo of a back-issue comic. Get a Shopify listing ready for your approval.**

Every comic shop has the same problem sitting in the back room: long boxes full of back issues that never make it online. Listing one book by hand means looking it up, judging its condition, checking what it sells for, and typing it all into Shopify. For most back issues, that work costs more than the book earns. So the boxes stay in the back.

Longbox turns that chore into a few taps on a phone.

```
Photograph   →   Identify   →   Confirm   →   Condition   →   Price   →   Draft   →   Owner approves
 your phone        Claude       your staff     your staff      suggested    Shopify     you, in Shopify
```

[Live demo page](https://demos.intentsolutions.io/longbox/) · [How it works](#how-a-book-gets-listed) · [For developers](#for-developers) · [Built by Intent Solutions](https://intentsolutions.io/)

[![CI](https://github.com/jeremylongshore/intent-longbox/actions/workflows/ci.yml/badge.svg)](https://github.com/jeremylongshore/intent-longbox/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/U5S225PTME)

## First shop to roll it out

**Gotham City Limit** in Jacksonville, Florida is the first shop running Longbox.

## How a book gets listed

1. **Photograph it.** An employee opens Longbox in the phone's web browser and takes pictures of the cover, the back, and the barcode. There is no app to install.
2. **Longbox figures out which book it is.** It reads the barcode first. Then Claude looks at the photos and suggests the most likely matches. If the evidence doesn't add up, Longbox says so instead of guessing.
3. **Your employee confirms it.** A person picks the right book. Nothing moves forward until someone does.
4. **Your employee records the condition.** Condition is written the way people who handle comics talk about it: a grade range plus the specific flaws (spine stress, a corner crease, a tear). Longbox never invents a single number grade.
5. **Longbox suggests a price.** It uses market data and your shop's own pricing rules. Your employee can change it.
6. **A draft listing lands in your Shopify store.** Photos, title, condition and price, filled in and saved as a draft.
7. **You approve it.** The owner reviews the draft in Shopify and publishes when it looks right.

## What stays in your hands

- **Nothing publishes without a person.** Longbox only ever creates drafts. The draft status is fixed in the code, and a test checks it on every change.
- **People make the calls.** Staff confirm the book and record the condition. Longbox helps; it doesn't decide.
- **Your data stays your shop's.** Each shop's records are separated inside the database itself (row-level security), not just in the app's code.
- **Your AI account, your choice.** Claude is the default. A shop can connect its own AI account, and other compatible model providers are supported.

## Built with Claude

Longbox uses the Claude API (Claude Sonnet 5 by default) to identify books from photos. Intent Solutions built it with Claude Code. Intent Solutions is a member of the Claude Partner Network.

---

## For developers

Longbox is a TypeScript service: Node 22, Fastify, and Postgres 16, with a plain mobile web page for staff. The system is a modular monolith. Every scan is an identity, and each step of a scan (the candidates, the confirmation, the condition, the price, the draft) is saved as a new timestamped record instead of editing old ones.

### Run it locally

```bash
pnpm install
docker compose -f docker-compose.test.yml up -d    # local Postgres on port 54329
cp .env.example .env                               # then set DATABASE_URL, MIGRATE_DATABASE_URL and LONGBOX_PIN_PEPPER
pnpm migrate
LONGBOX_BOOTSTRAP_PIN=123456 pnpm register-shop --name "Demo Comics" --slug demo --no-recovery-contact
pnpm dev
```

Without API credentials, the Shopify, pricing and eBay connections run as stubs, so you can walk the whole flow on your machine. `.env.example` documents every setting.

### Test it

```bash
pnpm test                 # unit tests with the coverage floor
pnpm test:integration     # real Postgres (start docker-compose.test.yml first)
pnpm lint && pnpm typecheck
pnpm arch                 # architecture rules an import graph can't see
```

Every pull request to `main` must pass eight required checks: lint, typecheck, unit tests with a coverage floor, Postgres integration and HTTP smoke tests, secret scanning and a dependency audit, test-harness verification, the architecture gate, and a linked work item.

### Where things live

| Path             | What's there                                                               |
| ---------------- | -------------------------------------------------------------------------- |
| `src/routes/`    | The HTTP API the phone page calls                                          |
| `src/services/`  | Identify, condition, pricing, and the Shopify draft                        |
| `src/providers/` | AI provider adapters (Claude by default)                                   |
| `migrations/`    | The database schema, including row-level security                          |
| `public/`        | The staff phone page                                                       |
| `tests/`         | Unit, integration, and contract tests                                      |
| `000-docs/`      | Architecture, decision records, and specs ([index](000-docs/000-INDEX.md)) |

Start with the [architecture](000-docs/003-AT-ARCH-architecture.md) and the [user journey](000-docs/004-PP-UJRN-user-journey.md).

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md). To report a vulnerability, follow [SECURITY.md](SECURITY.md).

## Want this for your shop?

Longbox was built by [Intent Solutions](https://intentsolutions.io/). If you run a comic or collectibles shop and want your back issues online, [start a conversation](https://demos.intentsolutions.io/#contact).

## License

Apache-2.0. See [LICENSE](LICENSE).
