import { afterEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./test-embedded-postgres.js";

const cleanups: Array<() => Promise<void>> = [];
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const COMPANY_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SECRET_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SECRET_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

async function createTempDatabase(): Promise<string> {
  const db = await startEmbeddedPostgresTestDatabase("paperclip-db-rls-");
  cleanups.push(db.cleanup);
  return db.connectionString;
}

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    await cleanup?.();
  }
});

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres RLS tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("RLS baseline", () => {
  it(
    "isolates tenant and company rows for a non-owner runtime role",
    async () => {
      const connectionString = await createTempDatabase();
      const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
      try {
        await sql.unsafe(`
          CREATE ROLE paperclip_rls_test;
          GRANT USAGE ON SCHEMA public, paperclip_app TO paperclip_rls_test;
          GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO paperclip_rls_test;
          GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA paperclip_app TO paperclip_rls_test;
        `);

        await sql.unsafe(`
          INSERT INTO tenants (id, slug, display_name)
          VALUES
            ('${TENANT_A}', 'tenant-a', 'Tenant A'),
            ('${TENANT_B}', 'tenant-b', 'Tenant B');

          INSERT INTO tenant_domains (tenant_id, domain)
          VALUES
            ('${TENANT_A}', 'a.example.test'),
            ('${TENANT_B}', 'b.example.test');

          INSERT INTO companies (id, tenant_id, name, issue_prefix)
          VALUES
            ('${COMPANY_A}', '${TENANT_A}', 'Company A', 'AAA'),
            ('${COMPANY_B}', '${TENANT_B}', 'Company B', 'BBB');

          INSERT INTO issues (company_id, title)
          VALUES
            ('${COMPANY_A}', 'Issue A'),
            ('${COMPANY_B}', 'Issue B');

          INSERT INTO company_secrets (id, company_id, name)
          VALUES
            ('${SECRET_A}', '${COMPANY_A}', 'SECRET_A'),
            ('${SECRET_B}', '${COMPANY_B}', 'SECRET_B');

          INSERT INTO company_secret_versions (secret_id, version, material, value_sha256)
          VALUES
            ('${SECRET_A}', 1, '{"ciphertext":"a"}'::jsonb, 'sha-a'),
            ('${SECRET_B}', 1, '{"ciphertext":"b"}'::jsonb, 'sha-b');
        `);

        await sql.unsafe("SET ROLE paperclip_rls_test");
        await sql.unsafe(`SELECT set_config('paperclip.tenant_id', '${TENANT_A}', false)`);

        const tenantACompanies = await sql<{ name: string }[]>`
          SELECT name FROM companies ORDER BY name
        `;
        expect(tenantACompanies.map((row) => row.name)).toEqual(["Company A"]);

        const tenantAIssues = await sql<{ title: string }[]>`
          SELECT title FROM issues ORDER BY title
        `;
        expect(tenantAIssues.map((row) => row.title)).toEqual(["Issue A"]);

        const tenantASecretVersions = await sql<{ count: string }[]>`
          SELECT count(*)::text AS count FROM company_secret_versions
        `;
        expect(tenantASecretVersions[0]?.count).toBe("1");

        await expect(
          sql.unsafe(`
            INSERT INTO issues (company_id, title)
            VALUES ('${COMPANY_B}', 'Cross tenant write')
          `),
        ).rejects.toThrow(/row-level security/);

        await sql.unsafe(`SELECT set_config('paperclip.tenant_id', '${TENANT_B}', false)`);
        const tenantBCompanies = await sql<{ name: string }[]>`
          SELECT name FROM companies ORDER BY name
        `;
        expect(tenantBCompanies.map((row) => row.name)).toEqual(["Company B"]);

        await sql.unsafe("RESET paperclip.tenant_id");
        const noContextCompanies = await sql<{ name: string }[]>`
          SELECT name FROM companies ORDER BY name
        `;
        expect(noContextCompanies).toEqual([]);
      } finally {
        await sql.unsafe("RESET ROLE").catch(() => undefined);
        await sql.end();
      }
    },
    20_000,
  );
});
