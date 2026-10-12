import { performance } from 'node:perf_hooks';

const round = (value) => Math.round(value * 100) / 100;

/** Instrument only this test's disposable pool; captured SQL stays in memory. */
export function profilePublicationPool(pool) {
  const measurements = [];
  const queries = [];
  let phase = null;
  const wrap = (connection) => {
    let transactionStarted = null;
    return {
      async query(...args) {
        const text = typeof args[0] === 'string' ? args[0] : args[0].text;
        const values = typeof args[0] === 'string' ? args[1] : args[0].values;
        const started = performance.now();
        if (/^BEGIN\b/.test(text)) transactionStarted = started;
        try {
          const result = await connection.query(...args);
          if (phase) {
            const elapsedMs = performance.now() - started;
            phase.queryCount++;
            phase.queryTimeMs += elapsedMs;
            phase.maxQueryMs = Math.max(phase.maxQueryMs, elapsedMs);
            if (/^\s*(WITH|SELECT)\b/i.test(text))
              queries.push({
                phase: phase.name,
                text,
                values,
                rowCount: result.rowCount,
                elapsedMs
              });
            if (
              /^(COMMIT|ROLLBACK)\b/.test(text) &&
              transactionStarted !== null
            ) {
              phase.transactionDurationsMs.push(
                round(performance.now() - transactionStarted)
              );
              transactionStarted = null;
            }
          }
          return result;
        } catch (error) {
          if (phase) phase.failedQueries++;
          throw error;
        }
      },
      release: () => connection.release()
    };
  };
  const port = {
    query: (...args) => wrap(pool).query(...args),
    connect: async () => wrap(await pool.connect())
  };
  return {
    port,
    measurements,
    queries,
    async measure(name, operation) {
      if (phase) throw new Error('Profile phases must not overlap.');
      const started = performance.now();
      const cpu = process.cpuUsage();
      phase = {
        name,
        queryCount: 0,
        queryTimeMs: 0,
        maxQueryMs: 0,
        failedQueries: 0,
        transactionDurationsMs: []
      };
      try {
        return await operation();
      } finally {
        const used = process.cpuUsage(cpu);
        measurements.push({
          ...phase,
          elapsedMs: round(performance.now() - started),
          queryTimeMs: round(phase.queryTimeMs),
          maxQueryMs: round(phase.maxQueryMs),
          nodeCpuMs: round((used.user + used.system) / 1000)
        });
        phase = null;
      }
    }
  };
}

/** Keep execution cost and relation/index names, never expressions, rows or binds. */
export async function explainPublicationRead(pool, captured) {
  const { rows } = await pool.query(
    `EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${captured.text}`,
    captured.values
  );
  const explanation = rows[0]['QUERY PLAN'][0];
  const nodes = [];
  const visit = (node, depth = 0) => {
    nodes.push({
      type: node['Node Type'],
      depth,
      ...(node['Relation Name'] ? { relation: node['Relation Name'] } : {}),
      ...(node['Index Name'] ? { index: node['Index Name'] } : {}),
      ...(node.Alias ? { alias: node.Alias } : {}),
      ...(node['Subplan Name'] ? { subplan: node['Subplan Name'] } : {}),
      ...(node['Parent Relationship']
        ? { parentRelationship: node['Parent Relationship'] }
        : {}),
      actualRows: node['Actual Rows'],
      loops: node['Actual Loops'],
      actualStartupTimeMs: node['Actual Startup Time'],
      actualTotalTimeMs: node['Actual Total Time'],
      rowsRemoved: node['Rows Removed by Filter'] ?? 0,
      joinRowsRemoved: node['Rows Removed by Join Filter'] ?? 0,
      sharedHits: node['Shared Hit Blocks'] ?? 0,
      sharedReads: node['Shared Read Blocks'] ?? 0,
      tempReads: node['Temp Read Blocks'] ?? 0,
      tempWrites: node['Temp Written Blocks'] ?? 0
    });
    for (const child of node.Plans ?? []) visit(child, depth + 1);
  };
  visit(explanation.Plan);
  return {
    planningMs: explanation['Planning Time'],
    executionMs: explanation['Execution Time'],
    jitMs: explanation.JIT?.Timing?.Total ?? 0,
    measuredStatementMs: round(captured.elapsedMs),
    returnedRows: captured.rowCount,
    nodes
  };
}
