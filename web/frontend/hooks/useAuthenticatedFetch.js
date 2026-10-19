const RETURN_TO_STORAGE_KEY = "couponStrip:returnTo";
const REAUTH_GUARD_STORAGE_KEY = "couponStrip:reauthGuard";
const REAUTH_GUARD_WINDOW_MS = 60000;

/**
 * Auth-aware fetch for App Bridge v4.
 *
 * v3's authenticatedFetch(app) is gone. v4 exposes shopify.idToken(), which
 * mints a fresh session token per call, so we attach it explicitly rather than
 * relying on App Bridge's implicit fetch patching. The backend reads it via
 * getBearerTokenFromRequest and exchanges it for an offline token.
 *
 * Behaviour preserved from the v3 hook:
 * 1. Retry once on 401 before the heavy full-page reauthorization redirect.
 * 2. Honour the X-Shopify-API-Request-Failure-Reauthorize header.
 * 3. Honour backend JSON responses carrying { needsReauth: true }.
 * 4. Guard against several concurrent 401s each firing their own redirect.
 */
export class ReauthorizationInProgressError extends Error {
  constructor(message = "Shopify authentication is being restored.") {
    super(message);
    this.name = "ReauthorizationInProgressError";
  }
}

export const isReauthorizationInProgressError = (error) =>
  error instanceof ReauthorizationInProgressError ||
  error?.name === "ReauthorizationInProgressError";

export const hasRecentReauthAttempt = () => !!getRecentReauthAttempt();

/** Navigate the top-level window, escaping the embedded iframe. */
export function redirectTopLevel(url) {
  open(url, "_top");
}

async function sessionTokenFetch(uri, options = {}) {
  const headers = new Headers(options.headers || {});

  try {
    const token = await window.shopify.idToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  } catch {
    // Leave the header off. The backend answers 401 + needsReauth and the flow
    // below converts that into a reauthorization redirect.
  }

  return fetch(uri, { ...options, headers });
}

export function useAuthenticatedFetch() {
  return async (uri, options = {}) => {
    const fetchOptions = options || {};
    let response = await sessionTokenFetch(uri, fetchOptions);

    if (response.ok) {
      clearRecentReauthAttempt();
      return response;
    }

    // A 401 is usually just a stale session token. idToken() mints a fresh one
    // per call, so retry once silently. A 401 means the request was rejected
    // before the handler ran, so retrying a POST cannot double-apply a mutation.
    if (shouldRetryBeforeReauth(response)) {
      const retryResponse = await sessionTokenFetch(uri, fetchOptions);
      if (retryResponse.ok) {
        clearRecentReauthAttempt();
        return retryResponse;
      }
      response = retryResponse;
    }

    if (await checkHeadersForReauthorization(response)) {
      throw new ReauthorizationInProgressError();
    }

    if (await checkJsonForReauthorization(response)) {
      throw new ReauthorizationInProgressError();
    }

    return response;
  };
}

function shouldRetryBeforeReauth(response) {
  return (
    response.status === 401 ||
    response.headers.get("X-Shopify-API-Request-Failure-Reauthorize") === "1"
  );
}

async function checkHeadersForReauthorization(response) {
  if (
    response.headers.get("X-Shopify-API-Request-Failure-Reauthorize") !== "1"
  ) {
    return false;
  }

  const authUrlHeader =
    response.headers.get("X-Shopify-API-Request-Failure-Reauthorize-Url") ||
    "/api/auth";

  return beginReauthorization({
    authUrl: authUrlHeader,
    shop: getCurrentShop(),
    reason: "session",
  });
}

async function checkJsonForReauthorization(response) {
  if (response.status !== 401) return false;

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) return false;

  try {
    const data = await response.clone().json();
    if (!data?.needsReauth) return false;

    return beginReauthorization({
      authUrl: "/api/auth",
      shop: data.shop || getCurrentShop(),
      reason: data.requiresScopes ? "scopes" : "session",
    });
  } catch {
    return false;
  }
}

