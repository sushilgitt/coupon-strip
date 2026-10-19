import { useNavigate, useLocation } from "react-router-dom";
import { Button, Card, Layout, Page, Stack, TextContainer } from "@shopify/polaris";
import { couponStripColors, couponStripStyles } from "../brand";
import { usePlan } from "../components";

const decodeHost = (host) => {
  if (!host) return "";

  try {
    return atob(host.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    return "";
  }
};

const getEmbeddedShop = (host) => {
  const decodedHost = decodeHost(host);
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

const withEmbeddedParams = (path, currentSearch) => {
  const [pathname, existingQuery = ""] = path.split("?");
  const nextParams = new URLSearchParams(existingQuery);
  const currentParams = new URLSearchParams(currentSearch);
  const host = currentParams.get("host") || window.__SHOPIFY_DEV_HOST || "";
  const shop = currentParams.get("shop") || getEmbeddedShop(host);

  if (host && !nextParams.has("host")) {
    nextParams.set("host", host);
  }

  if (shop && !nextParams.has("shop")) {
    nextParams.set("shop", shop);
  }

  const query = nextParams.toString();
  return query ? `${pathname}?${query}` : pathname;
};

const SETUP_STEPS = [
  {
    title: "Add the block to your product template",
    body: "In your theme editor, open a product template and add the Coupon Strip Offers app block wherever you want the strip to appear.",
  },
  {
    title: "Create your discount codes",
    body: "Add codes on the Coupons page. Each one becomes a genuine Shopify discount, so it reduces the price at checkout — not just on screen.",
  },
  {
    title: "Publish and check a live product",
    body: "Save the template, then open any product page. Shoppers can swipe the strip and tap to copy a code.",
  },
];

const mutedStyle = { color: couponStripColors.mutedText };
const planBadgeStyle = {
  marginLeft: 8,
  padding: "2px 8px",
  borderRadius: 999,
  background: couponStripColors.primarySoft,
  color: couponStripColors.primaryDark,
  fontSize: 12,
  fontWeight: 600,
};

export default function HomePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { plan, limit } = usePlan();
  const isPro = plan === "pro";

  const go = (path) => navigate(withEmbeddedParams(path, location.search));

  return (
    <Page title="Coupon Strip">
      <Layout>
        <Layout.Section>
          <Card sectioned style={couponStripStyles.heroCard}>
            <TextContainer spacing="loose">
              <h2 style={{ color: couponStripColors.text, fontSize: 22, fontWeight: 650 }}>
                Turn discount codes into a strip shoppers actually notice
              </h2>
              <p style={mutedStyle}>
                Savings buried in a banner get missed. Coupon Strip puts your live
                codes on the product page itself, right where the buying decision
                happens, so shoppers can grab one without hunting for it.
              </p>
              <Stack spacing="tight">
                <Button
                  primary
                  style={couponStripStyles.primaryButton}
                  onClick={() => go("/coupons")}
                >
                  Create a coupon
                </Button>
                <Button
                  style={couponStripStyles.secondaryButton}
                  onClick={() => go("/pricing")}
                >
                  Compare plans
                </Button>
              </Stack>
            </TextContainer>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card sectioned title="Three steps to go live" style={couponStripStyles.accentCard}>
            <Stack vertical spacing="loose">
              {SETUP_STEPS.map((step, index) => (
                <Stack key={step.title} wrap={false} spacing="loose" alignment="leading">
                  <span style={couponStripStyles.stepBadge}>{index + 1}</span>
                  <Stack.Item fill>
                    <p style={{ color: couponStripColors.text, fontWeight: 600, marginBottom: 4 }}>
                      {step.title}
                    </p>
                    <p style={mutedStyle}>{step.body}</p>
                  </Stack.Item>
                </Stack>
              ))}
            </Stack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card sectioned style={couponStripStyles.accentCard}>
            <Stack alignment="center" distribution="equalSpacing" wrap={false}>
              <Stack.Item fill>
                <p style={{ color: couponStripColors.text, fontWeight: 600, marginBottom: 4 }}>
                  You're on the {isPro ? "Pro" : "Basic"} plan
                  <span style={planBadgeStyle}>{limit} live codes</span>
                </p>
                <p style={mutedStyle}>
                  {isPro
                    ? "Pro keeps up to six codes live in the strip at once."
                    : "Basic keeps three codes live. Pro raises that to six."}
                </p>
              </Stack.Item>
              <Button
                style={couponStripStyles.secondaryButton}
                onClick={() => go("/pricing")}
              >
                {isPro ? "Manage plan" : "Upgrade to Pro"}
              </Button>
            </Stack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
