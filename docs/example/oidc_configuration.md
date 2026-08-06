# OIDC Provider Configuration

This guide explains how to register Wealthboard as an OpenID Connect (OIDC)
client in Keycloak or Okta. It covers the identity-provider configuration, the
matching Wealthboard environment variables, staged rollout, validation, and
common failure modes.

The provider screens and terminology were checked against the current Keycloak
Server Administration Guide and Okta Identity Engine documentation on
2026-08-06. Labels can move between provider releases, but the protocol values
in this guide must remain the same.

## Wealthboard's OIDC contract

Wealthboard is a confidential, server-side OIDC client. Configure the provider
with all of these properties:

| Property                   | Required value                                                 |
| -------------------------- | -------------------------------------------------------------- |
| Flow                       | OIDC Authorization Code                                        |
| Response type              | `code`                                                         |
| Response mode              | Query/default code response, not `form_post`                   |
| Client type                | Confidential web application                                   |
| Client authentication      | Client secret in the token request body (`client_secret_post`) |
| PKCE                       | Required or allowed, challenge method `S256`                   |
| Redirect URI               | Exact `${APP_URL}/api/auth/oidc/callback`                      |
| Scopes                     | `openid profile email`                                         |
| ID-token signing algorithm | `RS256`                                                        |
| Subject                    | Stable, non-empty `sub` claim                                  |
| Optional display claims    | `name`, then `preferred_username`                              |
| Discovery                  | `${OIDC_ISSUER}/.well-known/openid-configuration`              |

Wealthboard also sends and verifies `state` and `nonce`. It validates the ID
token's signature, issuer, audience, expiry, not-before time, subject, and
nonce. It does not call UserInfo and does not retain the authorization code,
access token, refresh token, or ID token after creating its internal session.

The provider identity is only the exact `(issuer, sub)` pair. Wealthboard never
links users by email address, username, preferred username, display name, or
email-verification status. Changing the issuer or changing how the provider
generates `sub` creates a different external identity.

## Choose the public Wealthboard URL

Choose the canonical browser origin before creating the provider client.
Production deployments must use HTTPS.

```text
APP_URL=https://wealthboard.example.com
CALLBACK_URL=https://wealthboard.example.com/api/auth/oidc/callback
```

`APP_URL` must be an origin only. Do not add a path, query string, fragment, or
embedded credentials. The redirect URI is case-sensitive and must match the
provider registration exactly, including scheme, host, port, path, and any
trailing slash. The callback shown above has no trailing slash.

Plain HTTP is accepted by Wealthboard only for explicit localhost development,
for example:

```text
APP_URL=http://localhost:3000
CALLBACK_URL=http://localhost:3000/api/auth/oidc/callback
```

Do not register broad redirect patterns, wildcards, the application root, or a
proxy-internal hostname.

## Validate provider discovery first

The issuer is the provider identifier, not the authorization endpoint and not
the discovery-document URL. Given an issuer, Wealthboard appends
`/.well-known/openid-configuration` itself.

Use this check before configuring Wealthboard:

```bash
export OIDC_ISSUER='https://identity.example.com/realms/wealthboard'

curl --fail --silent --show-error \
  "$OIDC_ISSUER/.well-known/openid-configuration" \
  | jq '{
      issuer,
      authorization_endpoint,
      token_endpoint,
      jwks_uri,
      id_token_signing_alg_values_supported,
      code_challenge_methods_supported,
      token_endpoint_auth_methods_supported
    }'
```

Confirm all of the following:

1. `issuer` equals `OIDC_ISSUER` exactly.
2. `authorization_endpoint`, `token_endpoint`, and `jwks_uri` are public HTTPS
   URLs in production.
3. `id_token_signing_alg_values_supported` contains `RS256`.
4. `code_challenge_methods_supported` contains `S256`.
5. `token_endpoint_auth_methods_supported` contains `client_secret_post`, or
   the provider client otherwise explicitly accepts a client secret in the POST
   body.

Do not continue if the discovery document returns internal hosts, HTTP URLs in
production, a different issuer, or endpoints that Wealthboard cannot reach.

## Keycloak

### 1. Select or create a realm

1. Sign in to the Keycloak Admin Console.
2. Select the realm that will authenticate Wealthboard users.
3. Do not use the `master` realm for application users.
4. If needed, choose **Create realm**, enter a realm name such as
   `wealthboard`, and create it.
