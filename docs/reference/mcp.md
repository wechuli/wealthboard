---
title: Connect an AI assistant (MCP)
description: Let an AI assistant you already use read your Wealthboard data through a read-only Model Context Protocol endpoint.
---

# Connect an AI assistant (MCP)

Wealthboard serves a read-only [Model Context Protocol](https://modelcontextprotocol.io/)
(MCP) endpoint at `/mcp`. An assistant that supports MCP can use it to answer
questions about your accounts, transactions, goals, and reports using
Wealthboard's own figures. Wealthboard never sends your data to an AI provider
itself. The assistant you connect requests it, and that provider's terms then
apply to what it receives.

There are two ways to connect:

- **Hosted assistants** such as Claude (web, Desktop, and mobile) and ChatGPT
  sign in with OAuth: you approve the connection on a Wealthboard consent page.
- **Developer tools** such as Claude Code, VS Code, Cursor, and Codex can also
  use a personal API key in a request header.

## Connect Claude or ChatGPT

::: warning Your server must be public
Claude and ChatGPT connect from their own cloud, not from your device. Your
`APP_URL` must be a public HTTPS address they can reach. A server that is only
on your home network, a VPN, or `localhost` won't connect.
:::

1. In **Settings → Connected apps**, copy the MCP address. It is your `APP_URL`
   followed by `/mcp`, for example `https://wealth.example.com/mcp`.
2. Add it as a custom connector:
   - **Claude:** add a custom connector with that URL. See
     [Get started with custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).
   - **ChatGPT:** turn on developer mode, create an app with that URL, and
     choose OAuth authentication. See
     [Connecting custom MCP servers in ChatGPT](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt).
3. The assistant opens Wealthboard. Sign in if asked, check the application
   name and the address it returns to, choose what it can read, and select
   **Allow access**.

Choose what the assistant can read:

| Access           | Tools                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------- |
| **Detailed**     | All tools below, including account, goal, institution, and instrument names and transactions |
| **Summary only** | `get_portfolio_summary`, `get_cash_flow_report`, and `get_income_report`, without institution, instrument, or account-level detail |

The application name on the consent page comes from the application and isn't
verified. Allow access only when you've just started the connection yourself.

### Manage connections

**Settings → Connected apps** lists each assistant with its access level, when
it was connected and last used, and its recent tool calls (name, outcome, and
time; never what it read). Select **Disconnect** to stop it immediately.
Connecting the same assistant again replaces its earlier connection.
Connections that aren't used for 30 days expire.

## Use an API key

### Create a key

1. Open **Settings → API keys** and create a key with only the
   `portfolio:read` scope. Keys with other scopes are refused by `/mcp` unless
   they also include `portfolio:read`, but a read-only key limits what a leaked
   key can do elsewhere in the API.
2. Copy the key; it's shown only once.
3. Revoke the key from the same page to disconnect the assistant immediately.

Use one key per assistant so you can revoke them separately.

### Configure your client

Replace `https://wealth.example.com` with your deployment's `APP_URL`. Keep keys
out of shared or committed files.

#### Claude Code

```sh
claude mcp add --transport http wealthboard https://wealth.example.com/mcp \
  --header "Authorization: Bearer $WEALTHBOARD_API_KEY"
```

#### VS Code

In your user `mcp.json` (**MCP: Open User Configuration**), prompt for the key
instead of storing it:

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "wealthboard-key",
      "description": "Wealthboard API key",
      "password": true
    }
  ],
  "servers": {
    "wealthboard": {
      "type": "http",
      "url": "https://wealth.example.com/mcp",
      "headers": { "Authorization": "Bearer ${input:wealthboard-key}" }
    }
  }
}
```

#### Cursor

Add the server to the user-level `~/.cursor/mcp.json`, not a project file:

```json
{
  "mcpServers": {
    "wealthboard": {
      "url": "https://wealth.example.com/mcp",
      "headers": { "Authorization": "Bearer <your API key>" }
    }
  }
}
```

#### Codex

In `~/.codex/config.toml`, read the key from an environment variable:

```toml
[mcp_servers.wealthboard]
url = "https://wealth.example.com/mcp"
bearer_token_env_var = "WEALTHBOARD_API_KEY"
```

## Tools

All tools are read-only and return only the key owner's data.

| Tool                    | Returns                                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `get_portfolio_summary` | Net worth, assets, liabilities, liquid and investible totals, net-worth change, allocation, completeness warnings. Start here.         |
| `list_accounts`         | Accounts with balance, base-currency value, and 30-day change; `status` is `active` (default), `archived`, or `all`                     |
| `get_account`           | One account's lifetime flows, holdings, and linked goals; archived accounts return only their summary                                  |
| `list_transactions`     | Newest first, filtered by `accountId`, `type`, `from`, and `to`; `limit` up to 100, continued with `offset` = the previous `nextOffset` |
| `get_cash_flow_report`  | Contributions, withdrawals, income, fees, growth, and monthly detail for `range` (`1m`, `3m`, `6m`, `1y`, `all`), plus net-worth stats  |
| `get_income_report`     | Interest, dividends, growth, and fees for `range`, by account, instrument, and month                                                   |
| `list_goals`            | Goals with target, progress, target date, tracking status, and linked account                                                          |
| `get_goal`              | One goal's plan, scenarios, milestones, and projection                                                                                 |
| `get_holdings`          | Positions, prices, and cash for investment accounts; `accountId` is optional                                                           |
| `get_attention_items`   | Missing exchange rates, stale prices, and goals behind schedule                                                                        |

The server also offers a `portfolio_review` prompt. Its optional `focus` is
`overall`, `allocation`, `goals`, `cash-flow`, or `data-quality`.

### Values

- Every amount is an object such as
  `{"minor": "150050", "decimal": "1500.50", "currency": "KES"}`. `minor` is
  the exact integer value; `decimal` is the same value at the currency's
  precision. Amounts are never floating-point numbers.
- Base-currency figures use the exchange rate effective on each date. When
  `complete` is `false` or `missingCurrencies` isn't empty, totals leave out
  accounts without a rate.
- Monthly series keep the most recent 120 months, and goal projections the next
  60 points; a `…Truncated` flag says when a series was shortened.

## What the assistant can see

Assistants receive account, institution, category, and goal names, balances,
transactions and their descriptions, holdings, and reports. They never receive
account references, private notes, import external IDs, credentials, or other
users' data. Transaction descriptions come from your imports, so tool results
mark them as untrusted text the assistant must not follow as instructions.

## Limits and errors

| Response | Meaning                                                                                |
| -------- | -------------------------------------------------------------------------------------- |
| `401`    | No credentials, an unknown, revoked, or expired key or token, or more than one `Authorization` header |
| `403`    | The key or token lacks `portfolio:read`                                                                |
| `429`    | The key or connection reached its per-minute limit; wait for `Retry-After` seconds                     |

`/mcp` never uses the browser session cookie. A `401` includes a
`WWW-Authenticate` header that points assistants to
`/.well-known/oauth-protected-resource/mcp`, where OAuth sign-in starts. Inside a tool call, another user's
IDs and unknown IDs both return "No matching record was found for this user."

Operators can change the endpoint with these environment variables:

| Variable                  | Default | Purpose                                                    |
| ------------------------- | ------- | ---------------------------------------------------------- |
| `MCP_ENABLED`             | `true`  | Set `false` to remove `/mcp`, OAuth sign-in, and Connected apps |
| `MCP_REQUESTS_PER_MINUTE` | `120`   | Requests per API key per minute, counted in each replica   |

## Check the connection

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector) lists the
tools and calls them from a terminal:

```sh
npx @modelcontextprotocol/inspector --cli https://wealth.example.com/mcp \
  --transport http --header "Authorization: Bearer $WEALTHBOARD_API_KEY" \
  --method tools/list
