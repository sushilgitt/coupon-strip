// @ts-check
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Page,
  Layout,
  Button,
  Banner,
  Modal,
  TextContainer,
  Icon,
} from "@shopify/polaris";
import { CircleTickMinor } from "@shopify/polaris-icons";
import {
  useAuthenticatedFetch,
  isReauthorizationInProgressError,
  hasRecentReauthAttempt,
  redirectTopLevel,
} from "../hooks";

const PENDING_PLAN_STORAGE_KEY = "couponStrip:pendingPlan";
const RETURN_TO_STORAGE_KEY = "couponStrip:returnTo";
const REQUEST_TIMEOUT_MS = 15000;
const REAUTH_RECOVERY_RETRY_MS = 16000;

// Premium is one tier billed two ways. Slugs match the backend
// (PREMIUM_PLANS_BY_SLUG in web/index.js).
const PREMIUM_PLANS = {
  monthly: { slug: "premium", price: 30, period: "month" },
  annual: { slug: "premium_annual", price: 300, period: "year" },
};
const ANNUAL_SAVINGS =
  PREMIUM_PLANS.monthly.price * 12 - PREMIUM_PLANS.annual.price;
const isPremiumSlug = (plan) =>
  plan === PREMIUM_PLANS.monthly.slug || plan === PREMIUM_PLANS.annual.slug;
const getPremiumPlanBySlug = (slug) =>
  slug === PREMIUM_PLANS.annual.slug ? PREMIUM_PLANS.annual : PREMIUM_PLANS.monthly;