function beginReauthorization({ authUrl, shop, reason }) {
  const currentRoute = getCurrentRoute();
  const currentHost = getCurrentHost();
  const resolvedAuthUrl = new URL(authUrl, `https://${window.location.host}`);
  const resolvedShop =
    shop || resolvedAuthUrl.searchParams.get("shop") || getCurrentShop();

  if (!resolvedShop) return false;

  // If any reauthorization is already in flight within the guard window, do not
  // fire another full-page redirect. This is what prevents the OAuth reload
  // loop when several API calls 401 at once.
  if (getRecentReauthAttempt()) return true;

  window.sessionStorage.setItem(RETURN_TO_STORAGE_KEY, currentRoute);

  rememberReauthAttempt({ reason, route: currentRoute });

  if (!resolvedAuthUrl.searchParams.has("shop")) {
    resolvedAuthUrl.searchParams.set("shop", resolvedShop);
  }
  if (!resolvedAuthUrl.searchParams.has("returnTo")) {
    resolvedAuthUrl.searchParams.set("returnTo", currentRoute);
  }
  if (currentHost && !resolvedAuthUrl.searchParams.has("host")) {
    resolvedAuthUrl.searchParams.set("host", currentHost);
  }

  // v4 replacement for Redirect.dispatch(Redirect.Action.REMOTE, url):
  // break out of the iframe so Shopify's OAuth screen renders top-level.
  redirectTopLevel(resolvedAuthUrl.toString());
  return true;
}

function getCurrentRoute() {
  return `${window.location.pathname}${window.location.search}`;
}

function decodeHost(host) {
  if (!host) return "";

  try {
    return atob(host.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    return "";
  }
}

function getCurrentHost() {
  const qs = new URLSearchParams(window.location.search);
  return (
    qs.get("host") ||
    window.shopify?.config?.host ||
    window.__SHOPIFY_DEV_HOST ||
    ""
  );
}

function getCurrentShop() {
  const qs = new URLSearchParams(window.location.search);
  const fromUrl = qs.get("shop");
  if (fromUrl) return fromUrl;

  // v4 exposes the shop directly, which is more reliable than decoding host.
  const fromAppBridge = window.shopify?.config?.shop;
  if (fromAppBridge) return fromAppBridge;

  const decoded = decodeHost(getCurrentHost());
  if (!decoded) return "";

  const adminStoreMatch = decoded.match(/\/store\/([^/?]+)/);
  if (adminStoreMatch?.[1]) return `${adminStoreMatch[1]}.myshopify.com`;

  const directShopMatch = decoded.match(/([a-z0-9][a-z0-9-]*\.myshopify\.com)/i);
  return directShopMatch?.[1] || "";
}

function getRecentReauthAttempt() {
  const rawValue = window.sessionStorage.getItem(REAUTH_GUARD_STORAGE_KEY);
  if (!rawValue) return null;

  try {
    const parsed = JSON.parse(rawValue);
    if (!parsed?.startedAt || !parsed?.reason || !parsed?.route) {
      window.sessionStorage.removeItem(REAUTH_GUARD_STORAGE_KEY);
      return null;
    }

    if (Date.now() - parsed.startedAt > REAUTH_GUARD_WINDOW_MS) {
      window.sessionStorage.removeItem(REAUTH_GUARD_STORAGE_KEY);
      return null;
    }

    return parsed;
  } catch {
    window.sessionStorage.removeItem(REAUTH_GUARD_STORAGE_KEY);
    return null;
  }
}

function rememberReauthAttempt({ reason, route }) {
  window.sessionStorage.setItem(
    REAUTH_GUARD_STORAGE_KEY,
    JSON.stringify({ reason, route, startedAt: Date.now() })
  );
}

function clearRecentReauthAttempt() {
  window.sessionStorage.removeItem(REAUTH_GUARD_STORAGE_KEY);
}
