// @ts-check
import { join } from "path";
import { readFileSync } from "fs";
import express from "express";
import serveStatic from "serve-static";
import { Session } from "@shopify/shopify-api";

// Token-exchange constants (RFC 8693). We perform the exchange manually instead
// of shopify.api.auth.tokenExchange() because the installed library version
// does not send `expiring=1`, and Shopify now REJECTS non-expiring offline
// tokens on the Admin API ("Non-expiring access tokens are no longer accepted").
const TOKEN_EXCHANGE_GRANT_TYPE =
  "urn:ietf:params:oauth:grant-type:token-exchange";
const ID_TOKEN_SUBJECT_TYPE = "urn:ietf:params:oauth:token-type:id_token";
const OFFLINE_ACCESS_TOKEN_TYPE =
  "urn:shopify:params:oauth:token-type:offline-access-token";

import shopify from "./shopify.js";
import GDPRWebhookHandlers from "./gdpr.js";
import {
  PlanLookupError,
  getCouponLimit,
  getPlanSelectionUrl,
  getShopPlan,
} from "./app-pricing.js";
import {
  CouponValidationError,
  normalizeCouponInput,
  getCouponsState,
  writeCoupons,
  createDiscount,
  updateDiscount,
  deleteDiscount,
} from "./coupons.js";
import "./env.js";

/* -------------------------------------------------------------------------- */
/*                                  CONFIG                                    */
/* -------------------------------------------------------------------------- */

const PORT = parseInt(
  process.env.BACKEND_PORT || process.env.PORT || "3000",
  10
);

const STATIC_PATH =
  process.env.NODE_ENV === "production"
    ? `${process.cwd()}/frontend/dist`
    : `${process.cwd()}/frontend/`;

// The storefront block reads the shop's plan handle ("basic" | "pro" | "none")
// from this shop metafield to decide how many coupons to render.
const APP_NAMESPACE = "custom";
const APP_META_KEY = "mx-pdp-coupon";

const APP_INSTALL_METAFIELD = "mx-pdp-coupon-code-premium";

const AUTH_RETURN_TO_COOKIE = "coupon_strip_auth_return_to";

const APP_HOST = process.env.HOST?.trim();

const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

/* -------------------------------------------------------------------------- */
/*                               EXPRESS SERVER                               */
/* -------------------------------------------------------------------------- */

const app = express();
app.set("trust proxy", 1);

/* -------------------------------------------------------------------------- */
/*                           SHOPIFY WEBHOOKS                                 */
/* -------------------------------------------------------------------------- */

// Must be registered before any body parser. Shopify HMAC verification
// needs the raw request bytes; express.json() would consume the stream first.
app.post(
  shopify.config.webhooks.path,
  shopify.processWebhooks({
    webhookHandlers: {
      ...GDPRWebhookHandlers,
    },
  })
);

/* -------------------------------------------------------------------------- */
/*                              BODY PARSERS                                  */
/* -------------------------------------------------------------------------- */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const setAuthReturnToCookie = (res, returnPath) => {
  if (!returnPath) {
    return;
  }

  res.cookie(AUTH_RETURN_TO_COOKIE, encodeURIComponent(returnPath), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60 * 1000,
  });
};

