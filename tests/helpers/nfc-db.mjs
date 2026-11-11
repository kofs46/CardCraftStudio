// Test harness: runs the real Supabase migration SQL inside PGlite (in-process Postgres) and
// exposes a fetch() that mimics the small subset of PostgREST / Storage / Auth the NFC server uses.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

export async function createDb() {
  const db = new PGlite();
  // Supabase provides these roles and the storage schema; PGlite does not.
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  `);
  await db.exec(read('supabase/schema.sql'));
  await db.exec(read('supabase/migrations/20261111000000_nfc_platform.sql'));
  return db;
}

export async function rpc(db, name, p) {
  const result = await db.query(`select public.${name}($1::jsonb) as r`, [JSON.stringify(p)]);
  return result.rows[0]?.r ?? null;
}

/**
 * Build a fake fetch for the Supabase project.
 * - POST /rest/v1/rpc/<fn> {p} → real SQL function
 * - POST /rest/v1/rpc/shop_limit → real rate-limit function (can be forced via state.limited)
 * - Storage object upload / delete → recorded in state.storage
 * - /auth/v1/user → admin token "admin-token" is the allowlisted admin
 */
export function supabaseFetch(db, state = {}) {
  state.storage ??= new Map();
  state.deleted ??= [];
  state.calls ??= [];
  return async (input, options = {}) => {
    const url = new URL(input);
    const reply = (data, status = 200) => new Response(data === undefined ? '' : JSON.stringify(data), { status });
    state.calls.push(url.pathname);
    if (url.pathname === '/auth/v1/user') {
      const auth = options.headers?.Authorization;
      if (auth === 'Bearer admin-token') return reply({ id: 'admin-user' });
      if (auth === 'Bearer other-token') return reply({ id: 'someone-else' });
      return reply({}, 401);
    }
    if (url.pathname === '/rest/v1/rpc/shop_limit') {
      if (state.limited) return reply(false);
      const body = JSON.parse(options.body);
      const r = await db.query('select public.shop_limit($1,$2,$3) as ok', [body.rate_key, body.max_hits, body.window_seconds]);
      return reply(r.rows[0].ok);
    }
    if (url.pathname.startsWith('/rest/v1/rpc/nfc_')) {
      const name = url.pathname.slice('/rest/v1/rpc/'.length);
      if (!/^nfc_[a-z_]+$/.test(name) || name.startsWith('nfc__')) return reply({ message: 'not found' }, 404);
      try {
        const body = JSON.parse(options.body);
        return reply(await rpc(db, name, body.p));
      } catch (error) {
        return reply({ message: error.message }, 400);
      }
    }
    if (url.pathname.startsWith('/storage/v1/object/nfc-profile-media/') && options.method === 'POST') {
      const path = url.pathname.slice('/storage/v1/object/nfc-profile-media/'.length);
      state.storage.set(path, { type: options.headers['Content-Type'], size: options.body.length });
      return reply({ Key: path });
    }
    if (url.pathname === '/storage/v1/object/nfc-profile-media' && options.method === 'DELETE') {
      const { prefixes } = JSON.parse(options.body);
      for (const p of prefixes) { state.storage.delete(p); state.deleted.push(p); }
      return reply(prefixes.map((name) => ({ name })));
    }
    throw new Error('Unexpected Supabase call ' + (options.method || 'GET') + ' ' + url.pathname);
  };
}