5. Ensure the realm is enabled.

For a realm named `wealthboard`, the typical public issuer is:

```text
https://id.example.com/realms/wealthboard
```

If Keycloak is mounted under a context path, that path is part of the issuer,
for example:

```text
https://id.example.com/auth/realms/wealthboard
```

Use the `issuer` returned by the realm's OpenID Provider Configuration endpoint.
Do not guess endpoint paths. If Keycloak is behind a reverse proxy, configure
Keycloak's public hostname and proxy settings first so discovery returns the
public HTTPS issuer and endpoints rather than container or cluster addresses.

### 2. Create the OIDC client

1. In the selected realm, open **Clients**.
2. Select **Create client**.
3. Set **Client type** to **OpenID Connect**.
4. Set **Client ID** to a stable value such as `wealthboard`.
5. Optionally set **Name** to `Wealthboard`.
6. Continue to the capability configuration.

Use these capability settings:

| Keycloak setting                     | Value |
| ------------------------------------ | ----- |
| Client authentication                | On    |
| Authorization                        | Off   |
| Standard flow                        | On    |
| Direct access grants                 | Off   |
| Implicit flow                        | Off   |
| Service accounts roles               | Off   |
| OAuth 2.0 Device Authorization Grant | Off   |
| OIDC CIBA Grant                      | Off   |

Only Standard Flow is needed. Wealthboard does not use password grants,
implicit or hybrid tokens, device flow, CIBA, service accounts, or Keycloak
Authorization Services.

### 3. Configure URLs

On the client's **Settings** tab, configure:

| Keycloak field                  | Production example                                       |
| ------------------------------- | -------------------------------------------------------- |
| Root URL                        | `https://wealthboard.example.com`                        |
| Home URL                        | `https://wealthboard.example.com`                        |
| Valid redirect URIs             | `https://wealthboard.example.com/api/auth/oidc/callback` |
| Web origins                     | Leave empty                                              |
| Admin URL                       | Leave empty                                              |
| Valid post logout redirect URIs | Leave empty                                              |

Add only the exact callback URI. Do not use `*`, `/\*`, or a wildcard host.
Web Origins is unnecessary because the browser never calls Keycloak's token or
UserInfo endpoints directly. Wealthboard does not currently perform
provider-wide or RP-initiated logout, so no provider logout callback is needed.

### 4. Require the supported flow and algorithms

Depending on the Keycloak version, these controls are on **Settings**,
**Advanced**, or under **Fine Grain OpenID Connect Configuration**:

1. Set **PKCE method** or **Proof Key for Code Exchange Code Challenge Method**
   to `S256`.
2. Set **ID Token Signature Algorithm** to `RS256`.
3. Leave ID-token encryption disabled.
4. Leave request-object, PAR, DPoP, and mTLS requirements disabled unless
   Wealthboard gains explicit support for them in a future release.

Keycloak may allow PKCE even when the PKCE field is blank, but setting `S256`
explicitly prevents non-PKCE authorization requests for this client.

### 5. Configure the client secret

1. Open the client's **Credentials** tab.
2. Keep **Client Authenticator** set to **Client ID and Secret**.
3. Copy the generated client secret into your deployment secret store.
4. If Keycloak exposes **Allowed authentication method**, allow client secrets
   in POST request parameters. Do not restrict this client to HTTP Basic only.

Wealthboard sends `client_id` and `client_secret` in the form-encoded token
request body. This is the standard `client_secret_post` method.

Never put the secret in source control, a committed Compose file, a Kubernetes
manifest, provider notes, screenshots, support tickets, or shell history.

### 6. Verify scopes and ID-token claims

Open the client's **Client scopes** tab and confirm:

1. The built-in `profile` scope is assigned as Default or Optional.
2. The built-in `email` scope is assigned as Default or Optional.
3. Their protocol mappers add standard profile claims to the ID token.
4. The ID token always contains `sub`.
5. `name` or `preferred_username` is present when you want a friendly initial
   Wealthboard display name.

Wealthboard explicitly requests `openid profile email`, so Optional assignment
is sufficient. Email is optional to Wealthboard and is never used as an account
key. Do not add financial, group, role, or sensitive directory attributes to the
ID token unless another application requirement needs them.