const clearAuthReturnToCookie = (res) => {
  res.clearCookie(AUTH_RETURN_TO_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
};

const readAuthReturnToCookie = (req) => {
  const cookieHeader = req.headers.cookie || "";
  if (!cookieHeader) {
    return "";
  }

  const cookieValue = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${AUTH_RETURN_TO_COOKIE}=`))
    ?.slice(AUTH_RETURN_TO_COOKIE.length + 1);

  if (!cookieValue) {
    return "";
  }

  try {
    return sanitizeReturnPath(decodeURIComponent(cookieValue));
  } catch {
    return "";
  }
};

/* -------------------------------------------------------------------------- */
/*                              SHOPIFY AUTH                                  */
/* -------------------------------------------------------------------------- */

app.get(shopify.config.auth.path, (req, res, next) => {
  const returnPath = sanitizeReturnPath(req.query.returnTo);
  if (returnPath) {
    setAuthReturnToCookie(res, returnPath);
  }

  return shopify.auth.begin()(req, res, next);
});

app.get(shopify.config.auth.callbackPath, async (req, res) => {
  try {
    const callbackResponse = await shopify.api.auth.callback({
      rawRequest: req,
      rawResponse: res,
    });

    await shopify.config.sessionStorage.storeSession(callbackResponse.session);

    res.locals.shopify = {
      ...res.locals.shopify,
      session: callbackResponse.session,
    };

    // Compliance webhooks (customers/data_request, customers/redact,
    // shop/redact) and app/uninstalled are declared in shopify.app.toml and
    // managed by Shopify — they are NOT registerable via the Admin GraphQL
    // API. No manual webhook registration is needed here.

    const host = shopify.api.utils.sanitizeHost(req.query.host);
    const returnPath =
      sanitizeReturnPath(req.query.returnTo) || readAuthReturnToCookie(req);
    clearAuthReturnToCookie(res);
    let redirectUrl = await shopify.api.auth.getEmbeddedAppUrl({
      rawRequest: req,
      rawResponse: res,
    });

    redirectUrl = appendPathToEmbeddedUrl(redirectUrl, returnPath);

    if (host && !redirectUrl.includes("host=")) {
      const separator = redirectUrl.includes("?") ? "&" : "?";
      redirectUrl = `${redirectUrl}${separator}host=${encodeURIComponent(host)}`;
    }

    return res.redirect(redirectUrl);
  } catch (error) {
    console.error("[auth/callback] OAuth completion failed:", error);
    res.status(500).send(error instanceof Error ? error.message : String(error));
  }
});

/* -------------------------------------------------------------------------- */
/*                                UTILITIES                                   */
/* -------------------------------------------------------------------------- */

const createGraphQLClient = (session) =>
  new shopify.api.clients.Graphql({ session });

const handleError = (res, code, message) => {
  console.error(message);
  res.status(code).send({ error: message });
};

const getAppBaseUrl = (req) => {
  const forwardedProtocol = req.get("x-forwarded-proto");
  const forwardedHost = req.get("x-forwarded-host");
  const host = forwardedHost || req.get("host");
  const protocol = forwardedProtocol || req.protocol;

  if (host && protocol) {
    return `${protocol}://${host}`;
  }

  return APP_HOST || "";
};

const decodeBase64Url = (value) => {
  if (!value) return "";

  const normalized = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");

  try {
    return Buffer.from(normalized, "base64").toString("utf8");
  } catch {
    return "";
  }
};

const sanitizeReturnPath = (value) => {
  if (typeof value !== "string") return "";

  const trimmedValue = value.trim();
  if (!trimmedValue.startsWith("/")) return "";
  if (trimmedValue.startsWith("//")) return "";

  try {
    const parsed = new URL(trimmedValue, "https://coupon-strip.local");
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "";
  }
};

const appendPathToEmbeddedUrl = (embeddedUrl, returnPath) => {
  if (!returnPath) return embeddedUrl;

  try {
    const embedded = new URL(embeddedUrl);
    const destination = new URL(returnPath, `${embedded.origin}/`);
    destination.searchParams.forEach((value, key) => {
      if (!embedded.searchParams.has(key)) {
        embedded.searchParams.set(key, value);
      }
    });
    embedded.pathname = destination.pathname;
    return embedded.toString();
  } catch {
    return embeddedUrl;
  }
};

const getAppShellReturnPath = (req) => {
  if (req.method !== "GET") return "";
  if (req.path.startsWith("/api/")) return "";

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query || {})) {
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        if (typeof entry === "string") {
          query.append(key, entry);
        }
      });
      continue;
    }

    if (typeof value === "string") {
      query.set(key, value);
    }
  }

  const queryString = query.toString();
  return sanitizeReturnPath(
    `${req.path}${queryString ? `?${queryString}` : ""}`
  );
};

const getShopFromHostParam = (hostParam) => {
  const decodedHost = decodeBase64Url(hostParam);
  if (!decodedHost) return "";

  const adminStoreMatch = decodedHost.match(/\/store\/([^/?]+)/);
  if (adminStoreMatch?.[1]) {
    return `${adminStoreMatch[1]}.myshopify.com`;
  }

  const directShopMatch = decodedHost.match(
    /([a-z0-9][a-z0-9-]*\.myshopify\.com)/i
  );
  return directShopMatch?.[1] || "";
};

