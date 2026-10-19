import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Banner, Button, Layout, Page, Spinner, Stack } from "@shopify/polaris";
import {
  useAuthenticatedFetch,
  isReauthorizationInProgressError,
  redirectTopLevel,
} from "../../hooks";

/**
 * Shopify App Pricing gate.
 *
 * There is no free plan: every shop needs an active Basic or Pro subscription.
 * Plans live in the Partner Dashboard and Shopify hosts the plan selection page,
 * so a shop without a plan is sent there (top-level, since it sits outside the
 * app iframe). After the merchant approves a plan, Shopify redirects back to the
 * plan's welcome link with `plan_handle` appended; we then bypass the backend
 * plan cache so the new plan shows immediately.
 *
 * A failed plan lookup shows a retry banner and never redirects, so a Partner
 * API hiccup can't bounce a paying merchant to the plan selection page.
 */
const PlanContext = createContext(null);

// Routes that must render without a plan.
const UNGATED_PATHS = ["/exitiframe"];

export function usePlan() {
  return useContext(PlanContext);
}

export function PlanProvider({ children }) {
  const fetchAuth = useAuthenticatedFetch();
  const location = useLocation();
  const isUngated = UNGATED_PATHS.includes(location.pathname.toLowerCase());

  const [state, setState] = useState({ status: "loading", data: null, error: "" });
  const didLoadRef = useRef(false);

  const loadPlan = useCallback(
    async ({ refresh = false } = {}) => {
      setState((s) => ({ ...s, status: "loading", error: "" }));
      try {
        const response = await fetchAuth(`/api/plan${refresh ? "?refresh=1" : ""}`);
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data?.error || "We couldn't check your plan.");
        }

        setState({ status: "ready", data, error: "" });
        return data;
      } catch (error) {
        // Reauthorization navigates the top window; keep the spinner up.
        if (isReauthorizationInProgressError(error)) return null;

        setState({
          status: "error",
          data: null,
          error: error instanceof Error ? error.message : "We couldn't check your plan.",
        });
        return null;
      }
    },
    [fetchAuth]
  );

  // Load once on mount. useAuthenticatedFetch() returns a new function every
  // render, so depending on loadPlan would refetch on every render.
  useEffect(() => {
    if (didLoadRef.current || isUngated) return;
    didLoadRef.current = true;

    const returningFromPlanSelection = new URLSearchParams(location.search).has(
      "plan_handle"
    );
    loadPlan({ refresh: returningFromPlanSelection });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUngated]);

  const hasPlan = state.status === "ready" && !!state.data?.plan;
  const needsPlan = state.status === "ready" && !state.data?.plan;

  useEffect(() => {
    if (needsPlan && !isUngated && state.data?.planSelectionUrl) {
      redirectTopLevel(state.data.planSelectionUrl);
    }
  }, [needsPlan, isUngated, state.data]);

  if (isUngated) return children;

  if (state.status === "error") {
    return (
      <Page narrowWidth>
        <Layout>
          <Layout.Section>
            <Banner title="We couldn't check your plan" status="critical">
              <p>{state.error}</p>
              <div style={{ marginTop: 12 }}>
                <Button onClick={() => loadPlan({ refresh: true })}>Try again</Button>
              </div>
            </Banner>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  if (!hasPlan) {
    return (
      <div style={{ paddingTop: 120 }}>
        <Stack vertical alignment="center" spacing="tight">
          <Spinner accessibilityLabel="Checking your plan" size="large" />
          {needsPlan && <p>Taking you to plan selection…</p>}
        </Stack>
      </div>
    );
  }

  return (
    <PlanContext.Provider
      value={{
        plan: state.data.plan,
        limit: state.data.limit,
        planSelectionUrl: state.data.planSelectionUrl,
        openPlanSelection: () => redirectTopLevel(state.data.planSelectionUrl),
      }}
    >
      {children}
    </PlanContext.Provider>
  );
}