### 7. Control who may use Wealthboard

Keycloak does not automatically treat a client role as permission to sign in to
that client. Assigning a client role alone changes token contents; it does not
block other enabled realm users.

The simplest provider-side admission model is a dedicated realm containing only
users allowed to access Wealthboard. If the realm uses LDAP or another user
federation source, restrict the imported or available users to the approved
directory group or organizational unit.

If Wealthboard must share a realm, use a tested client-specific authentication
flow:

1. Create a client role such as `wealthboard-access` on the `wealthboard`
   client.
2. Assign `wealthboard-access` to approved users or groups.
3. Duplicate the built-in Browser flow. Never edit the built-in flow directly.
4. In the duplicate, add a conditional denial branch after the user is known.
5. Configure **Condition - User Role** for
   `wealthboard.wealthboard-access`, negate the condition, and follow it with
   **Deny Access**.
6. In the Wealthboard client's advanced **Authentication flow overrides**, set
   the Browser Flow override to this duplicate.
7. Test one assigned user and one unassigned user before rollout.

Authentication-flow structure varies between Keycloak releases. If the
client-specific flow has not been tested for cookie SSO, direct login, required
actions, and federated users, use a dedicated realm instead.

### 8. Keycloak environment values

```dotenv
APP_URL=https://wealthboard.example.com
AUTH_METHODS=local,oidc
OIDC_ISSUER=https://id.example.com/realms/wealthboard
OIDC_CLIENT_ID=wealthboard
OIDC_CLIENT_SECRET=replace-with-the-keycloak-client-secret
OIDC_PROVIDER_NAME=Company SSO
OIDC_TRANSACTION_SECRET=replace-with-a-separate-base64-32-byte-value
```

`OIDC_PROVIDER_NAME` is display text for Wealthboard's login button. It is not a
Keycloak client identifier.

## Okta

### 1. Choose the Okta authorization server

For normal workforce SSO, use the Okta org authorization server. Wealthboard
uses the ID token for authentication and discards the access token, so it does
not need a custom API authorization server.

For an Okta org domain such as `dev-123456.okta.com`:

```text
OIDC_ISSUER=https://dev-123456.okta.com
DISCOVERY=https://dev-123456.okta.com/.well-known/openid-configuration
```

Use a custom authorization server only when your Okta policy requires one. Its
issuer includes the authorization-server ID:

```text
OIDC_ISSUER=https://dev-123456.okta.com/oauth2/default
DISCOVERY=https://dev-123456.okta.com/oauth2/default/.well-known/openid-configuration
```

A production Okta subscription may require API Access Management for custom
authorization servers. The pre-created `default` custom authorization server
may not have an access policy. If you use it, create an access policy and rule
that permits the Wealthboard client, assigned users, Authorization Code, and the
requested OIDC scopes.

If your Okta org has a custom URL domain, choose either the Okta org domain or
the custom domain and use it consistently. Set a fixed issuer for the app rather
than **Dynamic**, then confirm that discovery without a `client_id` query
parameter returns exactly the configured `OIDC_ISSUER`.

### 2. Create the Okta app integration

1. Sign in to the Okta Admin Console.
2. Go to **Applications > Applications**.
3. Select **Create App Integration**.
4. Choose **OIDC - OpenID Connect** as the sign-in method.
5. Choose **Web Application** as the application type.
6. Select **Next**.

Do not choose Single-Page Application or Native Application. Wealthboard keeps
a client secret on the server and performs the code exchange server-side.

### 3. Configure the flow and redirect URI

Use these settings in the App Integration Wizard:

| Okta setting          | Value                                                    |
| --------------------- | -------------------------------------------------------- |
| App integration name  | `Wealthboard`                                            |
| Grant type            | Authorization Code only                                  |
| Sign-in redirect URI  | `https://wealthboard.example.com/api/auth/oidc/callback` |
| Sign-out redirect URI | Leave empty unless Okta requires a value                 |
| Login initiated by    | App Only                                                 |
| DPoP required         | Off                                                      |

Do not enable Implicit/Hybrid, Client Credentials, Resource Owner Password,
Device Authorization, CIBA, or Token Exchange. Refresh Token is unnecessary
because Wealthboard does not retain or refresh provider tokens.

