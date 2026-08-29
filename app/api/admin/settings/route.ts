import { AdminRequiredError, requireAdmin } from "@/lib/server/auth";
import {
  getAdminSystemSettings,
  updateAdminSystemSettings,
  type AdminSystemSettingsUpdate,
} from "@/lib/server/system-settings";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const settings = await getAdminSystemSettings();
    const baseUrl = applicationBaseUrl(request);
    return Response.json({
      settings,
      callbacks: {
        github: `${baseUrl}/api/auth/oauth/github/callback`,
        linuxdo: `${baseUrl}/api/auth/oauth/linuxdo/callback`,
        epayNotify: `${baseUrl}/api/billing/topup/notify`,
        epayReturn: `${baseUrl}/api/billing/topup/return`,
      },
    });
  } catch (error) {
    return adminError(error);
  }
}

export async function PUT(request: Request) {
  try {
    await requireAdmin();
    const body = (await request.json()) as Record<string, unknown>;
    const settings = await updateAdminSystemSettings(parseUpdate(body));
    return Response.json({ settings });
  } catch (error) {
    return adminError(error);
  }
}

function parseUpdate(body: Record<string, unknown>): AdminSystemSettingsUpdate {
  return {
    registrationEnabled: booleanField(body, "registrationEnabled"),
    emailAuthEnabled: booleanField(body, "emailAuthEnabled"),
    emailVerificationEnabled: booleanField(body, "emailVerificationEnabled"),
    smtpHost: stringField(body, "smtpHost"),
    smtpPort: numberField(body, "smtpPort"),
    smtpSecure: booleanField(body, "smtpSecure"),
    smtpUsername: stringField(body, "smtpUsername"),
    smtpFrom: stringField(body, "smtpFrom"),
    smtpPassword: optionalStringField(body, "smtpPassword"),
    githubEnabled: booleanField(body, "githubEnabled"),
    githubClientId: stringField(body, "githubClientId"),
    githubClientSecret: optionalStringField(body, "githubClientSecret"),
    linuxdoEnabled: booleanField(body, "linuxdoEnabled"),
    linuxdoClientId: stringField(body, "linuxdoClientId"),
    linuxdoClientSecret: optionalStringField(body, "linuxdoClientSecret"),
    linuxdoMinimumTrustLevel: numberField(body, "linuxdoMinimumTrustLevel"),
    epayEnabled: booleanField(body, "epayEnabled"),
    epayGatewayUrl: stringField(body, "epayGatewayUrl"),
    epayMerchantId: stringField(body, "epayMerchantId"),
    epayMerchantKey: optionalStringField(body, "epayMerchantKey"),
    epayMethods: stringArrayField(body, "epayMethods"),
    epayMinimumAmount: stringOrNumberField(body, "epayMinimumAmount"),
    epayCreditRate: stringOrNumberField(body, "epayCreditRate"),
  };
}

function booleanField(body: Record<string, unknown>, field: string) {
  if (typeof body[field] !== "boolean") throw new Error("INVALID_SETTINGS_PAYLOAD");
  return body[field];
}

function stringField(body: Record<string, unknown>, field: string) {
  if (typeof body[field] !== "string") throw new Error("INVALID_SETTINGS_PAYLOAD");
  return body[field];
}

function optionalStringField(body: Record<string, unknown>, field: string) {
  const value = body[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error("INVALID_SETTINGS_PAYLOAD");
  return value;
}

function numberField(body: Record<string, unknown>, field: string) {
  if (typeof body[field] !== "number" || !Number.isFinite(body[field])) {
    throw new Error("INVALID_SETTINGS_PAYLOAD");
  }
  return body[field];
}

function stringOrNumberField(body: Record<string, unknown>, field: string) {
  const value = body[field];
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error("INVALID_SETTINGS_PAYLOAD");
  }
  return String(value);
}

function stringArrayField(body: Record<string, unknown>, field: string) {
  const value = body[field];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error("INVALID_SETTINGS_PAYLOAD");
  }
  return value;
}

function applicationBaseUrl(request: Request) {
  const configured = process.env.APP_BASE_URL?.trim();
  return (configured || new URL(request.url).origin).replace(/\/$/, "");
}

function adminError(error: unknown) {
  if (error instanceof AdminRequiredError) {
    return Response.json({ message: "仅管理员可以修改系统设置" }, { status: 403 });
  }
  return Response.json(
    { message: error instanceof Error ? error.message : "系统设置保存失败" },
    { status: 400 },
  );
}
