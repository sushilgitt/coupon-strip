import "./env.js";

// Shopify App Pricing (formerly "managed pricing"). Plans, prices and trials
// live in the Partner Dashboard and Shopify hosts the plan selection page, so
// this app never creates charges. It only asks the Partner API which plan a shop
// is on (activeSubscription) and maps the plan handle to a coupon limit.
// https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing
//
// There is no free plan: a shop without an active subscription is sent to the
// plan selection page and the storefront block renders nothing.

// Partner Dashboard plan handle -> coupons the plan allows.
export const PLAN_COUPON_LIMITS = { basic: 3, pro: 6 };
const HIGHEST_PLAN = "pro";

const PARTNER_API_VERSION = process.env.PARTNER_API_VERSION?.trim() || "2026-07";
const PARTNER_ORG_ID = process.env.PARTNER_ORG_ID?.trim();
const PARTNER_API_ACCESS_TOKEN = process.env.PARTNER_API_ACCESS_TOKEN?.trim();
const SHOPIFY_APP_ID = process.env.SHOPIFY_APP_ID?.trim();
const SHOPIFY_APP_HANDLE = process.env.SHOPIFY_APP_HANDLE?.trim();

// The Partner API allows 4 requests/second per API client, shared across every
// shop, so plan lookups are cached briefly per shop and concurrent lookups for
// the same shop share one request.
const PLAN_CACHE_TTL_MS = 5 * 60 * 1000;
const planCache = new Map();
const inFlightLookups = new Map();

const missingConfig = [
  ["PARTNER_ORG_ID", PARTNER_ORG_ID],
  ["PARTNER_API_ACCESS_TOKEN", PARTNER_API_ACCESS_TOKEN],
  ["SHOPIFY_APP_ID", SHOPIFY_APP_ID],
  ["SHOPIFY_APP_HANDLE", SHOPIFY_APP_HANDLE],
]
  .filter(([, value]) => !value)
  .map(([name]) => name);

if (missingConfig.length) {
  throw new Error(
    `Missing Shopify App Pricing configuration: ${missingConfig.join(", ")}.`
  );
}

// Accept either the numeric app ID from the Partner Dashboard URL or a full GID.
const APP_GID = SHOPIFY_APP_ID.startsWith("gid://")
  ? SHOPIFY_APP_ID
  : `gid://shopify/App/${SHOPIFY_APP_ID}`;

const PARTNER_API_URL = `https://partners.shopify.com/${PARTNER_ORG_ID}/api/${PARTNER_API_VERSION}/graphql.json`;

export class PlanLookupError extends Error {
  constructor(message) {
    super(message);
    this.name = "PlanLookupError";
  }
}

export const getCouponLimit = (plan) => PLAN_COUPON_LIMITS[plan] ?? 0;

// Shopify-hosted plan selection page. It sits outside the app iframe, so the
// frontend must open it with target "_top".
export const getPlanSelectionUrl = (shop) => {
  const storeHandle = String(shop || "").replace(/\.myshopify\.com$/i, "");
  return `https://admin.shopify.com/store/${storeHandle}/charges/${SHOPIFY_APP_HANDLE}/pricing_plans`;
};

// Throws PlanLookupError on throttling or any failed response, so a Partner API
// outage never sends a paying merchant to the plan selection page.
const fetchActiveSubscription = async (shopGid) => {
  const response = await fetch(PARTNER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": PARTNER_API_ACCESS_TOKEN,
    },
    body: JSON.stringify({
      query: ACTIVE_SUBSCRIPTION_QUERY,
      variables: { appId: APP_GID, shopId: shopGid },
    }),
  });

  const body = await response.json().catch(() => null);

  if (!response.ok || !body || body.errors?.length) {
    throw new PlanLookupError(
      `Partner API activeSubscription failed (HTTP ${response.status}): ${
        body?.errors?.[0]?.message || "no response body"
      }`
    );
  }

  return body.data?.activeSubscription || null;
};

// A subscription made before the switch to App Pricing (the old Billing API
// "Premium" plans) has no basic/pro handle. Those merchants paid for the 6-coupon
// tier, so any unrecognised active subscription maps to the highest plan.
const getPlanFromSubscription = (subscription, shop) => {
  if (!subscription) return null;

  const handles = (subscription.items || []).map((item) => item?.handle);
  if (handles.includes("pro")) return "pro";
  if (handles.includes("basic")) return "basic";

  console.warn("[pricing] Active subscription has no known plan handle", {
    shop,
    handles,
  });
  return HIGHEST_PLAN;
};

// Returns "basic", "pro", or null when the shop has no active subscription.
// `refresh` bypasses the cache, e.g. right after the merchant picks a plan.
export const getShopPlan = async (shop, shopGid, { refresh = false } = {}) => {
  const cached = planCache.get(shop);
  if (!refresh && cached && cached.expiresAt > Date.now()) {
    return cached.plan;
  }

  if (!refresh && inFlightLookups.has(shop)) {
    return inFlightLookups.get(shop);
  }

  const lookup = fetchActiveSubscription(shopGid)
    .then((subscription) => {
      const plan = getPlanFromSubscription(subscription, shop);
      planCache.set(shop, { plan, expiresAt: Date.now() + PLAN_CACHE_TTL_MS });
      return plan;
    })
    .finally(() => inFlightLookups.delete(shop));

  inFlightLookups.set(shop, lookup);
  return lookup;
};

export const clearShopPlanCache = (shop) => planCache.delete(shop);

const ACTIVE_SUBSCRIPTION_QUERY = `
query ActiveSubscription($appId: ID!, $shopId: ID!) {
  activeSubscription(appId: $appId, shopId: $shopId) {
    billingPeriod
    cancelAtEndOfCycle
    items {
      handle
    }
  }
}
`;
