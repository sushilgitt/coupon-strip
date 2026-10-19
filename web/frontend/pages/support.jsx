import { Card, Layout, Page, Stack, TextContainer } from "@shopify/polaris";
import { couponStripColors, couponStripStyles } from "../brand";

const mutedStyle = { color: couponStripColors.mutedText };
const questionStyle = {
  color: couponStripColors.text,
  fontWeight: 600,
  marginBottom: 4,
};

const TROUBLESHOOTING = [
  {
    q: "The strip isn't showing on my product pages",
    a: "The app block has to be added per template. Open the theme editor, pick the product template you actually use, confirm Coupon Strip Offers is present, and save. If a product uses an alternate template, add the block there too.",
  },
  {
    q: "I added codes but the strip is still empty",
    a: "The strip only renders codes created on the Coupons page. Codes made directly in Shopify Discounts won't appear, because the block reads the list this app maintains.",
  },
  {
    q: "A code doesn't work at checkout",
    a: "Check the coupon's minimum order subtotal on the Coupons page. If the cart is below it, Shopify rejects the code even though the strip still displays it.",
  },
  {
    q: "I can't add a fourth coupon",
    a: "That's the Basic plan limit. Delete one you're no longer running, or move to Pro on the Plan page for six.",
  },
  {
    q: "How do I change or cancel my plan?",
    a: "Billing is handled by Shopify. Use Switch on the Plan page to open Shopify's plan page, where you can move between Basic and Pro or switch between monthly and yearly billing. Uninstalling the app cancels your subscription.",
  },
];

export default function SupportPage() {
  return (
    <Page title="Help">
      <Layout>
        <Layout.Section>
          <Card sectioned style={couponStripStyles.heroCard}>
            <TextContainer spacing="tight">
              <h2 style={{ color: couponStripColors.text, fontSize: 20, fontWeight: 650 }}>
                Common questions
              </h2>
              <p style={mutedStyle}>
                Most issues come down to which template the block sits on, or a
                minimum-subtotal rule on the code itself.
              </p>
            </TextContainer>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card sectioned style={couponStripStyles.accentCard}>
            <Stack vertical spacing="loose">
              {TROUBLESHOOTING.map((item) => (
                <div key={item.q}>
                  <p style={questionStyle}>{item.q}</p>
                  <p style={mutedStyle}>{item.a}</p>
                </div>
              ))}
            </Stack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
