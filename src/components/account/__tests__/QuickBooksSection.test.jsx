// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// QbItemMapEditor (inside QuickBooksSection) imports supabaseClient at module load.
vi.mock("@/api/supabaseClient", () => ({
  base44: { functions: { invoke: vi.fn(() => Promise.resolve({ data: null, error: null })) }, entities: {} },
  supabase: { auth: { getSession: vi.fn(() => Promise.resolve({ data: { session: null } })) } },
}));
vi.mock("@/components/shared/pricing", () => ({
  loadShopPricingConfig: vi.fn(),
  GARMENT_CATEGORIES: [],
  getEnabledTechniques: () => [],
}));

import QuickBooksSection from "../QuickBooksSection";

const noop = () => {};

const BASE_PROPS = {
  user: { email: "shop@example.com" },
  qbMessage: null, setQbMessage: noop,
  qbConnected: false,
  qbRealmId: null, qbExpiresAt: null, qbRefreshExpiresAt: null,
  qbNeedsReconnect: false, qbConnecting: false,
  qbAccountsLoading: false, qbIncomeAccounts: null, qbIncomeAccountId: "",
  qbAutoAccountId: "", qbAccountSaving: false, saveIncomeAccount: noop,
  qbSyncingAll: null, qbSyncAllError: null,
  qbMigrating: false, qbMigrateResult: null,
  qbMigratingInv: false, qbMigrateInvResult: null,
  qbDisconnecting: false,
  handleConnectQB: noop, handleSyncAll: noop,
  handleMigrateCustomers: noop, handleMigrateInvoices: noop, handleDisconnectQB: noop,
};

describe("QuickBooksSection", () => {
  it("shows the connect CTA when not connected", () => {
    render(<QuickBooksSection {...BASE_PROPS} />);
    expect(screen.getByText("Connect to QuickBooks")).toBeTruthy();
  });

  it("shows the connected state + disconnect when connected", () => {
    render(<QuickBooksSection {...BASE_PROPS} qbConnected={true} />);
    expect(screen.getByText("Connected to QuickBooks")).toBeTruthy();
    expect(screen.getByText("Disconnect QuickBooks")).toBeTruthy();
  });
});
