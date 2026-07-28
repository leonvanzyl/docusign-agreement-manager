# Database (Drizzle ORM)

Last verified: 2026-07-21

**Purpose:** Store the app's data. Drizzle is the ORM in both branches; only the driver and connection differ. Follow exactly one branch: **SQLite** (local/prototype, zero setup, data lives in a file in the project) or **Postgres** (production-ready, runs in Docker locally and points at a hosted database in production via the same environment variable).

## Install

Both branches:

```bash
pnpm add drizzle-orm
pnpm add -D drizzle-kit
```

**SQLite branch:**

```bash
pnpm add better-sqlite3
pnpm add -D @types/better-sqlite3
```

**Postgres branch:**

```bash
pnpm add pg
pnpm add -D @types/pg
```

## Configure

Schema lives at `src/lib/db/schema.ts` — define tables from the user's interview nouns (plus auth tables later if sign-in is chosen).

**SQLite branch** — `drizzle.config.ts` at project root:

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: { url: "./data/app.db" },
});
```

`src/lib/db/index.ts`:

```ts
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema";

const sqlite = new Database("./data/app.db");
export const db = drizzle(sqlite, { schema });
```

Create the folder and ignore the data file: `mkdir -p data` and add `data/` to `.gitignore`.

**Postgres branch** — run the database locally in Docker so the user installs nothing but Docker Desktop, and nothing is left running on their machine afterwards. `docker-compose.yml` at project root:

```yaml
services:
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: app
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
```

Append to `.env`:

```
POSTGRES_URL=postgresql://app:app@localhost:5432/app
```

`drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.POSTGRES_URL! },
});
```

`src/lib/db/index.ts`:

```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const pool = new Pool({ connectionString: process.env.POSTGRES_URL });
export const db = drizzle(pool, { schema });
```

Start it with `pnpm db:up` (see the scripts below). Docker Desktop must be running — if it isn't, `docker compose` fails with a daemon connection error; tell the user to start Docker Desktop rather than debugging the app.

**If Docker isn't available and the user doesn't want to install it,** don't force it. Either fall back to the SQLite branch, or point `POSTGRES_URL` at a free hosted Postgres (Neon, Supabase) — the rest of this file is identical either way, because only the connection string changes.

**Going to production:** nothing in the code changes. Docker Compose is a local convenience only; a deployed app points `POSTGRES_URL` at a hosted Postgres set in the host's environment variables. Say this at hand-off so the user doesn't think they need to deploy a container.

**Both branches** — add scripts to `package.json`:

```json
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate",
"db:studio": "drizzle-kit studio"
```

**Postgres branch** — also add:

```json
"db:up": "docker compose up -d",
"db:down": "docker compose down"
```

**Never use `drizzle-kit push`.** Not for the first schema, not for a "quick" column, not while prototyping — and `db:push` is deliberately absent from the scripts above so it isn't within reach. `push` diffs the schema straight onto the database with no artefact left behind, which means the project has no migration history, teammates and production have no way to reproduce the schema, and the first destructive diff silently drops a column with real data in it. Migrations are the whole point of using an ORM with a migration tool.

**The schema workflow, every single time:**

```bash
pnpm db:generate   # writes a reviewable SQL file into ./drizzle
pnpm db:migrate    # applies pending migrations
```

Read what `db:generate` produced before applying it. Drizzle cannot always tell a rename from a drop-plus-add, and the generated SQL is where that shows up — a `DROP COLUMN` you didn't intend is obvious in the file and invisible if you skip it.

Commit the `drizzle/` folder. It is source code, not build output.

## Verify

- `pnpm db:generate` produces a migration file in `drizzle/`, and `pnpm db:migrate` applies it without errors.
- Inserting and reading one row through `db` works (a quick script or the first page using a table is fine).
- `pnpm db:studio` opens and shows the tables (optional, good demo for the user).
