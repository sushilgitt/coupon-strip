export const couponStripColors = {
  indigo: "#5f4638",
  indigoDark: "#3c2a21",
  mint: "#d8c2a8",
  mintSoft: "#f6efe7",
  indigoSoft: "#ede2d3",
  text: "#111111",
  mutedText: "#5b4637",
  border: "#d6c2b0",
  borderStrong: "#a8856a",
  shadow: "rgba(60, 42, 33, 0.12)",
  shadowStrong: "rgba(95, 70, 56, 0.22)",
};

export const couponStripStyles = {
  appFrame: {
    minHeight: "100vh",
    background: `linear-gradient(180deg, ${couponStripColors.indigoSoft} 0%, ${couponStripColors.mintSoft} 26%, #fffaf5 100%)`,
    color: couponStripColors.text,
  },
  heroCard: {
    borderRadius: 18,
    border: `1px solid ${couponStripColors.border}`,
    boxShadow: `0 12px 30px ${couponStripColors.shadow}`,
    background: `linear-gradient(135deg, #fffaf5 0%, ${couponStripColors.mintSoft} 100%)`,
  },
  accentCard: {
    borderRadius: 18,
    border: `1px solid ${couponStripColors.border}`,
    boxShadow: `0 10px 26px ${couponStripColors.shadow}`,
    background: "#fffaf5",
  },
  primaryButton: {
    background: `linear-gradient(135deg, ${couponStripColors.indigo} 0%, ${couponStripColors.indigoDark} 100%)`,
    color: "#ffffff",
    border: "none",
    fontWeight: 600,
  },
  secondaryButton: {
    background: "#efe2d3",
    color: couponStripColors.text,
    border: `1px solid ${couponStripColors.borderStrong}`,
    fontWeight: 600,
  },
};
