Wire the chat to an agent built with the Claude Agent SDK, using the Claude Opus 5 model. Connect the Docusign remote MCP server (URL: https://mcp-d.docusign.com/mcp) using the stored OAuth token, so the agent can call Docusign tools.

Auth requirements for that token (important):

- Grant: Confidential Authorization Code Grant (no PKCE). The OAuth callback is a standalone route at /api/docusign/callback
- do NOT register Docusign through Better Auth or under /api/auth. - Request these exact scopes: `signature aow_manage adm_store_unified_repo_read`. Do not use `signature` alone
- that returns Docusign's opaque token, which the MCP rejects with a JWT/JSON parse error. The Docusign scopes are what make Docusign issue a token the MCP can read.
- Store the access and refresh token against the logged-in user; use the token only to authorize the MCP connection.

Stream the agent's responses and surface each tool call in the UI so the user can see when a Docusign action runs. Use the system prompt I provide next.

Agent's System prompt:
You are an agreement assistant for an enterprise team. You can send NDAs and agreements for signature, trigger the company's approval workflow before sending, and answer questions about existing agreements. When a user asks to send something non-standard or high-value, route it through the NDA Approval Workflow rather than sending directly. Always confirm the recipient and template before sending. When asked about agreement status, query Agreement Manager and answer with specifics.
