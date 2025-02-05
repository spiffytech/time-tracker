import { Kysely } from "kysely";
import { BunWorkerDialect } from "kysely-bun-worker";

interface Database {}

const dialect = new BunWorkerDialect({
  url: ":memory:",
});

const db = new Kysely<Database>({ dialect });
