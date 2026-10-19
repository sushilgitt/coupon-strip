// @ts-check
import React, { useMemo } from "react";
import { Page, Layout, Button, Banner, Icon } from "@shopify/polaris";
import { CircleTickMinor } from "@shopify/polaris-icons";
import { usePlan } from "../components";

// Billing runs on Shopify App Pricing: prices, trials and monthly/yearly options
// are configured in the Partner Dashboard and shown on Shopify's hosted plan
// selection page, so this page never shows a price or creates a charge. Plan
// handles and limits must match PLAN_COUPON_LIMITS in web/app-pricing.js.
const PLANS = [
  {
    handle: "basic",
    name: "Basic",
    description: "Everything you need to run a few offers.",
    limit: 3,
  },
  {
    handle: "pro",
    name: "Pro",
    description: "More room for stores running multiple offers.",
    limit: 6,
  },
];

const SHARED_FEATURES = [
  "Display coupon offers on product pages",
  "Adjust colors and layout",
  "Keep slider arrow navigation",
  "Support mobile-friendly browsing",
];

export default function Pricing() {
  const { plan, openPlanSelection } = usePlan();

  const tick = useMemo(
    () => <Icon source={CircleTickMinor} color="success" />,
    []
  );

  const cardClassName = (card) =>
    [
      "cs-plan-card",
      card.handle === "pro" && "cs-plan-card--premium",
      card.handle === plan && "cs-plan-card--current",
    ]
      .filter(Boolean)
      .join(" ");

  return (
    <Page
      title="Plan"
      subtitle="Both plans include the full product-page strip. The difference is how many codes you can run at once."
    >
      <Layout>
        <Layout.Section>
          <Banner status="info">
            Plans, prices and monthly or yearly billing are managed by Shopify.
            Changing your plan opens Shopify's plan page, where you approve the
            charge.
          </Banner>
        </Layout.Section>

        {PLANS.map((card) => (
          <Layout.Section oneHalf key={card.handle}>
            <div className={cardClassName(card)}>
              <div className="cs-plan-header">
                <h2 className="cs-plan-name">{card.name}</h2>
                {card.handle === plan ? (
                  <span className="cs-badge cs-badge--current">Current</span>
                ) : (
                  card.handle === "pro" && (
                    <span className="cs-badge cs-badge--popular">Popular choice</span>
                  )
                )}
              </div>

              <p className="cs-plan-desc">{card.description}</p>

              <ul className="cs-features">
                {[`Show up to ${card.limit} active offers`, ...SHARED_FEATURES].map(
                  (item) => (
                    <li key={item} className="cs-feature">
                      {tick}
                      <span>{item}</span>
                    </li>
                  )
                )}
              </ul>

              <div className="cs-plan-action">
                <Button
                  fullWidth
                  primary={card.handle !== plan}
                  disabled={card.handle === plan}
                  onClick={openPlanSelection}
                >
                  {card.handle === plan ? "Active plan" : `Switch to ${card.name}`}
                </Button>
              </div>
            </div>
          </Layout.Section>
        ))}
      </Layout>
    </Page>
  );
}
