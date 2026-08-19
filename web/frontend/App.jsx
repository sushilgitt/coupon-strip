import { useEffect, useMemo, useRef } from "react";
import { BrowserRouter, useLocation, useNavigate } from "react-router-dom";
import Routes from "./Routes";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { hasRecentReauthAttempt } from "./hooks";
import {
  AppBridgeProvider,
  QueryProvider,
  PolarisProvider,
} from "./components";

const RETURN_TO_STORAGE_KEY = "couponStrip:returnTo";

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
  if (!path.startsWith("/")) {
    return path;
  }

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

function ResumeStoredRoute() {
  const location = useLocation();
  const navigate = useNavigate();
  const hasCheckedStoredRoute = useRef(false);
  const embeddedSearch = useMemo(() => location.search, [location.search]);

  useEffect(() => {
    if (hasCheckedStoredRoute.current) {
      return;
    }

    hasCheckedStoredRoute.current = true;

    const storedRoute = window.sessionStorage.getItem(RETURN_TO_STORAGE_KEY);
    if (!storedRoute) return;

    if (!storedRoute.startsWith("/")) {
      window.sessionStorage.removeItem(RETURN_TO_STORAGE_KEY);
      return;
    }

    if (!hasRecentReauthAttempt()) {
      window.sessionStorage.removeItem(RETURN_TO_STORAGE_KEY);
      return;
    }

    if (location.pathname !== "/") {
      window.sessionStorage.removeItem(RETURN_TO_STORAGE_KEY);
      return;
    }

    const nextRoute = withEmbeddedParams(storedRoute, embeddedSearch);
    const currentRoute = withEmbeddedParams(
      `${location.pathname}${location.search}`,
      embeddedSearch
    );

    if (nextRoute === currentRoute) {
      window.sessionStorage.removeItem(RETURN_TO_STORAGE_KEY);
      return;
    }

    window.sessionStorage.removeItem(RETURN_TO_STORAGE_KEY);
    navigate(nextRoute, { replace: true });
  }, [embeddedSearch, location.pathname, location.search, navigate]);

  return null;
}

// App Bridge v4 renders the admin nav from the <ui-nav-menu> web component
// instead of v3's <NavigationMenu navigationLinks={...} />. The first anchor
// must carry rel="home". Embedded params are preserved on each href so a
// full-page load still lands with shop/host intact.
function EmbeddedNavigationMenu() {
  const location = useLocation();
  const links = useMemo(
    () => [
      { label: "Overview", path: "/", home: true },
      { label: "Coupons", path: "/coupons" },
      { label: "Plans", path: "/pricing" },
      { label: "Help", path: "/support" },
    ],
    []
  );

  return (
    <ui-nav-menu>
      {links.map((link) => (
        <a
          key={link.path}
          href={withEmbeddedParams(link.path, location.search)}
          {...(link.home ? { rel: "home" } : {})}
        >
          {link.label}
        </a>
      ))}
    </ui-nav-menu>
  );
}

export default function App() {
  // Any .tsx or .jsx files in /pages will become a route
  // See documentation for <Routes /> for more info
  const pages = import.meta.globEager("./pages/**/!(*.test.[jt]sx)*.([jt]sx)");

  return (
    <BrowserRouter>
      <AppBridgeProvider>
        <PolarisProvider>
          <QueryProvider>
            <ErrorBoundary>
              <ResumeStoredRoute />
              <EmbeddedNavigationMenu />
              <Routes pages={pages} />
            </ErrorBoundary>
          </QueryProvider>
        </PolarisProvider>
      </AppBridgeProvider>
    </BrowserRouter>
  );
}