Use **App Only** login. Do not select an Okta-initiated flow that sends an ID
token directly to the app. Okta's simplified direct-ID-token flow uses
`form_post` and does not provide the Wealthboard state transaction expected by
the callback.

### 4. Configure client authentication and PKCE

After saving, open the app's **General** tab and edit **Client Credentials**:

1. Set **Client authentication** to **Client secret**.
2. Require PKCE when the Okta tenant exposes that option.
3. Confirm the PKCE method is `S256`.
4. Copy the Client ID and Client Secret into your deployment secret store.

Wealthboard uses `client_secret_post`. Okta supports this method and its token
endpoint accepts `client_id` and `client_secret` in the form body. Selecting
**Client secret** in the Admin Console does not by itself prove which client
secret transport is configured. Okta clients can default to
`client_secret_basic`, which is not compatible with Wealthboard's current token
request.

Verify the registered method with Okta's Dynamic Client Registration API. Use
an Okta OAuth administration access token with `okta.clients.read` for the GET
request and `okta.clients.manage` if an update is required:

```bash
export OKTA_DOMAIN='dev-123456.okta.com'
export OKTA_CLIENT_ID='replace-with-the-okta-client-id'
export OKTA_ADMIN_ACCESS_TOKEN='replace-with-a-short-lived-admin-access-token'

curl --fail --silent --show-error \
  --header "Authorization: Bearer $OKTA_ADMIN_ACCESS_TOKEN" \
  "https://$OKTA_DOMAIN/oauth2/v1/clients/$OKTA_CLIENT_ID" \
  | jq '{
      client_id,
      application_type,
      grant_types,
      response_types,
      redirect_uris,
      token_endpoint_auth_method
    }'
```

The result must show all of these values:

```json
{
  "application_type": "web",
  "grant_types": ["authorization_code"],
  "response_types": ["code"],
  "redirect_uris": ["https://wealthboard.example.com/api/auth/oidc/callback"],
  "token_endpoint_auth_method": "client_secret_post"
}
```

If `token_endpoint_auth_method` is not `client_secret_post`, replace the client
settings through `PUT /oauth2/v1/clients/{clientId}`. Okta does not support a
partial update on this endpoint: retrieve the complete client document,
preserve all settings, remove response-only timestamps and the returned secret,
change only `token_endpoint_auth_method`, and then submit the complete document.

```bash
umask 077
OKTA_CLIENT_FILE="$(mktemp)"
OKTA_CLIENT_UPDATE_FILE="$(mktemp)"

curl --fail --silent --show-error \
  --header "Authorization: Bearer $OKTA_ADMIN_ACCESS_TOKEN" \
  "https://$OKTA_DOMAIN/oauth2/v1/clients/$OKTA_CLIENT_ID" \
  > "$OKTA_CLIENT_FILE"

jq '
  del(
    .client_id_issued_at,
    .client_secret,
    .client_secret_expires_at,
    .registration_access_token,
    .registration_client_uri
  )
  | .token_endpoint_auth_method = "client_secret_post"
' "$OKTA_CLIENT_FILE" > "$OKTA_CLIENT_UPDATE_FILE"

curl --fail --silent --show-error \
  --request PUT \
  --header "Authorization: Bearer $OKTA_ADMIN_ACCESS_TOKEN" \
  --header 'Content-Type: application/json' \
  --data-binary "@$OKTA_CLIENT_UPDATE_FILE" \
  "https://$OKTA_DOMAIN/oauth2/v1/clients/$OKTA_CLIENT_ID" \
  | jq '{client_id, token_endpoint_auth_method}'

rm -f "$OKTA_CLIENT_FILE" "$OKTA_CLIENT_UPDATE_FILE"
unset OKTA_ADMIN_ACCESS_TOKEN
```

Review the retrieved JSON before the PUT, especially assignments, redirect
URIs, grant types, and any logout or custom settings. Use your organization's
approved Okta automation instead when direct administrative API access is not
permitted. The update response can include a newly generated client secret;
when it does, replace `OIDC_CLIENT_SECRET` in Wealthboard's secret store before
testing login.

Do not select `private_key_jwt`, `client_secret_jwt`, or a Basic-only client
authentication policy for this integration.

### 5. Configure the ID token

On **Sign On** or the equivalent OIDC token settings page:

