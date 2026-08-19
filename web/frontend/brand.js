// Coupon Strip visual identity.
// Cool teal/slate system: crisp near-white surfaces, a single teal accent for
// primary actions, and slate typography. Token names describe their ROLE, not a
// literal hue, so the palette can be retuned without renaming anything.

export const couponStripColors = {
  primary: "#0f766e",
  primaryDark: "#134e4a",
  primarySoft: "#ccfbf1",
  accent: "#14b8a6",
  accentSoft: "#f0fdfa",
  text: "#0f172a",
  mutedText: "#475569",
  border: "#cbd5e1",
  borderStrong: "#0d9488",
  shadow: "rgba(15, 23, 42, 0.08)",
  shadowStrong: "rgba(13, 148, 136, 0.20)",
};

export const couponStripStyles = {
  appFrame: {
    minHeight: "100vh",
    background: `linear-gradient(180deg, ${couponStripColors.accentSoft} 0%, #f8fafc 45%, #ffffff 100%)`,
    color: couponStripColors.text,
  },
  heroCard: {
    borderRadius: 14,
    border: `1px solid ${couponStripColors.border}`,
    borderTop: `3px solid ${couponStripColors.primary}`,
    boxShadow: `0 1px 3px ${couponStripColors.shadow}`,
    background: "#ffffff",
  },
  accentCard: {
    borderRadius: 14,
    border: `1px solid ${couponStripColors.border}`,
    boxShadow: `0 1px 3px ${couponStripColors.shadow}`,
    background: "#ffffff",
  },
  primaryButton: {
    background: couponStripColors.primary,
    color: "#ffffff",
    border: "none",
    borderRadius: 8,
    fontWeight: 600,
  },
  secondaryButton: {
    background: "#ffffff",
    color: couponStripColors.primary,
    border: `1px solid ${couponStripColors.borderStrong}`,
    borderRadius: 8,
    fontWeight: 600,
  },
  stepBadge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 26,
    height: 26,
    borderRadius: 8,
    background: couponStripColors.primarySoft,
    color: couponStripColors.primaryDark,
    fontWeight: 700,
    fontSize: 13,
  },
};
