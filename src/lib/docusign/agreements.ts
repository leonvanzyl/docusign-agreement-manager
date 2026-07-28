import type {
  AgreementSource,
  AgreementStatus,
  AgreementType,
} from "@/lib/db/schema";

/**
 * Turning two Docusign products into one register.
 *
 * Docusign answers "what is happening with my agreements?" twice over, and neither
 * answer is complete on its own:
 *
 * - **eSignature** knows about envelopes the moment they are sent, including ones
 *   still going round for signature. It is the only source that can show an
 *   in-flight item, but it knows almost nothing beyond who and when.
 * - **Agreement Manager** knows about agreements once they exist as agreements —
 *   with the party, the value, the dates, the type. Richer, but it has nothing to
 *   say about the envelope you sent thirty seconds ago.
 *
 * So the table is built from both, and the same item shows up twice: once as the
 * envelope that carried it and once as the agreement it became. `mergeRegister`
 * below collapses that pair, keeping the richer record.
 *
 * The agent does the reading and the judgement calls — which tools exist, what a
 * document *is*. Everything mechanical (status vocabulary, de-duplication, which
 * record wins) is done here in code, where it is deterministic and does not drift
 * between runs.
 *
 * No `server-only`: this module is pure data-shaping with no credentials in it.
 */

const AGREEMENT_TYPES = [
  "nda",
  "msa",
  "sow",
  "dpa",
  "order_form",
  "other",
] as const satisfies readonly AgreementType[];

/* -------------------------------------------------------------------------- */
/* Field coercion                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Every field reader below is forgiving on purpose, and none of them can fail.
 *
 * This is coercion, not validation, so it is hand-written rather than a schema.
 * The payload is composed by a language model reading whatever shape Docusign
 * returned: a stray `""`, a full ISO timestamp where a date was asked for, a
 * number sent as a string, or an omitted key where the answer was null are all
 * routine. A validator's job is to reject those; here rejecting one field would
 * mean an agreement silently missing from the user's register, which is far worse
 * than a blank cell.
 *
 * Only two things are actually required — an id and a title — and an item without
 * them is dropped by `parseRegisterPayload` rather than coerced into existence.
 */