1. Set the ID-token signing algorithm to `RS256`.
2. Ensure the standard `sub` claim is present.
3. Allow the standard `profile` and `email` scopes.
4. Ensure `name` or `preferred_username` is included in the ID token if you
   want a friendly initial display name.
5. Do not configure an encrypted ID token.

The Okta org authorization server supports `openid`, `profile`, `email`, S256,
`client_secret_post`, and RS256. Wealthboard does not call UserInfo, so claims
needed for initial display must be present in the verified ID token. Only `sub`
is required for identity.

### 6. Assign users or groups

Limit provider-side admission rather than allowing every Okta user by default:

1. During app creation, choose **Limit access to selected groups**; or choose
   **Skip group assignment for now** and assign access after creation.
2. Open the app's **Assignments** tab.
3. Select **Assign > Assign to People** or **Assign > Assign to Groups**.
4. Assign only users or groups allowed to create or access Wealthboard
   portfolios.
5. Test with one assigned and one unassigned user.

Wealthboard intentionally permits JIT creation for any identity accepted by the
configured provider client. Okta assignments are therefore the primary
provider-side admission control. Select **Allow everyone in your organization**
only when that is an explicit deployment decision.

### 7. Okta environment values

Using the recommended org authorization server:

```dotenv
APP_URL=https://wealthboard.example.com
AUTH_METHODS=local,oidc
OIDC_ISSUER=https://dev-123456.okta.com
OIDC_CLIENT_ID=replace-with-the-okta-client-id
OIDC_CLIENT_SECRET=replace-with-the-okta-client-secret
OIDC_PROVIDER_NAME=Okta
OIDC_TRANSACTION_SECRET=replace-with-a-separate-base64-32-byte-value
```

Using a custom authorization server changes only the issuer example:

```dotenv
OIDC_ISSUER=https://dev-123456.okta.com/oauth2/default
```

## Configure Wealthboard

### Generate application secrets

Generate the session and OIDC transaction secrets separately:

```bash
openssl rand -hex 32
openssl rand -base64 32
```

Use the hex value for `SESSION_SECRET` and the base64 value for
`OIDC_TRANSACTION_SECRET`. Do not reuse either value as the provider client
secret. Keep `OIDC_TRANSACTION_SECRET` stable across restarts. Rotating it
invalidates only OIDC transactions and reauthentication grants currently in
progress.

### Select the authentication mode

| `AUTH_METHODS` | Behavior                                                      |
| -------------- | ------------------------------------------------------------- |
| `local`        | Local login and signup only                                   |
| `local,oidc`   | Local login/signup plus provider login and account linking    |
| `oidc`         | Provider login only; local signup and password login disabled |

Use `local,oidc` for initial deployment and migration. Do not switch an existing
installation directly from `local` to `oidc`.

### Docker Compose

Put the values in the uncommitted `.env` file used by Compose:

```dotenv
SESSION_SECRET=replace-with-generated-session-secret
APP_URL=https://wealthboard.example.com
AUTH_METHODS=local,oidc
OIDC_ISSUER=https://id.example.com/realms/wealthboard
OIDC_CLIENT_ID=wealthboard
OIDC_CLIENT_SECRET=replace-with-provider-client-secret
OIDC_PROVIDER_NAME=Company SSO
OIDC_TRANSACTION_SECRET=replace-with-generated-transaction-secret
```

Then restart the application so startup validation reloads the policy:

```bash
docker compose up -d --build
docker compose ps
```

### Kubernetes

Set non-secret values in the Deployment:

```yaml
- name: AUTH_METHODS
  value: local,oidc
- name: OIDC_ISSUER
  value: https://id.example.com/realms/wealthboard
- name: OIDC_CLIENT_ID
  value: wealthboard
- name: OIDC_PROVIDER_NAME
  value: Company SSO
```

Store both OIDC secrets in the existing Kubernetes Secret, not in the manifest:

```bash
kubectl create secret generic wealthboard-secrets \
  --from-literal=session-secret="$(openssl rand -hex 32)" \
  --from-literal=oidc-client-secret='replace-with-provider-client-secret' \
  --from-literal=oidc-transaction-secret="$(openssl rand -base64 32)"
```

If the Secret already exists, update it through your secret-management process
instead of running a create command that would fail or replace unrelated keys.