const loadSessionForShop = async (shop) => {
  if (!shop) return null;

  const offlineSessionId = shopify.api.session.getOfflineId(shop);
  const offlineSession =
    await shopify.config.sessionStorage.loadSession(offlineSessionId);

  if (offlineSession?.accessToken) {
    return offlineSession;
  }

  if (typeof shopify.config.sessionStorage.findSessionsByShop === "function") {
    const sessions =
      await shopify.config.sessionStorage.findSessionsByShop(shop);
    return (
      sessions.find((session) => !session.isOnline && session.accessToken) ||
      null
    );
  }

  return null;
};

const getBearerTokenFromRequest = (req) =>
  req.headers.authorization?.match(/Bearer (.*)/)?.[1] || "";

const exchangeOfflineTokenFromRequest = async (req, shop) => {
  const sessionToken = getBearerTokenFromRequest(req);
  if (!sessionToken || !shop) return null;

  try {
    // Validate the App Bridge session token (signature + claims) first.
    await shopify.api.session.decodeSessionToken(sessionToken);

    const cleanShop = shopify.api.utils.sanitizeShop(shop, true);
    const response = await fetch(
      `https://${cleanShop}/admin/oauth/access_token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_id: process.env.SHOPIFY_API_KEY,
          client_secret: process.env.SHOPIFY_API_SECRET,
          grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
          subject_token: sessionToken,
          subject_token_type: ID_TOKEN_SUBJECT_TYPE,
          requested_token_type: OFFLINE_ACCESS_TOKEN_TYPE,
          // REQUIRED: request an EXPIRING offline token (with refresh token).
          // Without this Shopify issues a non-expiring token that the Admin
          // API rejects with 403.
          expiring: "1",
        }),
      }
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.warn("[session] Token exchange failed:", {
        shop: cleanShop,
        status: response.status,
        body: body.slice(0, 300),
      });
      return null;
    }

    const data = await response.json();
    const expiresInSeconds = Number(data.expires_in);
    const session = new Session({
      id: shopify.api.session.getOfflineId(cleanShop),
      shop: cleanShop,
      state: "",
      isOnline: false,
      accessToken: data.access_token,
      scope: data.scope,
      expires:
        Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
          ? new Date(Date.now() + expiresInSeconds * 1000)
          : undefined,
    });

    await shopify.config.sessionStorage.storeSession(session);
    return session;
  } catch (error) {
    console.warn("[session] Token exchange failed:", {
      shop,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

const getShopFromRequest = async (req) => {
  const bearerToken = getBearerTokenFromRequest(req);

  if (bearerToken) {
    try {
      const payload = await shopify.api.session.decodeSessionToken(bearerToken);
      const tokenShop = payload?.dest?.replace("https://", "") || "";
      if (tokenShop) return tokenShop;
    } catch {
      // Fall through to query and host resolution.
    }
  }

  const queryShop =
    typeof req.query.shop === "string" ? req.query.shop.trim() : "";
  if (queryShop) return queryShop;

  const hostParam =
    typeof req.query.host === "string" ? req.query.host.trim() : "";
  return getShopFromHostParam(hostParam);
};

const resolveReauthShop = async (req, session) =>
  session?.shop || (await getShopFromRequest(req)) || "";

const sendReauthorizationRequired = async (req, res, session, extra = {}) => {
  const shop = await resolveReauthShop(req, session);
  return res.status(HTTP_STATUS.UNAUTHORIZED).json({
    needsReauth: true,
    shop,
    ...extra,
  });
};

// `plan` is "basic", "pro", or null (no active subscription).
const syncPlanMetafield = async (session, plan, options = {}) => {
  const { ensureInstallation = false, deleteInstallation = false } = options;

  try {
    if (ensureInstallation) {
      await MetafieldService.ensureAppMetafield(session);
    }

    if (deleteInstallation) {
      await MetafieldService.deleteAppMetafield(session);
    }

    await MetafieldService.setShopMetafield(session, plan);
    return { ok: true };
  } catch (error) {
    console.error("[metafield] Plan sync failed", {
      shop: session?.shop,
      plan,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

// The shop's App Pricing plan ("basic" | "pro" | null). The shop GID comes from
// the Admin API (the Partner API identifies shops by GID); callers that already
// hold it can pass it in to skip that request.
const resolveShopPlan = async (req, session, { shopGid, refresh = false } = {}) => {
  let resolvedSession = session;
  const gid =
    shopGid ||
    (await withSessionRefresh(req, session, async (nextSession) => {
      resolvedSession = nextSession;
      return MetafieldService.getShopGid(nextSession);
    }));

  const plan = await getShopPlan(resolvedSession.shop, gid, { refresh });
  return { session: resolvedSession, plan };
};

const handleApiError = async (req, res, session, err, contextLabel) => {
  // Shared context so no API/session failure is ever silent. Logging the
  // granted scopes disambiguates an under-scoped Admin token.
  const logContext = {
    shop: session?.shop,
    statusCode: getErrorStatusCode(err),
    name: err?.name,
    message: err instanceof Error ? err.message : String(err),
    grantedScopes: session?.scope,
  };

  // Partner API outage or throttling: fail closed with a retryable error rather
  // than treating a paying merchant as having no plan.
  if (err instanceof PlanLookupError) {
    console.error(`${contextLabel} failed (plan lookup)`, logContext);
    return res.status(HTTP_STATUS.SERVICE_UNAVAILABLE).json({
      error: "We couldn't check your plan right now. Please try again in a moment.",
    });
  }

  if (isForbiddenScopeError(err)) {
    console.error(
      `${contextLabel} forbidden — access token likely missing required scopes`,
      logContext
    );
    const reauthShop = await resolveReauthShop(req, session);
    return sendScopeReauthorizationRequired(res, reauthShop);
  }

  if (isUnauthorizedError(err)) {
    console.warn(
      `${contextLabel} unauthorized — requesting session reauthorization`,
      logContext
    );
    return sendReauthorizationRequired(req, res, session);
  }

  console.error(`${contextLabel} failed (unhandled)`, logContext);
  const error = err instanceof Error ? err : new Error(String(err));
  return handleError(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
};

const getSession = async (req, res) => {
  if (res?.locals?.shopify?.session) {
    return res.locals.shopify.session;
  }

  const shop = await getShopFromRequest(req);
  const sessionToken = getBearerTokenFromRequest(req);

  if (sessionToken && shop) {
    const exchangedSession = await exchangeOfflineTokenFromRequest(req, shop);
    if (exchangedSession?.accessToken) {
      return exchangedSession;
    }
  }

  const storedSession = await loadSessionForShop(shop);
  if (storedSession?.accessToken) {
    return storedSession;
  }

  return null;
};

const refreshSessionFromRequest = async (req, shop) => {
  const resolvedShop = shop || (await getShopFromRequest(req));
  if (!resolvedShop) return null;
  return exchangeOfflineTokenFromRequest(req, resolvedShop);
};

const withSessionRefresh = async (req, session, action) => {
  try {
    return await action(session);
  } catch (error) {
    if (!isUnauthorizedError(error)) {
      throw error;
    }

    const refreshedSession = await refreshSessionFromRequest(req, session?.shop);
    if (!refreshedSession?.accessToken) {
      throw error;
    }

    return action(refreshedSession);
  }
};

app.use((req, res, next) => {
  if (req.method !== "GET") return next();
  if (typeof req.query.shop === "string" && req.query.shop.trim()) return next();

  const hostParam =
    typeof req.query.host === "string" ? req.query.host.trim() : "";
  const shop = getShopFromHostParam(hostParam);

  if (!shop) return next();

  const redirectUrl = new URL(
    getAppBaseUrl(req) || `${req.protocol}://${req.get("host")}`
  );
  redirectUrl.pathname = req.path;

  for (const [key, value] of Object.entries(req.query)) {
    if (Array.isArray(value)) {
      value.forEach((entry) => redirectUrl.searchParams.append(key, entry));
    } else if (typeof value === "string") {
      redirectUrl.searchParams.set(key, value);
    }
  }

  redirectUrl.searchParams.set("shop", shop);
  return res.redirect(302, redirectUrl.toString());
});

