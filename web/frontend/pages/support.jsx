import { Card, Layout, Page, TextContainer } from "@shopify/polaris";
import { couponStripColors, couponStripStyles } from "../brand";

export default function SupportPage() {
  return (
    <Page title="Coupon Strip Help">
      <Layout>
        <Layout.Section>
          <Card sectioned style={couponStripStyles.heroCard}>
            <TextContainer spacing="loose">
              <h2 style={{ color: couponStripColors.text }}>Need a quick Coupon Strip check?</h2>
              <p style={{ color: couponStripColors.mutedText }}>
                Make sure the Coupon Strip Offers app block is added to
                the correct product template and that your offer wording and
                coupon codes are saved in the theme editor.
              </p>
              <p style={{ color: couponStripColors.mutedText }}>
                If your offers are not showing, review the product template
                changes, save again, and preview a live product page to confirm
                the block is visible.
              </p>
              <p style={{ color: couponStripColors.mutedText }}>
                If you are reviewing billing, open the Plans page to check your
                current option and compare available upgrades.
              </p>
            </TextContainer>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
