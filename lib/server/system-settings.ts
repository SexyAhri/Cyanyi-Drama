import { Prisma } from "@prisma/client";

import { decryptSecret, encryptSecret } from "./crypto";
import { prisma } from "./prisma";

const SETTINGS_ID = "global";
const DEFAULT_EPAY_METHODS = ["alipay", "wxpay"];

export type PublicAuthConfig = {
  registrationEnabled: boolean;
  emailAuthEnabled: boolean;
  emailVerificationEnabled: boolean;
  github: { enabled: boolean; clientId: string | null };
  linuxdo: { enabled: boolean; clientId: string | null };
};

export type AdminSystemSettingsView = {
  registrationEnabled: boolean;
  emailAuthEnabled: boolean;
  emailVerificationEnabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUsername: string;
  smtpFrom: string;
  smtpPasswordConfigured: boolean;
  githubEnabled: boolean;
  githubClientId: string;
  githubClientSecretConfigured: boolean;
  linuxdoEnabled: boolean;
  linuxdoClientId: string;
  linuxdoClientSecretConfigured: boolean;
  linuxdoMinimumTrustLevel: number;
  epayEnabled: boolean;
  epayGatewayUrl: string;
  epayMerchantId: string;
  epayMerchantKeyConfigured: boolean;
  epayMethods: string[];
  epayMinimumAmount: string;
  epayCreditRate: string;
};

export type AdminSystemSettingsUpdate = Omit<
  AdminSystemSettingsView,
  | "smtpPasswordConfigured"
  | "githubClientSecretConfigured"
  | "linuxdoClientSecretConfigured"
  | "epayMerchantKeyConfigured"
> & {
  smtpPassword?: string;
  githubClientSecret?: string;
  linuxdoClientSecret?: string;
  epayMerchantKey?: string;
};

export async function getPublicAuthConfig(): Promise<PublicAuthConfig> {
  const settings = await prisma.systemSettings.findUnique({
    where: { id: SETTINGS_ID },
  });
  if (!settings) return environmentAuthConfig();

  return {
    registrationEnabled: settings.registrationEnabled,
    emailAuthEnabled: settings.emailAuthEnabled,
    emailVerificationEnabled: settings.emailVerificationEnabled,
    github: {
      enabled: Boolean(
        settings.githubEnabled &&
        settings.githubClientId &&
        settings.githubClientSecretEncrypted,
      ),
      clientId: settings.githubClientId,
    },
    linuxdo: {
      enabled: Boolean(
        settings.linuxdoEnabled &&
        settings.linuxdoClientId &&
        settings.linuxdoClientSecretEncrypted,
      ),
      clientId: settings.linuxdoClientId,
    },
  };
}

export async function getEmailSmtpConfig() {
  const settings = await prisma.systemSettings.findUnique({
    where: { id: SETTINGS_ID },
  });
  const host =
    settings?.smtpHost?.trim() || process.env.EMAIL_SMTP_HOST?.trim();
  const username =
    settings?.smtpUsername?.trim() || process.env.EMAIL_SMTP_USER?.trim();
  const from =
    settings?.smtpFrom?.trim() || process.env.EMAIL_FROM?.trim() || username;
  const encryptedPassword = settings?.smtpPasswordEncrypted;
  const password = encryptedPassword
    ? decryptSecret(encryptedPassword)
    : process.env.EMAIL_SMTP_PASSWORD;
  const port = settings?.smtpPort ?? Number(process.env.EMAIL_SMTP_PORT || 465);
  const secure = settings
    ? settings.smtpSecure
    : process.env.EMAIL_SMTP_SECURE?.trim().toLowerCase() !== "false";

  if (!host || !from || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("EMAIL_SERVICE_NOT_CONFIGURED");
  }
  return {
    host,
    port,
    secure,
    from,
    auth: username && password ? { user: username, pass: password } : undefined,
  };
}

export async function getOAuthProviderConfig(provider: "github" | "linuxdo") {
  const settings = await prisma.systemSettings.findUnique({
    where: { id: SETTINGS_ID },
  });
  if (provider === "github") {
    const clientId =
      settings?.githubClientId?.trim() || process.env.GITHUB_CLIENT_ID?.trim();
    const secret = settings?.githubClientSecretEncrypted
      ? decryptSecret(settings.githubClientSecretEncrypted)
      : process.env.GITHUB_CLIENT_SECRET;
    const enabled = settings
      ? settings.githubEnabled
      : envBoolean("GITHUB_OAUTH_ENABLED");
    if (!enabled || !clientId || !secret) throw new Error("OAUTH_DISABLED");
    return { clientId, clientSecret: secret, minimumTrustLevel: 0 };
  }

  const clientId =
    settings?.linuxdoClientId?.trim() || process.env.LINUXDO_CLIENT_ID?.trim();
  const secret = settings?.linuxdoClientSecretEncrypted
    ? decryptSecret(settings.linuxdoClientSecretEncrypted)
    : process.env.LINUXDO_CLIENT_SECRET;
  const enabled = settings
    ? settings.linuxdoEnabled
    : envBoolean("LINUXDO_OAUTH_ENABLED");
  if (!enabled || !clientId || !secret) throw new Error("OAUTH_DISABLED");
  return {
    clientId,
    clientSecret: secret,
    minimumTrustLevel:
      settings?.linuxdoMinimumTrustLevel ??
      clampInteger(Number(process.env.LINUXDO_MINIMUM_TRUST_LEVEL || 0), 0, 4),
  };
}