const getErrorStatusCode = (err) => {
  const directStatusCode =
    err?.response?.code ||
    err?.response?.statusCode ||
    err?.response?.networkStatusCode ||
    err?.response?.response?.networkStatusCode ||
    err?.code ||
    err?.statusCode;

  if (typeof directStatusCode === "number") {
    return directStatusCode;
  }

  if (typeof directStatusCode === "string" && /^\d+$/.test(directStatusCode)) {
    return Number(directStatusCode);
  }

  if (Array.isArray(err?.errorData)) {
    for (const detail of err.errorData) {
      const nestedStatusCode =
        detail?.code ||
        detail?.statusCode ||
        detail?.networkStatusCode ||
        detail?.extensions?.code ||
        detail?.extensions?.statusCode ||
        detail?.extensions?.networkStatusCode ||
        detail?.response?.code ||
        detail?.response?.statusCode ||
        detail?.response?.networkStatusCode;

      if (typeof nestedStatusCode === "number") {
        return nestedStatusCode;
      }

      if (typeof nestedStatusCode === "string" && /^\d+$/.test(nestedStatusCode)) {
        return Number(nestedStatusCode);
      }
    }
  }

  if (typeof err?.message === "string") {
    const matchedStatusCode = err.message.match(/\b(401|403)\b/);
    if (matchedStatusCode) {
      return Number(matchedStatusCode[1]);
    }
  }

  return null;
};

