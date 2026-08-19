import { useNavigate, useLocation } from "react-router-dom";
import {
  Button,
  Card,
  Layout,
  Page,
  TextContainer,
} from "@shopify/polaris";
import { couponStripColors, couponStripStyles } from "../brand";

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

export default function HomePage() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <Page title="Coupon Strip">
      <Layout>
        <Layout.Section>
          <Card sectioned style={couponStripStyles.heroCard}>
            <TextContainer spacing="loose">
              <h2 style={{ color: couponStripColors.text }}>Display coupon offers where shoppers need them</h2>
              <p style={{ color: couponStripColors.mutedText }}>
                Coupon Strip lets you place coupon offers directly on product pages
                so customers can spot available savings and copy codes quickly.
              </p>
              <p style={{ color: couponStripColors.mutedText }}>
                To get started, add the Coupon Strip Offers app block to your
                product template in the theme editor, then create your coupons on
                the Coupons page. Each coupon becomes a real Shopify discount, so
                the code actually reduces the price at checkout.
              </p>
            </TextContainer>
          </Card>
        </Layout.Section>

        <Layout.Section oneHalf>
          <Card sectioned title="Getting started" style={couponStripStyles.accentCard}>
            <TextContainer spacing="loose">
              <p style={{ color: couponStripColors.mutedText }}>
                Place the Coupon Strip Offers app block on your product
                template in the theme editor, then create the discount codes you
                want to show on the Coupons page.
              </p>
              <Button
                style={couponStripStyles.primaryButton}
                onClick={() =>
                  navigate(withEmbeddedParams("/coupons", location.search))
                }
              >
                Manage coupons
              </Button>
            </TextContainer>
          </Card>
        </Layout.Section>

        <Layout.Section oneHalf>
          <Card sectioned title="Plans" style={couponStripStyles.accentCard}>
            <TextContainer spacing="loose">
              <p style={{ color: couponStripColors.mutedText }}>
                Compare the available plan options and choose the one that fits
                your store.
              </p>
              <Button
                style={couponStripStyles.primaryButton}
                onClick={() =>
                  navigate(withEmbeddedParams("/pricing", location.search))
                }
              >
                See plan details
              </Button>
            </TextContainer>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