export async function getEpayConfig(
  options: { requireEnabled?: boolean } = {},
) {
  const settings = await prisma.systemSettings.findUnique({
    where: { id: SETTINGS_ID },
  });
  const gatewayUrl =
    settings?.epayGatewayUrl?.trim() || process.env.EPAY_GATEWAY_URL?.trim();
  const merchantId =
    settings?.epayMerchantId?.trim() || process.env.EPAY_MERCHANT_ID?.trim();
  const merchantKey = settings?.epayMerchantKeyEncrypted
    ? decryptSecret(settings.epayMerchantKeyEncrypted)
    : process.env.EPAY_MERCHANT_KEY;
  const enabled = settings ? settings.epayEnabled : envBoolean("EPAY_ENABLED");
  if (
    (options.requireEnabled !== false && !enabled) ||
    !gatewayUrl ||
    !merchantId ||
    !merchantKey
  ) {
    throw new Error("EPAY_NOT_CONFIGURED");
  }
  return {
    gatewayUrl: normalizeHttpUrl(gatewayUrl),
    merchantId,
    merchantKey,
    enabled,
    methods: normalizeMethods(settings?.epayMethods),
    minimumAmount:
      settings?.epayMinimumAmount ??
      new Prisma.Decimal(process.env.EPAY_MINIMUM_AMOUNT || 1),
    creditRate:
      settings?.epayCreditRate ??
      new Prisma.Decimal(process.env.EPAY_CREDIT_RATE || 1),
  };
}

export async function getAdminSystemSettings(): Promise<AdminSystemSettingsView> {
  const settings = await prisma.systemSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID },
    update: {},
  });
  return {
    registrationEnabled: settings.registrationEnabled,
    emailAuthEnabled: settings.emailAuthEnabled,
    emailVerificationEnabled: settings.emailVerificationEnabled,
    smtpHost: settings.smtpHost ?? "",
    smtpPort: settings.smtpPort,
    smtpSecure: settings.smtpSecure,
    smtpUsername: settings.smtpUsername ?? "",
    smtpFrom: settings.smtpFrom ?? "",
    smtpPasswordConfigured: Boolean(settings.smtpPasswordEncrypted),
    githubEnabled: settings.githubEnabled,
    githubClientId: settings.githubClientId ?? "",
    githubClientSecretConfigured: Boolean(settings.githubClientSecretEncrypted),
    linuxdoEnabled: settings.linuxdoEnabled,
    linuxdoClientId: settings.linuxdoClientId ?? "",
    linuxdoClientSecretConfigured: Boolean(
      settings.linuxdoClientSecretEncrypted,
    ),
    linuxdoMinimumTrustLevel: settings.linuxdoMinimumTrustLevel,
    epayEnabled: settings.epayEnabled,
    epayGatewayUrl: settings.epayGatewayUrl ?? "",
    epayMerchantId: settings.epayMerchantId ?? "",
    epayMerchantKeyConfigured: Boolean(settings.epayMerchantKeyEncrypted),
    epayMethods: normalizeMethods(settings.epayMethods),
    epayMinimumAmount: settings.epayMinimumAmount.toString(),
    epayCreditRate: settings.epayCreditRate.toString(),
  };
}

