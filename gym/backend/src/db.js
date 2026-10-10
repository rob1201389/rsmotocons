/* Thin database adapter. Two implementations behind one interface so the same
   API code runs on Cloudflare D1 (their existing stack) and on node:sqlite for
   local running and tests. */

export function nodeDb(DatabaseSync, path) {
  const db = new DatabaseSync(path || ':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  return {
    kind: 'node',
    exec: sql => db.exec(sql),
    all: (sql, ...p) => db.prepare(sql).all(...p),
    get: (sql, ...p) => db.prepare(sql).get(...p) ?? null,
    run: (sql, ...p) => { const r = db.prepare(sql).run(...p); return { changes: r.changes }; },
    close: () => db.close()
  };
}

export function d1Db(D1) {
  return {
    kind: 'd1',
    exec: async sql => { for (const s of sql.split(';').map(x => x.trim()).filter(Boolean)) await D1.prepare(s).run(); },
    all: async (sql, ...p) => (await D1.prepare(sql).bind(...p).all()).results || [],
    get: async (sql, ...p) => (await D1.prepare(sql).bind(...p).first()) ?? null,
    run: async (sql, ...p) => { const r = await D1.prepare(sql).bind(...p).run();
      return { changes: (r.meta && r.meta.changes) || 0 }; },
    close: async () => {}
  };
}
