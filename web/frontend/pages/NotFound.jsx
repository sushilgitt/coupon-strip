import { Card, EmptyState, Page } from "@shopify/polaris";
import { notFoundImage } from "../assets";
import { couponStripStyles } from "../brand";

export default function NotFound() {
  return (
    <Page>
      <Card sectioned style={couponStripStyles.accentCard}>
        <EmptyState heading="We couldn't find that page" image={notFoundImage}>
          <p>
            The link may be out of date. Use the app navigation to jump to
            Coupons, Plans, or Help.
          </p>
        </EmptyState>
      </Card>
    </Page>
  );
}
