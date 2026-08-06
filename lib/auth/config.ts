import "server-only";

import { z } from "zod";

export const AUTH_METHODS = ["local", "oidc"] as const;
export type AuthMethod = (typeof AUTH_METHODS)[number];

export type OidcAuthConfig = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  transactionSecret: Uint8Array;
  providerName: string;
  callbackUrl: string;
  scopes: readonly ["openid", "profile", "email"];
  algorithms: readonly ["RS256"];
};

export type AuthConfig = {
  methods: readonly AuthMethod[];
  localEnabled: boolean;
  oidcEnabled: boolean;
  appUrl?: string;
  oidc?: OidcAuthConfig;
};

export class AuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigurationError";
  }
}

const boundedValueSchema = z.string().trim().min(1).max(4096);
const providerNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value));

function configurationError(name: string, detail: string) {
  return new AuthConfigurationError(`${name} ${detail}`);
}

function parseMethods(value: string | undefined): readonly AuthMethod[] {
  const configured = value === undefined ? ["local"] : value.split(",");
  const methods: AuthMethod[] = [];
  for (const rawMethod of configured) {
    const method = rawMethod.trim();
    if (!AUTH_METHODS.includes(method as AuthMethod)) {
      throw configurationError(
        "AUTH_METHODS",
        "must be local, oidc, or local,oidc.",
      );
    }
    if (methods.includes(method as AuthMethod)) {
      throw configurationError("AUTH_METHODS", "must not contain duplicates.");
    }
    methods.push(method as AuthMethod);
  }
  if (!["local", "oidc", "local,oidc"].includes(methods.join(","))) {
    throw configurationError(
      "AUTH_METHODS",
      "must be local, oidc, or local,oidc.",
    );
  }
  return methods;
}

function isLocalDevelopmentUrl(url: URL) {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
}

function parseSecureUrl(
  name: string,
  value: string | undefined,
  options: { allowIssuerPath: boolean },
) {
  if (!value)
    throw configurationError(name, "is required when OIDC is enabled.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw configurationError(name, "must be an absolute URL.");
  }
  if (url.username || url.password) {
    throw configurationError(name, "must not contain credentials.");
  }
  if (url.search || url.hash) {
    throw configurationError(name, "must not contain a query or fragment.");
  }
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && isLocalDevelopmentUrl(url))
  ) {
    throw configurationError(
      name,
      "must use HTTPS outside localhost development.",
    );
  }
  if (!options.allowIssuerPath && url.pathname !== "/") {
    throw configurationError(name, "must not contain a path.");
  }
  if (options.allowIssuerPath && url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  return options.allowIssuerPath
    ? url.toString().replace(/\/$/, "")
    : url.origin;
}

function requiredBoundedValue(
  name: string,
  value: string | undefined,
  schema = boundedValueSchema,
) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw configurationError(
      name,
      "is required and has an invalid length or value.",
    );
  }
  return parsed.data;
}

function parseTransactionSecret(value: string | undefined) {
  const encoded = requiredBoundedValue("OIDC_TRANSACTION_SECRET", value);
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encoded)) {
    throw configurationError(
      "OIDC_TRANSACTION_SECRET",
      "must be a base64-encoded 32-byte value.",
    );
  }
  const secret = Buffer.from(encoded, "base64");
  if (secret.length !== 32 || secret.toString("base64") !== encoded) {
    throw configurationError(
      "OIDC_TRANSACTION_SECRET",
      "must be a base64-encoded 32-byte value.",
    );
  }
  return new Uint8Array(secret);
}

export function parseAuthConfig(
  environment: Record<string, string | undefined>,
): AuthConfig {
  const methods = parseMethods(environment.AUTH_METHODS);
  const localEnabled = methods.includes("local");
  const oidcEnabled = methods.includes("oidc");
  if (!oidcEnabled) return { methods, localEnabled, oidcEnabled };

  const appUrl = parseSecureUrl("APP_URL", environment.APP_URL, {
    allowIssuerPath: false,
  });
  const issuer = parseSecureUrl("OIDC_ISSUER", environment.OIDC_ISSUER, {
    allowIssuerPath: true,
  });
  const clientId = requiredBoundedValue(
    "OIDC_CLIENT_ID",
    environment.OIDC_CLIENT_ID,
  );
  const clientSecret = requiredBoundedValue(
    "OIDC_CLIENT_SECRET",
    environment.OIDC_CLIENT_SECRET,
  );
  const providerName = requiredBoundedValue(
    "OIDC_PROVIDER_NAME",
    environment.OIDC_PROVIDER_NAME,
    providerNameSchema,
  );
  const transactionSecret = parseTransactionSecret(
    environment.OIDC_TRANSACTION_SECRET,
  );

  return {
    methods,
    localEnabled,
    oidcEnabled,
    appUrl,
    oidc: {
      issuer,
      clientId,
      clientSecret,
      transactionSecret,
      providerName,
      callbackUrl: `${appUrl}/api/auth/oidc/callback`,
      scopes: ["openid", "profile", "email"],
      algorithms: ["RS256"],
    },
  };
}

let cachedAuthConfig: AuthConfig | undefined;

export function getAuthConfig() {
  cachedAuthConfig ??= parseAuthConfig(process.env);
  return cachedAuthConfig;
}
