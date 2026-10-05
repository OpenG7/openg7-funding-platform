# Private data protection and historical maintenance

## Private queue data at rest

The private server variable `FUNDING_PRIVATE_DATA_ENCRYPTION_KEY` is canonical
base64 encoding of 32 random bytes. Production refuses to start without a valid
key; local development without it preserves the existing unencrypted workflow.
Provision this key through the server secret mechanism, independently of database,
Stripe and SMTP credentials. Never commit, log, or expose it to the Web.

New queued subjects, text and HTML bodies use authenticated AES-256-GCM encryption
with a random nonce and row/field-bound authentication. Metadata retain only the
correlation identifiers used by database joins; other content is encrypted.
Delivery and authorized admin previews decrypt on the API. A missing/wrong key or
altered ciphertext fails safely before SMTP submission. Recipient addresses,
financial records and correlation identifiers remain readable to database roles:
this protection covers private message contents and access links, not all personal
data. It does not protect against an API/server compromise that also obtains the key.

Existing plaintext records remain readable and are not rewritten at startup.
After an explicitly authorized maintenance review and verified backup, use the
bounded tool below on the intended server. It contacts PostgreSQL only and sends
no email. A dry run reports counts and the next UUID cursor, never private contents:

```sh
node --env-file=.env dist/apps/funding-api/src/private-data-backfill.cli.js \
  --kind email --before <UTC-cutoff-YYYY-MM-DDTHH:mm:ssZ> --limit 100 --dry-run
```

An authorized write adds `--apply --confirm-database <exact-database-name>
--actor <operator-identity> --request-id <correlation-UUID>` and
removes `--dry-run`. Continue with `--after-id <nextCursor>` from the prior result;
each invocation handles at most 500 rows and audits the committed batch. The
audit records the declared operator identity, request correlation and result;
use the responsible human's nonsecret identity, never a credential. The
cutoff and IDs bound the work; no scheduler runs this tool. Repeating a batch skips
already protected records. A failed batch rolls back; after uncertain connection
loss, rerun the dry run for the same cursor before applying again.

Keep the encryption key separately backed up for as long as protected records and
backups are needed. Restoring a database without its key cannot recover message
contents. Do not replace the key as a routine secret rotation: existing ciphertext
requires the original key until a separately reviewed re-encryption process exists.
Old backups and PostgreSQL/WAL/storage snapshots may still contain plaintext and
require their existing controlled retention. No automatic purge is introduced.

## Stored provider data

The signed event is processed in memory, while `stripe_events.payload` stores an
explicit projection of identifiers, timestamps, amounts, currencies, statuses and
refund facts needed by administrative SQL. Customer details, card/payment-method
objects, client secrets, raw return URLs and arbitrary provider metadata are not
persisted in new event records. Event IDs and processing states retain deduplication
and correlation; failed processing resumes from an original signed redelivery or
an authorized Stripe backfill, not by replaying a database payload.
Checkout-session metadata stored separately retain only project, consent and
correlation fields; legacy raw follow-up tokens and customer/contact metadata
are excluded from new writes.

Checkout retries must retain their exact provider parameters. The private
`checkout_operations.params`, `contribution_input` and `provider_result` snapshots
therefore use the same authenticated encryption as the email queue, including
success URLs containing a private follow-up token. Provider calls and client
responses receive the decrypted values. See [private queue data at rest](#private-queue-data-at-rest)
for the server key, restore limitations and explicitly authorized historical tool.

Existing full event payloads and plaintext Checkout snapshots remain untouched
by startup. Review a bounded dry run with `--kind stripe` or `--kind checkout`
before authorizing the matching maintenance write. `--kind sessions` reviews
the separate Checkout-session metadata. Stripe minimization retains
the financial/refund fields used by SQL and audits the batch; it removes private
provider fields, so preserve a verified protected backup and review the scope.
No live Stripe request, migration, automatic historical rewrite or backup purge
is triggered by this code change.
