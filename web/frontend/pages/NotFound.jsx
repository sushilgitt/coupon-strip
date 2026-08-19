import { Card, EmptyState, Page } from "@shopify/polaris";
import { notFoundImage } from "../assets";
import { couponStripStyles } from "../brand";

export default function NotFound() {
  return (
    <Page>
      <Card sectioned style={couponStripStyles.accentCard}>
        <EmptyState
          heading="This page isn’t available"
          image={notFoundImage}
        >
          <p>
            Double-check the address and try again, or use Shopify navigation
            to return to the section you need.
          </p>
        </EmptyState>
      </Card>
    </Page>
  );
}
