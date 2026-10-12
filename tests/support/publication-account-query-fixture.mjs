import assert from 'node:assert/strict';

const key = (provider, accountId, mode) =>
  JSON.stringify([provider, accountId, mode]);
const rowKey = (row) =>
  key(
    row.feed_id.split(':')[1],
    row.account_id.replace(/^urn:li:organization:/, '').trim(),
    row.mode
  );
const result = (rows = []) => ({
  rows: structuredClone(rows),
  rowCount: rows.length
});

/** Transaction-local test state; PostgreSQL integration owns the locking/clock evidence. */
export function accountQueryFixture(
  state,
  sql,
  values = [],
  clock = new Date()
) {
  state.accounts ??= {};
  state.reservations ??= {};
  for (const row of state.rows) {
    const accountKey = rowKey(row);
    state.accounts[accountKey] ??= {
      fence: 0,
      delivery_id: null,
      delivery_version: null,
      lease_until: null,
      dispatched_at: null,
      uncertain: false,
      next_dispatch_at: new Date(0)
    };
    if (
      !state.reservations[row.id] &&
      ['approved', 'publishing'].includes(row.status)
    ) {
      const account = state.accounts[accountKey];
      state.reservations[row.id] = {
        accountKey,
        delivery_id: row.id,
        approval_version: row.version,
        scheduled_at: row.scheduled_at,
        status: row.status === 'publishing' ? 'publishing' : 'reserved',
        claim_version: null,
        claim_fence: null
      };
      if (row.status === 'publishing') {
        Object.assign(account, {
          fence: account.fence + 1,
          delivery_id: row.id,
          delivery_version: row.version,
          lease_until: row.lease_until
        });
        Object.assign(state.reservations[row.id], {
          claim_version: row.version,
          claim_fence: account.fence
        });
      }
    }
  }
  const accountKey = key(values[0], values[1], values[2]);
  const account = state.accounts[accountKey];
  const reservation = state.reservations[values[0]];
  if (sql.startsWith('INSERT INTO publication_account_leases')) {
    state.accounts[accountKey] ??= {
      fence: 0,
      delivery_id: null,
      delivery_version: null,
      lease_until: null,
      dispatched_at: null,
      uncertain: false,
      next_dispatch_at: new Date(0)
    };
    return result();
  }
  if (sql.startsWith('SELECT 1 FROM publication_account_leases a JOIN')) {
    const owner = Object.values(state.accounts).find(
      (item) =>
        item.delivery_id === values[0] && item.delivery_version === values[1]
    );
    const valid =
      owner &&
      !owner.uncertain &&
      owner.lease_until > clock &&
      reservation?.claim_version === owner.delivery_version &&
      reservation.claim_fence === owner.fence &&
      (values[2] === null || values[2] === owner.fence);
    return result(valid ? [{ present: 1 }] : []);
  }
  if (
    sql.startsWith(
      'SELECT 1 FROM publication_account_leases WHERE delivery_id='
    )
  )
    return result(
      Object.values(state.accounts).filter(
        (item) => item.delivery_id === values[0] && item.uncertain
      )
    );
  if (sql.startsWith('SELECT 1 FROM publication_account_leases'))
    return result(account ? [{ present: 1 }] : []);
  if (
    sql.startsWith(
      'SELECT delivery_id,uncertain FROM publication_account_leases'
    )
  )
    return result(account ? [account] : []);
  if (
    sql.startsWith(
      'SELECT delivery_version,dispatched_at FROM publication_account_leases'
    )
  )
    return result(account?.delivery_id === values[3] ? [account] : []);
  if (sql.startsWith('SELECT $1::timestamptz > clock_timestamp()'))
    return result([{ future: new Date(values[0]) > clock }]);
  if (
    sql.startsWith(
      'SELECT approval_version FROM publication_account_reservations'
    )
  )
    return result(reservation?.status === 'reserved' ? [reservation] : []);
  if (sql.startsWith('SELECT status FROM publication_account_reservations'))
    return result(reservation ? [reservation] : []);
  if (
    sql.startsWith('SELECT delivery_id FROM publication_account_reservations')
  ) {
    const overlap = Object.values(state.reservations).filter(
      (item) =>
        item.accountKey === accountKey &&
        item.delivery_id !== values[3] &&
        ['reserved', 'publishing', 'uncertain'].includes(item.status) &&
        Math.abs(item.scheduled_at - new Date(values[4])) < values[5]
    );
    return result(overlap.slice(0, 1));
  }
  if (sql.startsWith('SELECT 1 FROM publication_deliveries other'))
    return result();
  if (sql.startsWith('INSERT INTO publication_account_reservations')) {
    state.reservations[values[0]] = {
      delivery_id: values[0],
      accountKey: key(values[1], values[2], values[3]),
      scheduled_at: new Date(values[4]),
      approval_version: values[5],
      status: 'reserved',
      claim_version: null,
      claim_fence: null
    };
    return result();
  }
  if (sql.startsWith('UPDATE publication_account_reservations r')) {
    for (const item of Object.values(state.reservations)) {
      const delivery = state.rows.find((row) => row.id === item.delivery_id);
      if (
        item.accountKey === accountKey &&
        item.status === 'reserved' &&
        !['approved', 'publishing', 'uncertain'].includes(delivery?.status) &&
        !Object.values(state.accounts).some(
          (account) => account.delivery_id === item.delivery_id
        )
      )
        item.status = 'released';
    }
    return result();
  }
  if (
    sql.startsWith(
      "UPDATE publication_account_reservations SET status='publishing'"
    )
  ) {
    assert.ok(reservation);
    Object.assign(reservation, {
      status: 'publishing',
      claim_version: values[1],
      claim_fence: values[2]
    });
    return result();
  }
  if (
    sql.startsWith(
      "UPDATE publication_account_reservations SET status='released'"
    )
  ) {
    if (
      reservation &&
      !Object.values(state.accounts).some(
        (item) => item.delivery_id === values[0]
      )
    )
      reservation.status = 'released';
    return result();
  }
  if (sql.startsWith('UPDATE publication_account_reservations SET status=$2')) {
    assert.ok(reservation);
    reservation.status = values[1];
    return result();
  }
  if (sql.startsWith('UPDATE publication_account_leases SET delivery_id=$4')) {
    if (
      !account ||
      account.delivery_id !== null ||
      account.uncertain ||
      account.next_dispatch_at > clock
    )
      return result();
    Object.assign(account, {
      delivery_id: values[3],
      delivery_version: values[4],
      fence: account.fence + 1,
      lease_until: new Date(clock.getTime() + 300000),
      dispatched_at: null
    });
    return result([{ fence: account.fence }]);
  }
  if (sql.startsWith('UPDATE publication_account_leases SET dispatched_at=')) {
    const owner = Object.values(state.accounts).find(
      (item) =>
        item.delivery_id === values[0] &&
        item.delivery_version === values[1] &&
        item.lease_until > clock &&
        !item.uncertain &&
        (values[2] === null || item.fence === values[2])
    );
    if (!owner) return result();
    owner.dispatched_at ??= clock;
    return result([{ fence: owner.fence }]);
  }
  if (
    sql.startsWith('UPDATE publication_account_leases SET delivery_id=CASE')
  ) {
    assert.ok(account);
    if (values[5])
      account.next_dispatch_at = new Date(
        Math.max(
          account.next_dispatch_at.getTime(),
          (account.dispatched_at ?? clock).getTime() + values[4]
        )
      );
    account.uncertain = values[3];
    if (!account.uncertain)
      Object.assign(account, {
        delivery_id: null,
        delivery_version: null,
        lease_until: null
      });
    return result();
  }
  if (
    sql.startsWith('UPDATE publication_account_leases SET delivery_id=NULL')
  ) {
    if (account?.delivery_id === values[3])
      Object.assign(account, {
        delivery_id: null,
        delivery_version: null,
        lease_until: null,
        uncertain: false
      });
    return result();
  }
  return null;
}

export function ownsAccountFixture(state, row, clock) {
  const account = state.accounts?.[rowKey(row)];
  return (
    account?.delivery_id === row.id &&
    account.delivery_version === row.version &&
    account.lease_until > clock &&
    !account.uncertain
  );
}