const isUnauthorizedError = (err) => {
  const statusCode = getErrorStatusCode(err);
  if (statusCode === 401 || statusCode === 403) return true;

  if (typeof err?.message !== "string") return false;

  const message = err.message.toLowerCase();
  return (
    message.includes("401") ||
    message.includes("unauthorized") ||
    message.includes("403") ||
    message.includes("forbidden")
  );
};

const formatErrorDetails = (errorData = []) =>
  errorData
    .map((detail) => {
      if (typeof detail === "string") return detail;
      if (detail?.message) return detail.message;
      return "";
    })
    .filter(Boolean);

// A 403 from the Admin API (a GraphqlQueryError / HttpResponseError) usually
// means the Admin token is under-scoped. Surface it as an actionable
// reauth/approval prompt instead of looping silently through plain session
// reauthorization.
const isForbiddenScopeError = (err) => {
  const messageParts = [
    err?.message,
    ...(Array.isArray(err?.errorData) ? formatErrorDetails(err.errorData) : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  // Admin GraphQL access-scope denials (e.g. "Access denied for
  // discountCodeBasicCreate field. Required access: Apps must have
  // `write_discounts` access scope.") are returned as a NORMAL GraphQL error:
  // HTTP 200, errors array, no 403 status. Detect them by message so they route
  // to the reauthorization/approval flow (which re-grants the missing scope)
  // instead of surfacing the raw error to the merchant.
  const looksLikeMissingScope =
    (messageParts.includes("access denied") ||
      messageParts.includes("required access")) &&
    (messageParts.includes("scope") || messageParts.includes("write_discounts"));

  if (looksLikeMissingScope) return true;

  if (getErrorStatusCode(err) !== 403) return false;

  return (
    messageParts.includes("forbidden") ||
    messageParts.includes("scope") ||
    messageParts.includes("permission") ||
    messageParts.includes("access denied") ||
    messageParts.includes("not approved")
  );
};

const sendScopeReauthorizationRequired = (res, shop, details = []) =>
  res.status(HTTP_STATUS.UNAUTHORIZED).json({
    needsReauth: true,
    requiresScopes: true,
    shop,
    error:
      "This app needs fresh authorization with the required permissions. Approve access when prompted, then try again.",
    details,
  });

/* -------------------------------------------------------------------------- */
/*                            METAFIELD SERVICE                               */
/* -------------------------------------------------------------------------- */

const MetafieldService = {
  async getShopGid(session) {
    const client = createGraphQLClient(session);

    const query = `
      {
        shop {
          id
        }
      }
    `;

    const response = await client.request(query);
    const shopId = response?.shop?.id ?? response?.data?.shop?.id;

    if (!shopId) throw new Error("Shop ID not found");

    return shopId;
  },

  async setShopMetafield(session, plan) {
    const client = createGraphQLClient(session);

    const ownerId = await this.getShopGid(session);

    const value = plan || "none";

    const result = await client.request(CREATE_APP_DATA_METAFIELD, {
      variables: {
        metafieldsSetInput: [
          {
            ownerId,
            namespace: APP_NAMESPACE,
            key: APP_META_KEY,
            type: "single_line_text_field",
            value,
          },
        ],
      },
    });

    const errors =
      result?.metafieldsSet?.userErrors ||
      result?.data?.metafieldsSet?.userErrors ||
      [];

    if (errors.length) {
      console.error("Metafield set error:", errors);
    }
  },

  async ensureAppMetafield(session) {
    const client = createGraphQLClient(session);

    const installation = await client.request(CURRENT_APP_INSTALLATION, {
      variables: { namespace: APP_NAMESPACE, key: APP_INSTALL_METAFIELD },
    });

    const ownerId = installation?.currentAppInstallation?.id;
    const existing = installation?.currentAppInstallation?.metafield;

    if (!existing && ownerId) {
      await client.request(CREATE_APP_DATA_METAFIELD, {
        variables: {
          metafieldsSetInput: [
            {
              namespace: APP_NAMESPACE,
              key: APP_INSTALL_METAFIELD,
              type: "boolean",
              value: "true",
              ownerId,
            },
          ],
        },
      });
    }
  },

  async deleteAppMetafield(session) {
    const client = createGraphQLClient(session);

    const installation = await client.request(CURRENT_APP_INSTALLATION, {
      variables: { namespace: APP_NAMESPACE, key: APP_INSTALL_METAFIELD },
    });

    const ownerId = installation?.currentAppInstallation?.id;
    const existing = installation?.currentAppInstallation?.metafield;

    if (ownerId && existing) {
      await client.request(APP_OWNED_METAFIELD_DELETE, {
        variables: {
          ownerId,
          namespace: APP_NAMESPACE,
          key: APP_INSTALL_METAFIELD,
        },
      });
    }
  },
};

/* -------------------------------------------------------------------------- */
/*                                SHOP INFO                                   */
/* -------------------------------------------------------------------------- */

app.get("/api/getshop", shopify.validateAuthenticatedSession(), async (req, res) => {
  const session = await getSession(req, res);
  res.json({ shop: session?.shop || null });
});

/* -------------------------------------------------------------------------- */
/*                              COUPONS (DISCOUNTS)                           */
/* -------------------------------------------------------------------------- */

const generateCouponId = () =>
  `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const buildCouponsPayload = (coupons, currency, plan) => ({
  coupons,
  plan,
  limit: getCouponLimit(plan),
  currency,
});

class PlanRequiredError extends Error {
  constructor() {
    super("Choose a plan to create or edit coupons.");
    this.name = "PlanRequiredError";
  }
}

// CouponValidationError -> 400 (bad input / Shopify userError like duplicate
// code). No plan -> 402 with the plan selection URL. A plan-limit hit -> 403
// with upsell flag. Everything else (incl. a 403 from a token missing
// write_discounts) flows through the shared API error handler, which converts
// unauthorized/scope errors into a reauth prompt.
const handleCouponError = (req, res, session, err, contextLabel) => {
  if (err instanceof CouponValidationError) {
    return handleError(res, HTTP_STATUS.BAD_REQUEST, err.message);
  }

  if (err instanceof PlanRequiredError) {
    return res.status(HTTP_STATUS.PAYMENT_REQUIRED).json({
      error: err.message,
      needsPlan: true,
      planSelectionUrl: getPlanSelectionUrl(session?.shop),
    });
  }

  if (err?.upsell) {
    console.warn(`${contextLabel} blocked by plan limit`, {
      shop: session?.shop,
      message: err.message,
    });
    return res.status(403).json({ error: err.message, upsell: true });
  }

  return handleApiError(req, res, session, err, contextLabel);
};

// Resolve the session WITHOUT shopify.validateAuthenticatedSession(): that
// middleware requires session.isActive(api.config.scopes) — an exact scope
// match — so adding write_discounts to the config 403-loops every stored token
// that predates the new scope. We still authenticate: require a present, valid App Bridge bearer
// token (so an unauthenticated ?shop= request can't fall through to a stored
// session), then let getSession do the manual expiring-token exchange.
const resolveCouponSession = async (req, res) => {
  const bearerToken = getBearerTokenFromRequest(req);
  if (!bearerToken) {
    await sendReauthorizationRequired(req, res, null, {
      error:
        "Authentication context is missing. Reopen the app from Shopify admin and try again.",
    });
    return null;
  }

  try {
    await shopify.api.session.decodeSessionToken(bearerToken);
  } catch {
    await sendReauthorizationRequired(req, res, null, {
      error:
        "Your session expired. Reopen the app from Shopify admin and try again.",
    });
    return null;
  }

  const session = await getSession(req, res);
  if (!session) {
    await sendReauthorizationRequired(req, res, session, {
      error:
        "Authentication context is missing. Reopen the app from Shopify admin and try again.",
    });
    return null;
  }
  return session;
};

/* -------------------------------------------------------------------------- */
/*                                   PLAN                                     */
/* -------------------------------------------------------------------------- */

// The frontend gates the whole app on this. `?refresh=1` skips the plan cache
// (used when the merchant lands back from Shopify's plan selection page). The
// plan is mirrored into the shop metafield the storefront block reads.
app.get("/api/plan", async (req, res) => {
  let session = await resolveCouponSession(req, res);
  if (!session) return undefined;

  try {
    const resolved = await resolveShopPlan(req, session, {
      refresh: req.query.refresh === "1",
    });
    session = resolved.session;
    const { plan } = resolved;

    const metafieldSync = await syncPlanMetafield(session, plan, {
      ensureInstallation: !!plan,
      deleteInstallation: !plan,
    });

    return res.json({
      plan,
      hasActiveSubscription: !!plan,
      limit: getCouponLimit(plan),
      planSelectionUrl: getPlanSelectionUrl(session.shop),
      metafieldSync,
    });
  } catch (err) {
    return handleApiError(req, res, session, err, "Plan check");
  }
});

app.get(
  "/api/coupons",
  async (req, res) => {
    let session = await resolveCouponSession(req, res);
    if (!session) return undefined;

    try {
      const payload = await withSessionRefresh(req, session, async (s) => {
        session = s;
        const state = await getCouponsState(s);
        const plan = await getShopPlan(s.shop, state.shopGid);
        return buildCouponsPayload(state.coupons, state.currency, plan);
      });
      return res.json(payload);
    } catch (err) {
      return handleCouponError(req, res, session, err, "Coupon list");
    }
  }
);

app.post(
  "/api/coupons",
  async (req, res) => {
    let session = await resolveCouponSession(req, res);
    if (!session) return undefined;

    let coupon;
    try {
      coupon = normalizeCouponInput(req.body);
    } catch (err) {
      return handleCouponError(req, res, session, err, "Coupon create");
    }

    try {
      const payload = await withSessionRefresh(req, session, async (s) => {
        session = s;
        const state = await getCouponsState(s);

        if (state.coupons.some((existing) => existing.code === coupon.code)) {
          throw new CouponValidationError(
            `A coupon with code "${coupon.code}" already exists.`
          );
        }

        const plan = await getShopPlan(s.shop, state.shopGid);
        if (!plan) throw new PlanRequiredError();

        const limit = getCouponLimit(plan);
        if (state.coupons.length >= limit) {
          const limitError = new Error(
            `You've reached your plan limit of ${limit} coupons. Upgrade to add more.`
          );
          limitError.upsell = true;
          throw limitError;
        }

        const { discountGid, code } = await createDiscount(s, coupon);
        const entry = {
          id: generateCouponId(),
          code,
          title: coupon.title,
          type: coupon.type,
          value: coupon.value,
          minSubtotal: coupon.minSubtotal,
          discountGid,
          status: "active",
        };
        const coupons = [...state.coupons, entry];
        await writeCoupons(s, state.shopGid, coupons);
        return buildCouponsPayload(coupons, state.currency, plan);
      });

      return res.json(payload);
    } catch (err) {
      return handleCouponError(req, res, session, err, "Coupon create");
    }
  }
);