```

## OAuth details

For developers of MCP clients. Wealthboard implements the
[MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
with `APP_URL` as the issuer and `APP_URL/mcp` as the resource.

| Endpoint                                     | Purpose                                                        |
| -------------------------------------------- | -------------------------------------------------------------- |
| `/.well-known/oauth-protected-resource/mcp`  | Protected resource metadata (RFC 9728)                         |
| `/.well-known/oauth-authorization-server`    | Authorization server metadata (RFC 8414)                       |
| `/oauth/register`                            | Dynamic Client Registration (RFC 7591); 60 per address per hour |
| `/oauth/authorize`                           | Authorization code with `S256` PKCE; returns `iss` (RFC 9207)  |
| `/oauth/token`                               | `authorization_code` and `refresh_token` grants                |
| `/oauth/revoke`                              | Token revocation (RFC 7009)                                    |

- Redirect URIs must use HTTPS, an HTTP loopback address (matched on any
  port), or an app-specific scheme, without fragments.
- Clients may be public (`none`) or confidential (`client_secret_basic` or
  `client_secret_post`). Client ID Metadata Documents aren't supported.
- Authorization request errors show a Wealthboard error page instead of
  redirecting, because anyone can register a client. The client's redirect URI
  is used only after the user approves or cancels.
- Authorization, token, and revocation requests are limited to 120 a minute per
  client. Wealthboard rate-limits by the connecting address, so behind a
  reverse proxy the registration limit is shared by the whole instance.
- The only scope is `portfolio:read`; `offline_access` is accepted and ignored
  because refresh tokens are always issued.
- Access tokens last one hour. Refresh tokens last 30 days and rotate on every
  use; reusing one revokes the connection, as does revoking a refresh token.
