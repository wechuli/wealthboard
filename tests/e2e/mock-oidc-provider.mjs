import { createHash, randomUUID } from "node:crypto";
import http from "node:http";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

const host = "localhost";
const port = 4100;
const issuer = `http://${host}:${port}/realms/wealthboard`;
const clientId = "wealthboard-e2e";
const clientSecret = "wealthboard-e2e-client-secret";
const callbackUrl = "http://127.0.0.1:3100/api/auth/oidc/callback";
const identities = {
  alice: {
    subject: "e2e-oidc-alice",
    name: "OIDC Alice",
    preferredUsername: "oidc-collision",
  },
  bob: {
    subject: "e2e-oidc-bob",
    name: "OIDC Bob",
    preferredUsername: "oidc-bob",
  },
  link: {
    subject: "e2e-oidc-link",
    name: "Linked Identity",
    preferredUsername: "linked-identity",
  },
};
const authorizationRequests = new Map();
const authorizationCodes = new Map();
const { privateKey, publicKey } = await generateKeyPair("RS256");
const publicJwk = {
  ...(await exportJWK(publicKey)),
  kid: "e2e-key-1",
  alg: "RS256",
  use: "sig",
};

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(value));
}

function redirect(response, location) {
  response.writeHead(302, { Location: location, "Cache-Control": "no-store" });
  response.end();
}

function authorizationError(response, message) {
  response.writeHead(400, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(message);
}

async function requestBody(request, maximumBytes = 64 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maximumBytes) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function authorizationPage(response, requestId) {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(`<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>E2E Keycloak</title></head>
  <body>
    <main>
      <h1>E2E Keycloak</h1>
      <a href="/continue?id=${requestId}&identity=alice">Continue as OIDC Alice</a>
      <a href="/continue?id=${requestId}&identity=bob">Continue as OIDC Bob</a>
      <a href="/continue?id=${requestId}&identity=link">Continue as Link User</a>
      <a href="/continue?id=${requestId}&error=access_denied">Cancel sign in</a>
    </main>
  </body>
</html>`);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${host}:${port}`);

  if (request.method === "GET" && url.pathname === "/health") {
    return sendJson(response, 200, { status: "ok" });
  }
  if (
    request.method === "GET" &&
    url.pathname === "/realms/wealthboard/.well-known/openid-configuration"
  ) {
    return sendJson(response, 200, {
      issuer,
      authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
      token_endpoint: `${issuer}/protocol/openid-connect/token`,
      jwks_uri: `${issuer}/protocol/openid-connect/certs`,
      id_token_signing_alg_values_supported: ["RS256"],
    });
  }
  if (
    request.method === "GET" &&
    url.pathname === "/realms/wealthboard/protocol/openid-connect/certs"
  ) {
    return sendJson(response, 200, { keys: [publicJwk] });
  }
  if (
    request.method === "GET" &&
    url.pathname === "/realms/wealthboard/protocol/openid-connect/auth"
  ) {
    const values = Object.fromEntries(url.searchParams);
    if (
      values.client_id !== clientId ||
      values.response_type !== "code" ||
      values.redirect_uri !== callbackUrl ||
      values.scope !== "openid profile email" ||
      values.code_challenge_method !== "S256" ||
      !values.state ||
      !values.nonce ||
      !values.code_challenge
    ) {
      return authorizationError(response, "Invalid authorization request.");
    }
    const requestId = randomUUID();
    authorizationRequests.set(requestId, {
      state: values.state,
      nonce: values.nonce,
      challenge: values.code_challenge,
      redirectUri: values.redirect_uri,
    });
    return authorizationPage(response, requestId);
  }
  if (request.method === "GET" && url.pathname === "/continue") {
    const requestId = url.searchParams.get("id");
    const pending = requestId
      ? authorizationRequests.get(requestId)
      : undefined;
    if (!requestId || !pending) {
      return authorizationError(response, "Authorization request expired.");
    }
    authorizationRequests.delete(requestId);
    const callback = new URL(pending.redirectUri);
    callback.searchParams.set("state", pending.state);
    const providerError = url.searchParams.get("error");
    if (providerError) {
      callback.searchParams.set("error", providerError);
      return redirect(response, callback.toString());
    }
    const identity = identities[url.searchParams.get("identity")];
    if (!identity)
      return authorizationError(response, "Unknown test identity.");
    const code = randomUUID();
    authorizationCodes.set(code, { ...pending, identity, used: false });
    callback.searchParams.set("code", code);
    return redirect(response, callback.toString());
  }
  if (
    request.method === "POST" &&
    url.pathname === "/realms/wealthboard/protocol/openid-connect/token"
  ) {
    try {
      const values = new URLSearchParams(await requestBody(request));
      const code = values.get("code");
      const pending = code ? authorizationCodes.get(code) : undefined;
      if (
        !code ||
        !pending ||
        pending.used ||
        values.get("grant_type") !== "authorization_code" ||
        values.get("client_id") !== clientId ||
        values.get("client_secret") !== clientSecret ||
        values.get("redirect_uri") !== callbackUrl
      ) {
        return sendJson(response, 400, { error: "invalid_grant" });
      }
      const verifier = values.get("code_verifier") ?? "";
      const challenge = createHash("sha256")
        .update(verifier)
        .digest("base64url");
      if (challenge !== pending.challenge) {
        return sendJson(response, 400, { error: "invalid_grant" });
      }
      pending.used = true;
      const idToken = await new SignJWT({
        nonce: pending.nonce,
        name: pending.identity.name,
        preferred_username: pending.identity.preferredUsername,
        email: `${pending.identity.preferredUsername}@example.test`,
      })
        .setProtectedHeader({ alg: "RS256", kid: publicJwk.kid })
        .setIssuer(issuer)
        .setAudience(clientId)
        .setSubject(pending.identity.subject)
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey);
      return sendJson(response, 200, {
        token_type: "Bearer",
        expires_in: 300,
        id_token: idToken,
        access_token: "discarded-e2e-access-token",
        refresh_token: "discarded-e2e-refresh-token",
      });
    } catch {
      return sendJson(response, 400, { error: "invalid_request" });
    }
  }

  sendJson(response, 404, { error: "not_found" });
});

server.listen(port, () => {
  console.log(`Mock OIDC provider listening at ${issuer}`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