## Staged rollout for existing local users

Wealthboard never merges an OIDC identity into a local account based on matching
email, username, or display name. This protects against account takeover but
requires an explicit linking step.

1. Start with `AUTH_METHODS=local` and confirm existing local login works.
2. Configure the provider client and its user/group assignments.
3. Change to `AUTH_METHODS=local,oidc` and restart Wealthboard.
4. Sign in locally as an existing user.
5. Open **Settings > Authentication methods**.
6. Confirm the local password and complete **Link <provider>**.
7. Repeat for every active user who must keep the existing portfolio.
8. Verify provider login returns each user to the existing portfolio.
9. Only after every active user is linked, change to `AUTH_METHODS=oidc` and
   restart.

OIDC-only startup/readiness fails when an active user lacks an identity for the
configured issuer. Local-only readiness similarly fails when an active user has
no password hash. Disable users deliberately or complete their method migration
before changing modes.

Do not let an existing local user click provider login before linking if the
goal is to retain the same portfolio. A first provider login creates a separate
internal user because claim matching is intentionally forbidden.

## End-to-end verification

### 1. Recheck discovery

```bash
curl --fail --silent --show-error \
  "$OIDC_ISSUER/.well-known/openid-configuration" \
  | jq -e --arg issuer "$OIDC_ISSUER" '
      .issuer == $issuer and
      (.id_token_signing_alg_values_supported | index("RS256") != null) and
      (.code_challenge_methods_supported | index("S256") != null) and
      (.token_endpoint_auth_methods_supported | index("client_secret_post") != null)
    '
```

This command prints `true` and exits successfully when the advertised protocol
features are compatible. Some providers omit optional metadata even when a
feature is supported; in that case verify the provider client settings and
perform the browser test before rollout.

### 2. Check readiness

```bash
curl --fail --silent --show-error \
  https://wealthboard.example.com/api/health/ready \
  | jq
```

Expected response:

```json
{ "status": "ready", "service": "wealthboard" }
```

In hybrid mode, readiness remains available during a temporary provider outage
so local login still works. The provider button reports temporary
unavailability. OIDC-only startup fails closed if discovery is unavailable or
invalid.

### 3. Test the browser flow

1. Use a private browser window.
2. Open `https://wealthboard.example.com/login`.
3. Select **Continue with <provider>**.
4. Authenticate at the provider.
5. Confirm the provider returns to the exact Wealthboard callback host.
6. Confirm Wealthboard opens the Overview page.
7. Log out of Wealthboard and repeat provider login.
8. Confirm the same portfolio is shown.
9. Test one disabled or unassigned provider user and confirm access is denied.
10. Test provider cancellation and confirm Wealthboard returns a generic error
    with a safe retry.

Wealthboard logout clears only the Wealthboard session. It does not terminate
the user's Keycloak or Okta SSO session, so another provider login may complete
without prompting for credentials. This is expected in the current release.

## Troubleshooting

### Provider button is missing

- Confirm `AUTH_METHODS` is exactly `oidc` or `local,oidc`.
- Restart Wealthboard after changing environment variables.
- Check startup logs for an authentication configuration error.

### Startup says an OIDC value is invalid or missing