app.put(
  "/api/coupons/:id",
  async (req, res) => {
    let session = await resolveCouponSession(req, res);
    if (!session) return undefined;

    let coupon;
    try {
      coupon = normalizeCouponInput(req.body);
    } catch (err) {
      return handleCouponError(req, res, session, err, "Coupon update");
    }

    try {
      const payload = await withSessionRefresh(req, session, async (s) => {
        session = s;
        const state = await getCouponsState(s);
        const index = state.coupons.findIndex(
          (existing) => existing.id === req.params.id
        );

        if (index === -1) {
          throw new CouponValidationError("This coupon no longer exists.");
        }

        if (
          state.coupons.some(
            (existing, i) => i !== index && existing.code === coupon.code
          )
        ) {
          throw new CouponValidationError(
            `A coupon with code "${coupon.code}" already exists.`
          );
        }

        const plan = await getShopPlan(s.shop, state.shopGid);
        if (!plan) throw new PlanRequiredError();

        const existing = state.coupons[index];
        const { discountGid, code } = await updateDiscount(s, existing, coupon);
        const updated = {
          ...existing,
          code,
          title: coupon.title,
          type: coupon.type,
          value: coupon.value,
          minSubtotal: coupon.minSubtotal,
          discountGid,
          status: "active",
        };
        const coupons = state.coupons.map((entry, i) =>
          i === index ? updated : entry
        );
        await writeCoupons(s, state.shopGid, coupons);
        return buildCouponsPayload(coupons, state.currency, plan);
      });

      return res.json(payload);
    } catch (err) {
      return handleCouponError(req, res, session, err, "Coupon update");
    }
  }
);