const decodeHost = (host) => {
  if (!host) return "";

  try {
    return atob(host.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    return "";
  }
};

const getCurrentParams = () => new URLSearchParams(window.location.search);

const getCurrentHost = () =>
  getCurrentParams().get("host") || window.__SHOPIFY_DEV_HOST || "";

const getCurrentShop = () => {
  const params = getCurrentParams();
  const fromUrl = params.get("shop");
  if (fromUrl) return fromUrl;

  const decoded = decodeHost(getCurrentHost());
  if (!decoded) return "";

  const adminStoreMatch = decoded.match(/\/store\/([^/?]+)/);
  if (adminStoreMatch?.[1]) {
    return `${adminStoreMatch[1]}.myshopify.com`;
  }

  const directShopMatch = decoded.match(
    /([a-z0-9][a-z0-9-]*\.myshopify\.com)/i
  );

  return directShopMatch?.[1] || "";
};

const getBillingReturnState = () => {
  const params = getCurrentParams();
  return {
    isBillingReturn: params.get("billingReturn") === "1",
    plan: params.get("plan") || "",
  };
};

export default function Pricing() {
  const fetchAuth = useAuthenticatedFetch();
  const resumeAttemptedRef = useRef(false);
  const reauthRecoveryTimeoutRef = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));
  const reauthRecoveryStartedRef = useRef(false);

  const shop = getCurrentShop();
  const host = getCurrentHost();
  const billingReturnState = getBillingReturnState();

  const tick = useMemo(
    () => <Icon source={CircleTickMinor} color="success" />,
    []
  );

  const [serverTier, setServerTier] = useState(
    /** @type {"free" | "premium" | null} */ (null)
  );
  const [serverPlanSlug, setServerPlanSlug] = useState(
    /** @type {string | null} */ (null)
  );
  const [billingCycle, setBillingCycle] = useState(
    /** @type {"monthly" | "annual"} */ ("monthly")
  );
  const [loading, setLoading] = useState({ page: true, action: null });
  const [confirm, setConfirm] = useState({ open: false, target: null });
  const [banner, setBanner] = useState({ msg: "", status: null });

  const selectedPremiumPlan = PREMIUM_PLANS[billingCycle];

  const applyServerPlan = (tier, planSlug) => {
    setServerTier(tier);
    const nextSlug = tier === "premium" ? planSlug || PREMIUM_PLANS.monthly.slug : null;
    setServerPlanSlug(nextSlug);
    if (nextSlug) {
      setBillingCycle(nextSlug === PREMIUM_PLANS.annual.slug ? "annual" : "monthly");
    }
  };

  const selectedPlan = useMemo(() => {
    if (serverTier !== "free" && serverTier !== "premium") {
      return null;
    }

    return serverTier;
  }, [serverTier]);

  const withShopQuery = (path) => {
    if (!shop && !host) return path;
    const [base, existingQuery = ""] = path.split("?");
    const params = new URLSearchParams(existingQuery);
    if (shop && !params.has("shop")) params.set("shop", shop);
    if (host && !params.has("host")) params.set("host", host);
    const query = params.toString();
    return query ? `${base}?${query}` : base;
  };

  const getErrorMessage = (data, fallback) => {
    if (Array.isArray(data?.details) && data.details.length) {
      return data.details.join(" ");
    }

    return data?.error || fallback;
  };

  const parseJsonSafe = async (response) => {
    try {
      return await response.json();
    } catch {
      return {};
    }
  };

  const clearPendingPlan = () => {
    window.sessionStorage.removeItem(PENDING_PLAN_STORAGE_KEY);
  };

  const getPendingPlan = () =>
    window.sessionStorage.getItem(PENDING_PLAN_STORAGE_KEY) || "";

  const showResumeBanner = (pendingPlan) => {
    if (!pendingPlan) return;

    setBanner({
      msg:
        isPremiumSlug(pendingPlan)
          ? "Authentication restored. Resuming the Premium billing flow."
          : "Authentication restored. Resuming the Free plan change.",
      status: "info",
    });
  };

  const clearReturnToRoute = () => {
    window.sessionStorage.removeItem(RETURN_TO_STORAGE_KEY);
  };

  const clearPendingBillingResume = () => {
    clearPendingPlan();
    clearReturnToRoute();
  };

  const clearReauthRecoveryTimeout = () => {
    if (reauthRecoveryTimeoutRef.current) {
      clearTimeout(reauthRecoveryTimeoutRef.current);
      reauthRecoveryTimeoutRef.current = null;
    }
  };

  const scheduleReauthRecovery = () => {
    if (reauthRecoveryStartedRef.current) {
      return;
    }

    reauthRecoveryStartedRef.current = true;
    clearReauthRecoveryTimeout();
    reauthRecoveryTimeoutRef.current = setTimeout(() => {
      setLoading((s) => ({ ...s, page: false }));
      // Do NOT fake a "free" tier here — leaving serverTier null keeps the plan
      // buttons disabled (hasResolvedPlan === false) and avoids the misleading
      // "no plan active" state while we are genuinely still connecting.
      setBanner((currentBanner) =>
        currentBanner.msg
          ? currentBanner
          : {
              msg: "We’re still connecting to Shopify. Reopen the app from Shopify admin or reload this page to finish loading your plan.",
              status: "info",
            }
      );
    }, REAUTH_RECOVERY_RETRY_MS);
  };

  const clearBillingReturnParams = () => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("billingReturn") && !params.has("plan")) {
      return;
    }

    params.delete("billingReturn");
    params.delete("plan");
    const nextQuery = params.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`;
    window.history.replaceState({}, "", nextUrl);
  };

  const handleAuthResponse = (response, data, fallback) => {
    if (response.status === 401 && data?.needsReauth) {
      if (data.requiresBillingScopes) {
        throw new Error(
          "Shopify needs fresh app authorization for billing scopes. Reopen the app from Shopify admin, approve access, and try Premium again."
        );
      }

      throw new Error(
        getErrorMessage(
          data,
          "Authentication is being restored. If the page does not recover, reopen the app from Shopify admin and try again."
        )
      );
    }

    if (!response.ok) {
      throw new Error(getErrorMessage(data, fallback));
    }
  };

  const loadPlanResponse = async () => {
    const response = await fetchAuth(withShopQuery("/api/hasActiveSubscription"));
    const data = await parseJsonSafe(response);
    return { response, data };
  };

  const postPlanAction = async (path, plan, fallback) => {
    const response = await fetchAuth(withShopQuery(path), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ plan, host }),
      reauthPlan: plan,
    });
    const data = await parseJsonSafe(response);
    handleAuthResponse(response, data, fallback);
    return data;
  };

  const performPlanAction = async (plan, { silent = false } = {}) => {
    if (plan === "free") {
      const data = await postPlanAction(
        "/api/cancelSubscription",
        "free",
        "We couldn’t switch you to the Free plan."
      );

      if (data?.tier !== "free") {
        throw new Error("The Free plan could not be confirmed after cancellation.");
      }

      clearPendingBillingResume();
      applyServerPlan("free", null);
      if (!silent) {
        setBanner({ msg: "Your store is now on the Free plan.", status: "success" });
      }
      return { redirected: false, tier: data.tier };
    }

    const data = await postPlanAction(
      "/api/createSubscription",
      plan,
      "We couldn’t start the Premium subscription."
    );

    // Only "done" when the requested billing cycle is the one now active; when
    // switching monthly <-> annual the old plan is still active and Shopify
    // returns an approval link instead.
    if (data.isActiveSubscription && data.planSlug === plan && !data.confirmationUrl) {
      clearPendingBillingResume();
      applyServerPlan("premium", data.planSlug);
      if (!silent) {
        setBanner({ msg: "Your Premium plan is already active.", status: "success" });
      }
      return { redirected: false, tier: data.tier };
    }

    if (data.confirmationUrl) {
      redirectTopLevel(String(data.confirmationUrl));
      return { redirected: true, tier: data.tier };
    }

    throw new Error("Shopify did not return a billing approval link.");
  };

  async function refreshTier({ allowSoftFailure = false } = {}) {
    try {
      setLoading((s) => ({ ...s, page: true }));

      const timeout = new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error("Loading plans took too long.")),
          REQUEST_TIMEOUT_MS
        );
      });

      const { response, data } = await Promise.race([loadPlanResponse(), timeout]);

      handleAuthResponse(
        response,
        data,
        "We couldn’t confirm your current plan."
      );

      if (data?.tier !== "premium" && data?.tier !== "free") {
        throw new Error("We couldn’t confirm your current plan.");
      }

      clearReauthRecoveryTimeout();
      reauthRecoveryStartedRef.current = false;
      applyServerPlan(data.tier, data.planSlug);
      setBanner((currentBanner) => {
        if (currentBanner.status === "critical" || currentBanner.status === "warning") {
          return { msg: "", status: null };
        }

        return currentBanner;
      });

      // The active premium slug, or null on Free -- callers compare it to the
      // plan the merchant just approved.
      return data.tier === "premium"
        ? data.planSlug || PREMIUM_PLANS.monthly.slug
        : null;
    } catch (error) {
      if (isReauthorizationInProgressError(error)) {
        scheduleReauthRecovery();
        return null;
      }

      if (!allowSoftFailure) {
        applyServerPlan(null, null);
        setBanner({
          msg:
            error instanceof Error
              ? error.message
              : "We couldn’t confirm your current plan.",
          status: "critical",
        });
      } else {
        setBanner({
          msg:
            error instanceof Error
              ? `${error.message} We’ll keep your previous plan selection visible while you retry.`
              : "We couldn’t confirm your current plan yet.",
          status: "warning",
        });
      }

      return null;
    } finally {
      setLoading((s) => ({ ...s, page: false }));
    }
  }

  useEffect(() => {
    const pendingPlan = getPendingPlan();

    const initialize = async () => {
      if (pendingPlan && !billingReturnState.isBillingReturn) {
        showResumeBanner(pendingPlan);
      }

      const planSlug = await refreshTier({
        allowSoftFailure: billingReturnState.isBillingReturn || !!pendingPlan,
      });

      if (billingReturnState.isBillingReturn) {
        clearBillingReturnParams();

        if (planSlug && planSlug === billingReturnState.plan) {
          clearPendingBillingResume();
          setBanner({
            msg:
              planSlug === PREMIUM_PLANS.annual.slug
                ? "Premium billing approved. Your store is now on Premium, billed yearly."
                : "Premium billing approved. Your store is now on Premium, billed monthly.",
            status: "success",
          });
          return;
        }

        // Still premium on the other cycle: a yearly -> monthly downgrade is
        // deferred by Shopify until the paid period ends.
        if (planSlug && isPremiumSlug(billingReturnState.plan)) {
          clearPendingBillingResume();
          setBanner({
            msg:
              "Your billing change was submitted. Your current Premium subscription stays active until Shopify switches it over at the end of the paid period.",
            status: "info",
          });
          return;
        }

        clearPendingBillingResume();
        setBanner({
          msg:
            "We returned from Shopify billing, but Premium is not active yet. Review the approval result and try again if needed.",
          status: "warning",
        });
        return;
      }

      if (pendingPlan && !resumeAttemptedRef.current) {
        resumeAttemptedRef.current = true;

        try {
          setLoading((s) => ({ ...s, action: pendingPlan }));
          const result = await performPlanAction(pendingPlan, { silent: true });

          if (!result.redirected) {
            await refreshTier({ allowSoftFailure: true });
            setBanner({
              msg:
                isPremiumSlug(pendingPlan)
                  ? "Premium plan restored after reauthorization."
                  : "Free plan restored after reauthorization.",
              status: "success",
            });
          }
        } catch (error) {
          if (!isReauthorizationInProgressError(error)) {
            clearPendingBillingResume();
            setBanner({
              msg:
                error instanceof Error
                  ? error.message
                  : "We couldn’t resume your plan change after reauthorization.",
              status: "critical",
            });
          }
        } finally {
          setLoading((s) => ({ ...s, action: null }));
        }
      }
    };

    initialize();

    return () => {
      clearReauthRecoveryTimeout();
    };
  }, []);

  const openConfirm = (plan) => {
    if (loading.page || loading.action || isCurrent(plan) || !selectedPlan) {
      return;
    }

    setConfirm({ open: true, target: plan });
  };

  const runConfirm = async () => {
    const plan = confirm.target;
    if (!plan || loading.page || loading.action) return;

    setConfirm({ open: false, target: null });
    setLoading((s) => ({ ...s, action: plan }));

    try {
      const result = await performPlanAction(plan);
      if (!result.redirected) {
        await refreshTier({ allowSoftFailure: true });
      }
    } catch (error) {
      if (!isReauthorizationInProgressError(error)) {
        clearPendingPlan();
        setBanner({
          msg:
            error instanceof Error
              ? error.message
              : "We couldn’t update your plan.",
          status: "critical",
        });
      }
    } finally {
      setLoading((s) => ({ ...s, action: null }));
    }
  };

  // "free" and "premium" compare against the tier; a premium slug compares
  // against the exact billing cycle the shop is subscribed to.
  const isCurrent = (plan) =>
    isPremiumSlug(plan) ? serverPlanSlug === plan : selectedPlan === plan;
  const isOnPremium = selectedPlan === "premium";
  const hasResolvedPlan = selectedPlan === "free" || selectedPlan === "premium";

  // Card highlight follows the tier; the premium card is "current" on either
  // billing cycle. Layout/typography live in theme.css (Polaris Card ignores
  // a style prop, so these cards are plain elements).
  const isCardCurrent = (card) =>
    card === "premium" ? isOnPremium : isCurrent(card);

  const cardClassName = (card) =>
    [
      "cs-plan-card",
      card === "premium" && "cs-plan-card--premium",
      isCardCurrent(card) && "cs-plan-card--current",
    ]
      .filter(Boolean)
      .join(" ");

  const FeatureList = ({ items }) => (
    <ul className="cs-features">
      {items.map((item) => (
        <li key={item} className="cs-feature">
          {tick}
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );

  const premiumSlug = selectedPremiumPlan.slug;
  const premiumButtonLabel = isCurrent(premiumSlug)
    ? "Premium is active"
    : isOnPremium
    ? billingCycle === "annual"
      ? "Switch to yearly billing"
      : "Switch to monthly billing"
    : billingCycle === "annual"
    ? "Choose Premium yearly"
    : "Choose Premium monthly";

  const planPageTitle = "Plans";
  const planIntro =
    "Both plans include the full product-page strip. The difference is how many codes you can run at once.";

  const pageContent = (
    <Layout>
      <Layout.Section oneHalf>
        <div className={cardClassName("free")}>
          <div className="cs-plan-header">
            <h2 className="cs-plan-name">Free</h2>
            {isCurrent("free") && (
              <span className="cs-badge cs-badge--current">Current</span>
            )}
          </div>

          <div className="cs-price">
            <span className="cs-price-amount">$0</span>
            <span className="cs-price-period">/ forever</span>
          </div>
          <p className="cs-plan-desc">Everything you need to run a few offers.</p>

          <FeatureList
            items={[
              "Display coupon offers on product pages",
              "Show up to 3 active offers",
              "Adjust colors and layout",
              "Keep slider arrow navigation",
              "Support mobile-friendly browsing",
            ]}
          />

          <div className="cs-plan-action">
            <Button
              fullWidth
              disabled={!hasResolvedPlan || isCurrent("free") || loading.page || !!loading.action}
              loading={loading.action === "free"}
              onClick={() => openConfirm("free")}
            >
              {isCurrent("free") ? "Active plan" : "Choose Free"}
            </Button>
          </div>
        </div>
      </Layout.Section>

      <Layout.Section oneHalf>
        <div className={cardClassName("premium")}>
          <div className="cs-plan-header">
            <h2 className="cs-plan-name">Premium</h2>
            {isOnPremium ? (
              <span className="cs-badge cs-badge--current">Current</span>
            ) : (
              <span className="cs-badge cs-badge--popular">Popular choice</span>
            )}
          </div>

          <div className="cs-cycle-toggle" role="group" aria-label="Billing cycle">
            <button
              type="button"
              aria-pressed={billingCycle === "monthly"}
              onClick={() => setBillingCycle("monthly")}
            >
              Monthly
            </button>
            <button
              type="button"
              aria-pressed={billingCycle === "annual"}
              onClick={() => setBillingCycle("annual")}
            >
              Yearly
            </button>
          </div>

          <div className="cs-price">
            <span className="cs-price-amount">${selectedPremiumPlan.price}</span>
            <span className="cs-price-period">/ {selectedPremiumPlan.period}</span>
          </div>
          <span className="cs-savings">
            {billingCycle === "annual"
              ? `Save $${ANNUAL_SAVINGS} a year · 2 months free`
              : `Pay yearly and save $${ANNUAL_SAVINGS}`}
          </span>
          <p className="cs-plan-desc">
            More room for stores running multiple offers.
          </p>

          <FeatureList
            items={[
              "Display coupon offers on product pages",
              "Show up to 6 active offers",
              "Adjust colors and layout",
              "Keep slider arrow navigation",
              "Support mobile-friendly browsing",
            ]}
          />

          <div className="cs-plan-action">
            <Button
              fullWidth
              primary
              disabled={!hasResolvedPlan || isCurrent(premiumSlug) || loading.page || !!loading.action}
              loading={loading.action === premiumSlug}
              onClick={() => openConfirm(premiumSlug)}
            >
              {premiumButtonLabel}
            </Button>
          </div>
        </div>
      </Layout.Section>
    </Layout>
  );

  return (
    <>
      <Modal
        open={confirm.open}
        onClose={() => setConfirm({ open: false, target: null })}
        accessibilityLabel="Plan change confirmation"
        title={
          confirm.target === "free"
            ? "Move to the Free plan?"
            : confirm.target === PREMIUM_PLANS.annual.slug
            ? "Continue with Premium, billed yearly?"
            : "Continue with Premium, billed monthly?"
        }
        primaryAction={{
          content:
            confirm.target === "free"
              ? "Confirm Free plan"
              : `Approve $${getPremiumPlanBySlug(confirm.target).price}/${getPremiumPlanBySlug(confirm.target).period}`,
          onAction: runConfirm,
          loading: loading.action === confirm.target,
          disabled: !confirm.target || loading.page || !!loading.action,
        }}
      >
        <Modal.Section>
          <TextContainer>
            <p>
              {confirm.target === "free"
                ? "The Free plan supports up to 3 coupon offers."
                : "The Premium plan supports up to 6 coupon offers."}
            </p>
            {isPremiumSlug(confirm.target) && isOnPremium && (
              <p>
                Shopify will ask you to approve the new billing cycle. Once
                approved, it replaces your current Premium subscription.
              </p>
            )}
          </TextContainer>
        </Modal.Section>
      </Modal>

      <Page
        title={planPageTitle}
        subtitle={planIntro}
      >
        {!!banner.msg && (
          <Banner
            status={banner.status}
            onDismiss={() => setBanner({ msg: "", status: null })}
          >
            {banner.msg}
          </Banner>
        )}

        {loading.page ? (
          <Banner status="info">
            We’re checking your current plan. You can still review the options
            below while that loads.
          </Banner>
        ) : null}

        {!loading.page && !hasResolvedPlan && !hasRecentReauthAttempt() ? (
          <Banner status="critical">
            We couldn’t confirm your current plan yet. Reopen the app from Shopify
            admin and try again.
          </Banner>
        ) : null}

        {pageContent}
      </Page>
    </>
  );
}