export async function updateAdminSystemSettings(
  input: AdminSystemSettingsUpdate,
): Promise<AdminSystemSettingsView> {
  const current = await prisma.systemSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID },
    update: {},
  });
  const smtpHost = input.smtpHost.trim();
  const smtpUsername = input.smtpUsername.trim();
  const smtpFrom = input.smtpFrom.trim();
  const githubClientId = input.githubClientId.trim();
  const linuxdoClientId = input.linuxdoClientId.trim();
  const epayGatewayUrl = input.epayGatewayUrl.trim();
  const epayMerchantId = input.epayMerchantId.trim();
  const methods = normalizeMethods(input.epayMethods);
  const smtpPassword = input.smtpPassword?.trim();
  const githubSecret = input.githubClientSecret?.trim();
  const linuxdoSecret = input.linuxdoClientSecret?.trim();
  const epayKey = input.epayMerchantKey?.trim();
  const minimumAmount = positiveDecimal(
    input.epayMinimumAmount,
    "EPAY_MINIMUM_AMOUNT_INVALID",
  );
  const creditRate = positiveDecimal(
    input.epayCreditRate,
    "EPAY_CREDIT_RATE_INVALID",
  );

  if (
    !input.emailAuthEnabled &&
    !input.githubEnabled &&
    !input.linuxdoEnabled
  ) {
    throw new Error("AUTH_PROVIDER_REQUIRED");
  }
  if (
    input.emailVerificationEnabled &&
    (!smtpHost || !smtpFrom || !validPort(input.smtpPort))
  ) {
    throw new Error("SMTP_CONFIGURATION_REQUIRED");
  }
  if (
    input.emailVerificationEnabled &&
    smtpUsername &&
    !smtpPassword &&
    !current.smtpPasswordEncrypted
  ) {
    throw new Error("SMTP_PASSWORD_REQUIRED");
  }
  if (
    input.githubEnabled &&
    (!githubClientId || (!githubSecret && !current.githubClientSecretEncrypted))
  ) {
    throw new Error("GITHUB_CONFIGURATION_REQUIRED");
  }
  if (
    input.linuxdoEnabled &&
    (!linuxdoClientId ||
      (!linuxdoSecret && !current.linuxdoClientSecretEncrypted))
  ) {
    throw new Error("LINUXDO_CONFIGURATION_REQUIRED");
  }
  if (
    !Number.isInteger(input.linuxdoMinimumTrustLevel) ||
    input.linuxdoMinimumTrustLevel < 0 ||
    input.linuxdoMinimumTrustLevel > 4
  ) {
    throw new Error("LINUXDO_TRUST_LEVEL_INVALID");
  }
  if (
    input.epayEnabled &&
    (!epayGatewayUrl ||
      !epayMerchantId ||
      (!epayKey && !current.epayMerchantKeyEncrypted) ||
      methods.length === 0)
  ) {
    throw new Error("EPAY_CONFIGURATION_REQUIRED");
  }
  if (epayGatewayUrl) normalizeHttpUrl(epayGatewayUrl);

  await prisma.systemSettings.update({
    where: { id: SETTINGS_ID },
    data: {
      registrationEnabled: input.registrationEnabled,
      emailAuthEnabled: input.emailAuthEnabled,
      emailVerificationEnabled: input.emailVerificationEnabled,
      smtpHost: smtpHost || null,
      smtpPort: validPort(input.smtpPort) ? input.smtpPort : 465,
      smtpSecure: input.smtpSecure,
      smtpUsername: smtpUsername || null,
      smtpFrom: smtpFrom || null,
      ...(smtpPassword
        ? { smtpPasswordEncrypted: encryptSecret(smtpPassword) }
        : {}),
      githubEnabled: input.githubEnabled,
      githubClientId: githubClientId || null,
      ...(githubSecret
        ? { githubClientSecretEncrypted: encryptSecret(githubSecret) }
        : {}),
      linuxdoEnabled: input.linuxdoEnabled,
      linuxdoClientId: linuxdoClientId || null,
      ...(linuxdoSecret
        ? { linuxdoClientSecretEncrypted: encryptSecret(linuxdoSecret) }
        : {}),
      linuxdoMinimumTrustLevel: input.linuxdoMinimumTrustLevel,
      epayEnabled: input.epayEnabled,
      epayGatewayUrl: epayGatewayUrl ? normalizeHttpUrl(epayGatewayUrl) : null,
      epayMerchantId: epayMerchantId || null,
      ...(epayKey ? { epayMerchantKeyEncrypted: encryptSecret(epayKey) } : {}),
      epayMethods: methods,
      epayMinimumAmount: minimumAmount,
      epayCreditRate: creditRate,
    },
  });
  return getAdminSystemSettings();
}

function environmentAuthConfig(): PublicAuthConfig {
  const githubClientId = process.env.GITHUB_CLIENT_ID?.trim() || null;
  const linuxdoClientId = process.env.LINUXDO_CLIENT_ID?.trim() || null;
  return {
    registrationEnabled: process.env.REGISTRATION_ENABLED !== "false",
    emailAuthEnabled: process.env.EMAIL_AUTH_ENABLED !== "false",
    emailVerificationEnabled: envBoolean("EMAIL_VERIFICATION_ENABLED"),
    github: {
      enabled: Boolean(envBoolean("GITHUB_OAUTH_ENABLED") && githubClientId),
      clientId: githubClientId,
    },
    linuxdo: {
      enabled: Boolean(envBoolean("LINUXDO_OAUTH_ENABLED") && linuxdoClientId),
      clientId: linuxdoClientId,
    },
  };
}

function envBoolean(name: string) {
  return process.env[name]?.trim().toLowerCase() === "true";
}

function normalizeMethods(value: unknown): string[] {
  const source = Array.isArray(value) ? value : DEFAULT_EPAY_METHODS;
  return [
    ...new Set(
      source.flatMap((item) => {
        const method =
          typeof item === "string" ? item.trim().toLowerCase() : "";
        return /^[a-z0-9_-]{1,32}$/.test(method) ? [method] : [];
      }),
    ),
  ];
}

function normalizeHttpUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("HTTP_URL_REQUIRED");
  }
  return url.toString().replace(/\/$/, "");
}

function validPort(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= 65_535;
}

function clampInteger(value: number, min: number, max: number) {
  return Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : min;
}

function positiveDecimal(value: string, errorCode: string) {
  try {
    const decimal = new Prisma.Decimal(value);
    if (decimal.lte(0)) throw new Error(errorCode);
    return decimal;
  } catch {
    throw new Error(errorCode);
  }
}