app.delete(
  "/api/coupons/:id",
  async (req, res) => {
    let session = await resolveCouponSession(req, res);
    if (!session) return undefined;

    try {
      const payload = await withSessionRefresh(req, session, async (s) => {
        session = s;
        const state = await getCouponsState(s);
        const existing = state.coupons.find(
          (entry) => entry.id === req.params.id
        );

        // Deleting needs no plan, so a merchant without one can still clean up.
        const plan = await getShopPlan(s.shop, state.shopGid);

        if (!existing) {
          return buildCouponsPayload(state.coupons, state.currency, plan);
        }

        await deleteDiscount(s, existing.discountGid);
        const coupons = state.coupons.filter(
          (entry) => entry.id !== req.params.id
        );
        await writeCoupons(s, state.shopGid, coupons);
        return buildCouponsPayload(coupons, state.currency, plan);
      });

      return res.json(payload);
    } catch (err) {
      return handleCouponError(req, res, session, err, "Coupon delete");
    }
  }
);

/* -------------------------------------------------------------------------- */
/*                              FRONTEND SERVING                              */
/* -------------------------------------------------------------------------- */

app.use(shopify.cspHeaders());

app.use(serveStatic(STATIC_PATH, { index: false }));

app.use("/*", (req, res, next) => {
  const returnPath = getAppShellReturnPath(req);
  if (returnPath) {
    setAuthReturnToCookie(res, returnPath);
  }

  next();
});

