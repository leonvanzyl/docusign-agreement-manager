import "server-only";

/**
 * What the agent is, in one place.
 *
 * The prompt and model live here rather than inline at the call site so the
 * agent's behaviour is editable without reading the streaming machinery around it.
 */

/**
 * Claude Opus 5. A fixed alias — Anthropic model ids of this generation carry no
 * date suffix, so appending one produces a 404.
 */
export const AGENT_MODEL = "claude-opus-5";

export const SYSTEM_PROMPT = `You are an agreement assistant for an enterprise team. You can send NDAs and agreements for signature, trigger the company's approval workflow before sending, and answer questions about existing agreements. When a user asks to send something non-standard or high-value, route it through the NDA Approval Workflow rather than sending directly. Always confirm the recipient and template before sending. When asked about agreement status, query Agreement Manager and answer with specifics.

Agreement Manager is your query layer. Any question about the portfolio as a whole — "every unsigned NDA this quarter", counts, renewals due, what a given counterparty has signed — is answered by querying Agreement Manager, never from memory and never from what you saw earlier in the conversation. Reach for eSignature only when the question is about one specific envelope still in flight: whether it was opened, who has not signed yet.

The app's Agreements table is a display of the same data, refreshed from both sources. Do not treat it as your source of truth and do not offer to read it — you query Docusign directly.`;

/**
 * The sync agent: same Docusign access, no conversation.
 *
 * A separate prompt rather than a well-phrased request to the assistant above,
 * because the two want opposite things. The assistant is chatty, asks before it
 * acts, and writes markdown for a person. This one must produce a machine-readable
 * document and nothing else — a single stray sentence of preamble is a parse
 * failure and an empty table.
 */
export const SYNC_SYSTEM_PROMPT = `You are a data collector for an agreement register. You are not talking to a person: your entire output is one JSON document, and anything else you write is discarded.

Never invent a record, an id, a value or a date. A field you could not find is null, and null is always better than a plausible guess — these rows are shown to the user as their contract register.`;

/**
 * What the sync asks for.
 *
 * The shape is spelled out in full rather than left to the model's judgement: this
 * payload is parsed, not read, and the fields it names map one-for-one onto the
 * columns of the agreements table.
 *
 * Statuses come back in Docusign's own vocabulary on purpose. Translating them is
 * a fixed lookup that lives in `lib/docusign/agreements.ts`, where it behaves the
 * same on every run — a model re-deriving it each sync is a model that can decide
 * "delivered" means signed.
 */
export const SYNC_PROMPT = `Collect two lists from Docusign using the tools available to you.

1. **eSignature envelopes** — every envelope on this account, including ones still out for signature. This is the only source that knows about something sent moments ago.
2. **Agreement Manager agreements** — every agreement in the account's repository, with the richer fields: counterparty, value, dates, type.

Page through the results if the tools paginate. If one source genuinely cannot be read — there is no such tool, or the call fails — return an empty array for it and carry on with the other.

Reply with a single \`\`\`json fenced block and nothing else. No preamble, no summary afterwards.

{
  "envelopes": [
    {
      "envelopeId": "the Docusign envelope id, exactly as returned",
      "title": "the envelope subject, or the document name",
      "counterparty": "the other side — the recipient's company, or their name; never the sender",
      "type": "nda | msa | sow | dpa | order_form | other",
      "status": "Docusign's own status string, verbatim: created, sent, delivered, completed, declined, voided",
      "owner": "the sender's name, or null",
      "completedDate": "YYYY-MM-DD, or null"
    }
  ],
  "agreements": [
    {
      "agreementId": "the Agreement Manager id, exactly as returned",
      "envelopeId": "the eSignature envelope this agreement came from, if the record names one, else null",
      "title": "the agreement name",
      "counterparty": "the counterparty organisation",
      "type": "nda | msa | sow | dpa | order_form | other",
      "status": "the record's own status string, verbatim",
      "value": 480000.5,
      "currency": "USD",
      "owner": "who owns it internally, or null",
      "effectiveDate": "YYYY-MM-DD, or null",
      "expiryDate": "YYYY-MM-DD, or null"
    }
  ]
}

Notes on the fields:

- **envelopeId on an Agreement Manager record is the join between the two lists.** Include it whenever the record carries one — without it the same agreement appears twice in the register.
- **type**: classify from the title and document type. Use "other" when it is genuinely none of the listed kinds; do not force a fit.
- **status**: pass through untranslated. The app maps it.
- **value**: the total contract value in major units (480000.5, not cents), or null. Do not estimate one.`;

/**
 * Authentication is Claude Code's OAuth, never an Anthropic API key.
 *
 * The SDK resolves credentials in a fixed order, and an API key wins over
 * everything else. So there is nothing to *add* for the normal case — the work is
 * in taking things away, below.
 */

/**
 * An explicit long-lived token, from `claude setup-token`.
 *
 * Optional. Left unset, the SDK authenticates as whoever is signed in to Claude
 * Code on this machine (`~/.claude/.credentials.json`), which is what you want in
 * development. Set it where there is no interactive login to inherit — CI, a
 * container, a deployed server.
 */
export const OAUTH_TOKEN_ENV = "CLAUDE_CODE_OAUTH_TOKEN";

/**
 * API-key credentials, stripped from the agent's environment.
 *
 * These outrank OAuth in the SDK's resolution order, so one exported in a
 * developer's shell for something else entirely would silently take over — the
 * agent would run, bill a different account, and give no hint that it had. An empty
 * `ANTHROPIC_API_KEY=` still counts as set, so these are deleted rather than blanked.
 */
export const API_KEY_ENV = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"] as const;

/**
 * Builds the environment for the SDK's child process.
 *
 * `process.env` is spread back in because the SDK replaces the child environment
 * wholesale rather than merging — and the child still needs `PATH`, and `HOME` /
 * `USERPROFILE` to find the Claude Code credentials in the first place.
 */
export function buildAgentEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };

  for (const name of API_KEY_ENV) delete env[name];

  const token = process.env[OAUTH_TOKEN_ENV]?.trim();
  if (token) env[OAUTH_TOKEN_ENV] = token;

  return env;
}
