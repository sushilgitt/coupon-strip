import { useCallback } from "react";
import { AppProvider } from "@shopify/polaris";
import { useNavigate } from "react-router-dom";
import translations from "@shopify/polaris/locales/en.json";
import "@shopify/polaris/build/esm/styles.css";
// After Polaris so its font-family override wins.
import "../../theme.css";
import { couponStripStyles } from "../../brand";

const IS_EXTERNAL_LINK_REGEX = /^(?:[a-z][a-z\d+.-]*:|\/\/)/;

// Polaris links route through React Router. Under App Bridge v4 the admin URL
// stays in sync with the iframe's history automatically, so a client-side
// navigation is all that is needed -- v3's app-bridge useNavigate is gone.
function AppBridgeLink({ url, children, external, ...rest }) {
  const navigate = useNavigate();
  const handleClick = useCallback(
    (event) => {
      event.preventDefault();
      navigate(url);
    },
    [navigate, url]
  );

  if (external || IS_EXTERNAL_LINK_REGEX.test(url)) {
    return (
      <a {...rest} href={url} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }

  return (
    <a {...rest} href={url} onClick={handleClick}>
      {children}
    </a>
  );
}

export function PolarisProvider({ children }) {
  return (
    <AppProvider i18n={translations} linkComponent={AppBridgeLink}>
      <div style={couponStripStyles.appFrame}>{children}</div>
    </AppProvider>
  );
}
