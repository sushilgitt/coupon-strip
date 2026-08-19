import { Banner, Layout, Page } from "@shopify/polaris";

/**
 * App Bridge v4 has no React provider.
 *
 * The script is loaded from Shopify's CDN in index.html and initialises itself
 * synchronously from <meta name="shopify-api-key">, exposing `window.shopify`
 * before React mounts. So instead of wrapping the tree in a <Provider>, this
 * component only guards the one failure mode worth explaining: the app being
 * opened outside the Shopify admin, where App Bridge never initialises.
 */
export function AppBridgeProvider({ children }) {
  const isEmbeddedRuntime =
    typeof window !== "undefined" && typeof window.shopify !== "undefined";

  if (!isEmbeddedRuntime) {
    return (
      <Page narrowWidth>
        <Layout>
          <Layout.Section>
            <div style={{ marginTop: "100px" }}>
              <Banner title="Open this app from Shopify admin" status="critical">
                <p>
                  App Bridge did not load, which happens when the app is opened
                  directly instead of from inside Shopify admin. Open your store
                  admin and launch the app from the Apps menu.
                </p>
              </Banner>
            </div>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return children;
}
