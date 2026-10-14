import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Owner actions for the auth end-to-end specs: runs macro_admin procedures on the local macro_e2e
// database as the PostgreSQL superuser from MACROCOUNTER_TEST_PG (never Supabase).

function adminConnectionString(): string {
  let value = process.env.MACROCOUNTER_TEST_PG;
  if (!value && process.platform === 'win32') {
    value = execFileSync(
      'powershell',
      ['-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('MACROCOUNTER_TEST_PG','User')"],
      { encoding: 'utf8' },
    ).trim();
  }
  if (!value) throw new Error('MACROCOUNTER_TEST_PG is not set.');
  return value;
}

function parse(connectionString: string) {
  const parts = new Map<string, string>();
  for (const pair of connectionString.split(';')) {
    const at = pair.indexOf('=');
    if (at > 0) parts.set(pair.slice(0, at).trim().toLowerCase(), pair.slice(at + 1));
  }
  return {
    host: parts.get('host') ?? 'localhost',
    port: parts.get('port') ?? '5432',
    user: parts.get('username') ?? parts.get('user id') ?? 'postgres',
    password: parts.get('password') ?? '',
  };
}

function psqlPath(): string {
  if (process.platform === 'win32') {
    const base = 'C:\\Program Files\\PostgreSQL';
    if (existsSync(base)) {
      const versions = readdirSync(base).sort((a, b) => Number(b) - Number(a));
      for (const version of versions) {
        const candidate = join(base, version, 'bin', 'psql.exe');
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return 'psql';
}

/** Runs one SQL statement against macro_e2e as the admin and returns the single value it prints. */
export function adminSql(sql: string): string {
  const admin = parse(adminConnectionString());
  return execFileSync(
    psqlPath(),
    ['-h', admin.host, '-p', admin.port, '-U', admin.user, '-d', 'macro_e2e', '-v', 'ON_ERROR_STOP=1', '-tAq', '-c', sql],
    { encoding: 'utf8', env: { ...process.env, PGPASSWORD: admin.password, PGOPTIONS: '-c client_min_messages=warning' } },
  ).trim();
}

/** Invites a fresh account and returns its one-time code (contracts/owner-procedures.md). */
export function invite(username: string, role: 'user' | 'owner' = 'user'): string {
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new Error(`invalid username ${username}`);
  return adminSql(`select macro_admin.invite_user('${username}', '${role}');`);
}

/** The codes scripts/e2e-db.ps1 issued for e2e-owner and e2e-friend. */
export function seededCodes(): Record<'e2e-owner' | 'e2e-friend', string> {
  return JSON.parse(readFileSync(join(import.meta.dirname, '.codes.json'), 'utf8')) as Record<'e2e-owner' | 'e2e-friend', string>;
}

/** A unique, valid username for this test and project. */
export function uniqueUsername(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`.slice(0, 32);
}
