import { createHash } from 'node:crypto';

const uuid = (seed) => {
  const h = createHash('sha256').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const result = (rows = []) => ({
  rows: structuredClone(rows),
  rowCount: rows.length
});

/** Explicit synthetic qualification; real history/offer eligibility is tested against PostgreSQL. */
export function qualifyCommercialFixture(state) {
  state.commitments = {};
  state.obligations = {};
  state.obligationReservations = {};
  state.fulfilmentEvidence = {};
  for (const row of state.rows) {
    if (!row.batch_id) continue;
    const [target, channel] = row.feed_id.split(':');
    const captured = [];
    for (const source of row.source_snapshot) {
      const contributionId = source.contribution_id;
      const id = uuid(`${contributionId}:${target}:${channel}`);
      const commitmentId = uuid(`commitment:${contributionId}`);
      state.commitments[contributionId] = {
        id: commitmentId,
        contributionId,
        offerId: uuid(`offer:${contributionId}`),
        provenance: 'qualified_historical',
        state: 'active',
        qualificationReason: null,
        version: 1,
        blockedReason: null,
        offer: {
          version: 'historical-qualification-v1',
          amountMinor: 50000,
          currency: 'CAD',
          benefits: [
            {
              id: `${channel}_batch`,
              channel,
              target,
              quantity: 1,
              requiredElements: ['company_name'],
              deadlineDays: null,
              durationDays: null
            }
          ]
        }
      };
      state.obligations[id] = {
        id,
        commitmentId,
        contributionId,
        benefitId: `${channel}_batch`,
        channel,
        target,
        ordinal: 1,
        state: 'pending',
        blockedReason: null,
        version: 1,
        fulfilmentEvidenceId: null,
        requirementsMet: true
      };
      captured.push({
        id,
        contributionId,
        version: 1,
        channel,
        target,
        ordinal: 1
      });
      if (['approved', 'publishing', 'uncertain'].includes(row.status))
        state.obligationReservations[id] = {
          obligation_id: id,
          delivery_id: row.id,
          obligation_version: 1
        };
    }
    row.obligation_snapshot ??= captured;
  }
}

export function fulfilmentQueryFixture(state, sql, values) {
  if (
    sql.startsWith('SELECT m.id,m.contribution_id AS') &&
    sql.includes('FROM sponsorship_commitments m')
  )
    return result(
      state.commitments[values[0]] ? [state.commitments[values[0]]] : []
    );
  if (sql.startsWith('SELECT ob.id,ob.commitment_id AS'))
    return result(
      Object.values(state.obligations).filter(
        (o) => o.commitmentId === values[0]
      )
    );
  if (
    sql.startsWith(
      'SELECT r.obligation_id,r.delivery_id FROM sponsorship_obligation_reservations'
    )
  )
    return result(
      Object.values(state.obligationReservations).filter(
        (r) =>
          r.released_at == null &&
          state.obligations[r.obligation_id].contributionId === values[0]
      )
    );
  if (
    sql.startsWith(
      'SELECT obligation_id,obligation_version FROM sponsorship_obligation_reservations'
    )
  )
    return result(
      Object.values(state.obligationReservations).filter(
        (r) => r.released_at == null && r.delivery_id === values[0]
      )
    );
  if (sql.startsWith('INSERT INTO sponsorship_obligation_reservations')) {
    const existing = state.obligationReservations[values[0]];
    if (!existing || existing.released_at != null)
      state.obligationReservations[values[0]] = {
        obligation_id: values[0],
        delivery_id: values[1],
        obligation_version: values[2],
        released_at: null
      };
    return result([state.obligationReservations[values[0]]]);
  }
  if (
    sql.startsWith('DELETE FROM sponsorship_obligation_reservations') ||
    sql.startsWith(
      'UPDATE sponsorship_obligation_reservations SET released_at='
    )
  ) {
    for (const r of Object.values(state.obligationReservations))
      if (r.delivery_id === values[0]) r.released_at = new Date();
    return result();
  }
  if (sql.startsWith('INSERT INTO sponsorship_fulfilment_evidence')) {
    if (state.fulfilmentEvidence[values[0]]) return result();
    const evidence = {
      id: uuid(`evidence:${values[0]}`),
      delivery_id: values[5],
      external_post_id: values[9]
    };
    state.fulfilmentEvidence[values[0]] = evidence;
    return result([evidence]);
  }
  if (
    sql.startsWith(
      'SELECT delivery_id,external_post_id FROM sponsorship_fulfilment_evidence'
    )
  )
    return result(
      state.fulfilmentEvidence[values[0]]
        ? [state.fulfilmentEvidence[values[0]]]
        : []
    );
  if (sql.startsWith("UPDATE sponsorship_obligations SET state='fulfilled'")) {
    const obligation = state.obligations[values[0]];
    if (
      !obligation ||
      obligation.contributionId !== values[2] ||
      obligation.version !== values[3] ||
      obligation.state !== 'pending'
    )
      return result();
    Object.assign(obligation, {
      state: 'fulfilled',
      version: obligation.version + 1,
      fulfilmentEvidenceId: values[1]
    });
    return result([{ id: obligation.id }]);
  }
  // These fixtures contain no email recipient: enqueue checks the event but never contacts SMTP.
  if (sql.startsWith('SELECT ob.contribution_id AS')) return result();
  return null;
}