function field(item: Record<string, unknown>, name: string): unknown {
  return item[name];
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** The stand-ins a model reaches for when it means "there wasn't one". */
const PLACEHOLDERS = new Set(["", "n/a", "na", "none", "null", "unknown", "-", "—"]);

function readOptionalText(value: unknown): string | null {
  const trimmed = readText(value);
  return PLACEHOLDERS.has(trimmed.toLowerCase()) ? null : trimmed;
}

/** `date` columns want "YYYY-MM-DD"; a full timestamp is truncated to its day. */
function readDate(value: unknown): string | null {
  const match = readText(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;

  const [, year, month, day] = match;
  // Rejects "2026-13-45" — a date Postgres would refuse, and one bad date would
  // take the whole batch insert down with it.
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * Contract value in whole cents.
 *
 * The agent reports major units (48000.5), which is what Docusign shows and what
 * it can copy across without doing arithmetic. Converting here keeps the rounding
 * in one place rather than trusting a model to multiply by 100.
 */
function readValueCents(value: unknown): number | null {
  const amount =
    typeof value === "number"
      ? value
      : // "480,000.50" and "$480,000.50" both turn up.
        typeof value === "string"
        ? Number(value.replace(/[^\d.-]/g, ""))
        : Number.NaN;

  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}

function readCurrency(value: unknown): string {
  const code = readText(value).toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : "USD";
}

function readType(value: unknown): AgreementType {
  const candidate = readText(value).toLowerCase();
  return (AGREEMENT_TYPES as readonly string[]).includes(candidate)
    ? (candidate as AgreementType)
    : "other";
}

/* -------------------------------------------------------------------------- */
/* Status mapping                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Docusign's status vocabulary, translated into this app's.
 *
 * Kept as code rather than asked of the agent: it is a fixed table, and a model
 * re-deriving it every sync is a model that can decide "delivered" means executed.
 *
 * eSignature's set is closed and documented, so it maps exactly. Agreement Manager
 * is looser — the wording varies by agreement type and by account — so unmatched
 * values fall through to the keyword pass below.
 */
const ENVELOPE_STATUS: Record<string, AgreementStatus> = {
  created: "draft",
  // "sent" covers everything mid-flight; "delivered" only means opened, and
  // "signed" means *a* signer signed, not all of them. All still out.
  sent: "out_for_signature",
  delivered: "out_for_signature",
  signed: "out_for_signature",
  correct: "out_for_signature",
  completed: "executed",
  declined: "voided",
  voided: "voided",
  deleted: "voided",
};

/** Substring → status, tried in order. First match wins, so order matters. */
const STATUS_KEYWORDS: [RegExp, AgreementStatus][] = [
  [/terminat|cancel|void|declin|rescind|withdraw/, "voided"],
  [/expir|lapsed/, "expired"],
  [/review|approval|negotiat|redlin/, "in_review"],
  [/draft|creat|unsent/, "draft"],
  [/pending|await|out.?for.?sign|partial|sent|deliver|in.?flight|in.?progress/, "out_for_signature"],
  [/complete|execut|signed|active|in.?effect|countersign|fully/, "executed"],
];

/**
 * Unknown statuses become `draft`.
 *
 * It is the only value that claims nothing: it does not assert that somebody
 * signed, and it does not put an item into a renewal countdown it should not be
 * in. A wrong guess in either of those directions is a worse lie than "draft".
 */
export function mapStatus(raw: string | null, source: AgreementSource): AgreementStatus {
  if (!raw) return "draft";
  const normalized = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");

  if (source === "esignature") {
    const exact = ENVELOPE_STATUS[normalized];
    if (exact) return exact;
  }

  for (const [pattern, status] of STATUS_KEYWORDS) {
    if (pattern.test(normalized)) return status;
  }
  return "draft";
}

/* -------------------------------------------------------------------------- */
/* The agent's payload                                                        */
/* -------------------------------------------------------------------------- */

export type DocusignEnvelope = {
  envelopeId: string;
  title: string;
  counterparty: string | null;
  type: AgreementType;
  status: string | null;
  owner: string | null;
  /** The day every signer was done — the one date an envelope actually knows. */
  completedDate: string | null;
};

export type ManagedAgreement = {
  agreementId: string;
  /** Present when Agreement Manager knows which envelope produced this — the join. */
  envelopeId: string | null;
  title: string;
  counterparty: string | null;
  type: AgreementType;
  status: string | null;
  valueCents: number | null;
  currency: string;
  owner: string | null;
  effectiveDate: string | null;
  expiryDate: string | null;
};

export type DocusignRegisterPayload = {
  envelopes: DocusignEnvelope[];
  agreements: ManagedAgreement[];
  /** Entries the agent returned with no usable id or title, and so no identity. */
  skipped: number;
};

function readEnvelope(item: Record<string, unknown>): DocusignEnvelope | null {
  const envelopeId = readText(field(item, "envelopeId"));
  const title = readText(field(item, "title"));
  // An entry with no id cannot be de-duplicated or upserted — it would arrive as a
  // fresh duplicate on every single sync — and one with no title has nothing to
  // show. Either way there is no row to build.
  if (!envelopeId || !title) return null;

  return {
    envelopeId,
    title,
    counterparty: readOptionalText(field(item, "counterparty")),
    type: readType(field(item, "type")),
    status: readOptionalText(field(item, "status")),
    owner: readOptionalText(field(item, "owner")),
    completedDate: readDate(field(item, "completedDate")),
  };
}

function readManagedAgreement(item: Record<string, unknown>): ManagedAgreement | null {
  const agreementId = readText(field(item, "agreementId"));
  const title = readText(field(item, "title"));
  if (!agreementId || !title) return null;

  return {
    agreementId,
    envelopeId: readOptionalText(field(item, "envelopeId")),
    title,
    counterparty: readOptionalText(field(item, "counterparty")),
    type: readType(field(item, "type")),
    status: readOptionalText(field(item, "status")),
    valueCents: readValueCents(field(item, "value")),
    currency: readCurrency(field(item, "currency")),
    owner: readOptionalText(field(item, "owner")),
    effectiveDate: readDate(field(item, "effectiveDate")),
    expiryDate: readDate(field(item, "expiryDate")),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Returns null only when the payload is not the two-list document at all — the
 * one case that means "the agent answered something other than what was asked",
 * as opposed to "the account is empty".
 */
export function parseRegisterPayload(input: unknown): DocusignRegisterPayload | null {
  if (!isRecord(input)) return null;
  if (!("envelopes" in input) && !("agreements" in input)) return null;

  let skipped = 0;

  const collect = <T>(
    items: unknown[],
    read: (item: Record<string, unknown>) => T | null,
  ): T[] => {
    const parsed: T[] = [];
    for (const item of items) {
      const result = isRecord(item) ? read(item) : null;
      if (result) parsed.push(result);
      else skipped++;
    }
    return parsed;
  };

  return {
    envelopes: collect(readList(input.envelopes), readEnvelope),
    agreements: collect(readList(input.agreements), readManagedAgreement),
    skipped,
  };
}

/* -------------------------------------------------------------------------- */
/* The merge                                                                  */
/* -------------------------------------------------------------------------- */

/** One row of the register, ready to be written. */
export type RegisterItem = {
  /** The de-duplication identity: envelope id when there is one, else agreement id. */
  externalKey: string;
  source: Exclude<AgreementSource, "manual">;
  envelopeId: string | null;
  agreementId: string | null;
  title: string;
  counterparty: string;
  type: AgreementType;
  status: AgreementStatus;
  valueCents: number | null;
  currency: string;
  owner: string | null;
  effectiveDate: string | null;
  expiryDate: string | null;
};

const UNKNOWN_COUNTERPARTY = "Unknown counterparty";

function fromEnvelope(envelope: DocusignEnvelope): RegisterItem {
  return {
    externalKey: envelope.envelopeId,
    source: "esignature",
    envelopeId: envelope.envelopeId,
    agreementId: null,
    title: envelope.title,
    counterparty: envelope.counterparty ?? UNKNOWN_COUNTERPARTY,
    type: envelope.type,
    status: mapStatus(envelope.status, "esignature"),
    valueCents: null,
    currency: "USD",
    owner: envelope.owner,
    // The day the last signature landed is the day the agreement took effect.
    effectiveDate: envelope.completedDate,
    // An envelope has no term in it — the expiry only arrives with the Agreement
    // Manager record, which is precisely why the two sources are merged.
    expiryDate: null,
  };
}

function fromManagedAgreement(item: ManagedAgreement): RegisterItem {
  return {
    externalKey: item.envelopeId || item.agreementId,
    source: "agreement_manager",
    envelopeId: item.envelopeId,
    agreementId: item.agreementId,
    title: item.title,
    counterparty: item.counterparty ?? UNKNOWN_COUNTERPARTY,
    type: item.type,
    status: mapStatus(item.status, "agreement_manager"),
    valueCents: item.valueCents,
    currency: item.currency,
    owner: item.owner,
    effectiveDate: item.effectiveDate,
    expiryDate: item.expiryDate,
  };
}

/**
 * Agreement Manager wins, field by field.
 *
 * Not a wholesale replacement: Agreement Manager is the better record overall, but
 * it can still be missing something the envelope had (a sender name, a readable
 * subject line). Taking the richer record and letting the envelope fill its gaps
 * loses nothing, where preferring one object outright would.
 */
function preferManaged(managed: RegisterItem, envelope: RegisterItem): RegisterItem {
  return {
    ...managed,
    // Both ids are kept so the row stays linked to the envelope it came from even
    // though Agreement Manager is now the record of truth for it.
    envelopeId: managed.envelopeId ?? envelope.envelopeId,
    counterparty:
      managed.counterparty === UNKNOWN_COUNTERPARTY
        ? envelope.counterparty
        : managed.counterparty,
    type: managed.type === "other" ? envelope.type : managed.type,
    owner: managed.owner ?? envelope.owner,
    effectiveDate: managed.effectiveDate ?? envelope.effectiveDate,
  };
}

/**
 * Collapses the two sources into the rows the table shows.
 *
 * Envelopes are laid down first so that anything sent in the last few seconds is
 * present, then Agreement Manager records are merged over the top of the ones it
 * also knows about. An envelope with no Agreement Manager counterpart survives —
 * that is the in-progress case the whole two-source arrangement exists for.
 */
export function mergeRegister(payload: DocusignRegisterPayload): RegisterItem[] {
  const byKey = new Map<string, RegisterItem>();

  for (const envelope of payload.envelopes) {
    const item = fromEnvelope(envelope);
    // Docusign can list the same envelope twice across pages; first write wins.
    if (!byKey.has(item.externalKey)) byKey.set(item.externalKey, item);
  }

  for (const agreement of payload.agreements) {
    const item = fromManagedAgreement(agreement);
    const existing = byKey.get(item.externalKey);

    if (!existing) {
      byKey.set(item.externalKey, item);
      continue;
    }

    byKey.set(
      item.externalKey,
      existing.source === "esignature" ? preferManaged(item, existing) : existing,
    );
  }

  return [...byKey.values()];
}
