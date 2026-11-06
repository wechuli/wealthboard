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

::: warning Current scope
This first version uses personal API keys. It works with MCP clients that let
you set a request header, such as Claude Code, VS Code, Cursor, and Codex.
claude.ai, Claude Desktop and mobile connectors, and ChatGPT need OAuth sign-in,
which is planned. Those assistants also connect from the vendor's cloud, so they
will need Wealthboard on a public HTTPS address.
:::

## Create a key

1. Open **Settings → API keys** and create a key with only the
   `portfolio:read` scope. Keys with other scopes are refused by `/mcp` unless
   they also include `portfolio:read`, but a read-only key limits what a leaked
   key can do elsewhere in the API.
2. Copy the key; it's shown only once.
3. Revoke the key from the same page to disconnect the assistant immediately.

Use one key per assistant so you can revoke them separately.

## Configure your client

Replace `https://wealth.example.com` with your deployment's `APP_URL`. Keep keys
out of shared or committed files.

### Claude Code

```sh
claude mcp add --transport http wealthboard https://wealth.example.com/mcp \
  --header "Authorization: Bearer $WEALTHBOARD_API_KEY"
```

### VS Code

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

### Cursor

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

### Codex

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
| `401`    | No key, an unknown, revoked, or expired key, or more than one `Authorization` header |
| `403`    | The key lacks `portfolio:read`                                                         |
| `429`    | The key reached its per-minute limit; wait for `Retry-After` seconds                   |

`/mcp` never uses the browser session cookie. Inside a tool call, another user's
IDs and unknown IDs both return "No matching record was found for this user."

Operators can change the endpoint with these environment variables:

| Variable                  | Default | Purpose                                                    |
| ------------------------- | ------- | ---------------------------------------------------------- |
| `MCP_ENABLED`             | `true`  | Set `false` to remove the `/mcp` endpoint                  |
| `MCP_REQUESTS_PER_MINUTE` | `120`   | Requests per API key per minute, counted in each replica   |

## Check the connection

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector) lists the
tools and calls them from a terminal:

```sh
npx @modelcontextprotocol/inspector --cli https://wealth.example.com/mcp \
  --transport http --header "Authorization: Bearer $WEALTHBOARD_API_KEY" \
  --method tools/list
```