- `APP_URL`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`,
  `OIDC_PROVIDER_NAME`, and `OIDC_TRANSACTION_SECRET` are all required when OIDC
  is enabled.
- `OIDC_TRANSACTION_SECRET` must be standard base64 encoding of exactly 32
  bytes. Generate it with `openssl rand -base64 32`.
- Production `APP_URL` and issuer values must use HTTPS.
- Remove query strings, fragments, and embedded credentials from both URLs.

### Provider sign-in is temporarily unavailable

- Fetch the discovery URL from the Wealthboard host or container.
- Verify DNS, TLS trust, firewall, and proxy egress.
- Confirm discovery returns the exact configured issuer.
- Confirm all discovered endpoints use public HTTPS URLs.
- For Keycloak behind a proxy, correct the Keycloak public hostname settings.

### Provider reports an invalid redirect URI

- Compare the provider registration with
  `${APP_URL}/api/auth/oidc/callback` character by character.
- Remove wildcard callbacks.
- Ensure the external scheme and host match `APP_URL`, not an internal service
  name.
- Do not add a trailing slash to the callback.

### Callback returns `invalid_callback`

- Confirm the browser accepted the short-lived OIDC transaction cookie.
- Confirm the callback uses a GET/query authorization-code response, not
  `form_post` or an implicit ID-token response.
- Check that reverse proxies preserve the public origin and do not rewrite the
  callback host.
- Confirm clocks on Wealthboard and the provider are synchronized.
- Confirm the ID token is signed with RS256 and contains the original nonce.
- Confirm the ID token audience is the configured client ID.

### Token exchange returns `invalid_client`

- Verify the client ID and secret.
- Verify the provider client is confidential.
- Verify the client accepts `client_secret_post`.
- In Keycloak, do not restrict the client to Basic-only authentication.
- In Okta, check `token_endpoint_auth_method` for imported or API-created apps.
- Rotate a suspected leaked secret, update Wealthboard, and restart it.

### Keycloak user can sign in without the access role

Client roles do not restrict Keycloak login by themselves. Use a dedicated
realm, restrict the user-federation source, or implement and test the
client-specific Browser Flow override described above.

### Okta user receives an assignment error

Open the Okta app's **Assignments** tab and assign the user or one of the user's
groups. Also verify any custom authorization-server access policy permits the
client and Authorization Code flow.

### Provider login created a second portfolio

This usually means an existing local user used provider login before explicitly
linking the identity. Return to hybrid mode, sign in to the intended local
account, and use **Settings > Authentication methods**. Do not attempt to merge
users by editing email, username, provider subject, or database rows.

### OIDC-only readiness fails after switching modes

At least one active local user has not linked the configured issuer. Return to
`local,oidc`, restart, link every active user, verify provider login, and then
retry OIDC-only mode.

## Secret and key rotation

### Provider client secret

1. Create or regenerate a provider client secret using the provider's supported
   rotation workflow.
2. Update `OIDC_CLIENT_SECRET` in the deployment secret store.
3. Restart Wealthboard so the validated server configuration reloads.
4. Test provider login.
5. Revoke the old provider secret after the new secret is confirmed.

Okta can support overlapping client secrets. Use that overlap for a no-downtime
rotation when available. Keycloak rotation capabilities vary by release and
policy; verify whether both secrets remain valid before relying on overlap.

### Provider signing keys

Keycloak and Okta publish signing keys through `jwks_uri`. Wealthboard caches
the remote JWKS and reloads it when it encounters a new key after the cooldown.
Keep old provider verification keys available long enough for already issued ID
tokens to expire during a planned rotation.

### OIDC transaction secret

Rotate `OIDC_TRANSACTION_SECRET` only through the Wealthboard deployment secret
store. Restart Wealthboard after changing it. In-progress provider logins and
five-minute reauthentication grants created with the old key will fail and must
be restarted. Existing Wealthboard sessions are not signed with this key.

## Security checklist

- Use HTTPS for Wealthboard and the provider in production.
- Register one exact callback URI and no wildcards.
- Use a confidential Web client and keep the client secret server-side.
- Require or allow PKCE S256.
- Use Authorization Code only.
- Use RS256 ID tokens.
- Restrict provider assignment to intended users or groups.
- Keep the provider issuer and subject stable.
- Never link or merge users by email or display claims.
- Store provider and transaction secrets outside source control.
- Test in `local,oidc` before enabling `oidc`.
- Keep local hashes and provider links during rollout so rollback remains
  possible.
- Monitor provider and Wealthboard authentication failures without logging
  codes, tokens, secrets, or claim payloads.

## Provider references

- [Keycloak Server Administration Guide](https://www.keycloak.org/docs/latest/server_admin/)
- [Keycloak OIDC client settings](https://www.keycloak.org/docs/latest/server_admin/#assembly-managing-clients_server_administration_guide)
- [Okta: Create OpenID Connect app integrations](https://help.okta.com/oie/en-us/content/topics/apps/apps_app_integration_wizard_oidc.htm)
- [Okta authorization servers](https://developer.okta.com/docs/concepts/auth-servers/)
- [Okta client authentication methods](https://developer.okta.com/docs/api/openapi/okta-oauth/guides/client-auth/)
- [Okta Dynamic Client Registration API](https://developer.okta.com/docs/api/openapi/okta-oauth/oauth/client)
