# Document resend receipts

This contract supplements the [admin API](admin-api.md#document-resend-receipts)
for sponsorship invoices and credit notes. It introduces no migration and does
not change existing resend POSTs.

## Confirmed resend

Resends require `to`, UUID `requestId`, and `confirmation` matching `invoiceId`
or `creditNoteId` (400 `CONFIRMATION_REQUIRED` if confirmation/UUID is missing).
Update Web/API together. Identical retries share one `messageId`; reusing the UUID
for another document/recipient returns 409 `REQUEST_CONFLICT`. Queue and audit
commit atomically; the worker delivers afterward. Replay never resets backoff
or alters issued documents.

## Read an existing receipt

`GET /api/admin/sponsorship-documents/resend-receipt` (also `/admin`) requires
exactly `requestId` (UUID), `documentKind` (`invoice` or `credit_note`) and
`documentId` (UUID), each once. Operator/owner access and the original audit actor
are required. OIDC uses the individual admin account; the local token session
shares its existing audit identity and provides no individual separation.

This private, no-store read joins the existing queue entry and its atomic resend
audit. It does not require current SMTP configuration, send, retry, update a
document or create an audit row. Reader access is denied before the lookup.

The echoed request tuple has `found:false` for an absent/mismatched receipt,
including another actor. `found:true` adds `messageId`, ISO UTC `acceptedAt`,
`deliveryStatus` (`queued|sending|sent|failed|uncertain`) and nullable ISO `sentAt`.
No recipient, subject or body is returned. A queued command is not proof of
delivery, and `sent` does not establish inbox deliverability. Malformed/duplicate
query fields return 400 `INVALID_DOCUMENT_RECEIPT`; unavailable storage returns
503 `DOCUMENT_RECEIPT_UNAVAILABLE`, never a fabricated miss.

An absent receipt does not rule out a POST still committing. The Web checks only
the retained UUID: absence/error preserves the lock; `sending`/`uncertain` retains
it across reload. A matching `queued`, `sent` or `failed` receipt confirms command
acceptance and clears the pending request marker. The registry's current delivery
status remains independent and can still block another send. A later failed
registry refresh does not erase the exact receipt or its email message link.
See [UI recovery and limits](../payment-trust-validation.md#recette-de-renvoi-des-factures-et-avoirs).

Expense creation uses its [own receipt](expense-creation-receipts.md). Assistant
information requests still have no equivalent receipt on this branch.