// Serve the SPA shell unconditionally. The HTML holds no secrets — it boots
// App Bridge, which mints a session token that the backend exchanges for an
// offline token on the first API call (see getSession ->
// exchangeOfflineTokenFromRequest). Gating the document request on
// ensureInstalledOnShop() caused an OAuth reload loop whenever Shopify loaded
// the embedded iframe without a resolvable shop param. First install still
// runs through Shopify's managed OAuth callback (/api/auth/callback).
app.use("/*", async (_req, res) => {
  res
    .status(200)
    .set("Content-Type", "text/html")
    .send(readFileSync(join(STATIC_PATH, "index.html")));
});

app.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`)
);

/* -------------------------------------------------------------------------- */
/*                                GRAPHQL                                     */
/* -------------------------------------------------------------------------- */

const CURRENT_APP_INSTALLATION = `
query appSubscription($namespace: String!, $key: String!) {
  currentAppInstallation {
    id
    metafield(namespace: $namespace, key: $key) {
      namespace
      key
      value
      id
    }
  }
}
`;

const CREATE_APP_DATA_METAFIELD = `
mutation CreateAppDataMetafield($metafieldsSetInput: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafieldsSetInput) {
    metafields { id namespace key }
    userErrors { field message }
  }
}
`;

const APP_OWNED_METAFIELD_DELETE = `
mutation appOwnedMetafieldDelete($ownerId: ID!, $namespace: String!, $key: String!) {
  appOwnedMetafieldDelete(ownerId: $ownerId, namespace: $namespace, key: $key) {
    deletedId
    userErrors { field message }
  }
}
`;
