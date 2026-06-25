import { lazy } from 'react';
import __Layout from './Layout.jsx';

// Route components are lazy-loaded so the initial bundle ships only the shell
// (Layout + AuthContext + the landing/login path). Each page — and its heavy
// deps like recharts on Performance — splits into its own chunk fetched on
// navigation. Layout itself stays eager: it's the persistent shell and must
// never flash a Suspense fallback. See the perf analysis (route-level
// code-splitting, fix #1).
//
// `React.lazy` requires a default export from each module (all pages have one).
// The Suspense boundary lives inside LayoutWrapper in App.jsx, so the sidebar
// stays mounted and only the content area shows the loader while a chunk loads.
// On every deploy the hashed chunk filenames change. A tab still running the
// OLD index.html will request a chunk URL that now 404s the moment the user
// navigates to that route → "Failed to fetch dynamically imported module"
// (the snag screen we kept hitting after today's redeploys). lazyWithRetry
// forces ONE full reload, which pulls the fresh index.html with current
// hashes. A sessionStorage timestamp guard prevents a reload loop if the asset
// is genuinely gone (offline / bad deploy) — after that it rethrows and the
// ErrorBoundary shows the snag screen.
function lazyWithRetry(importer) {
  return lazy(async () => {
    try {
      return await importer();
    } catch (err) {
      const msg = String(err?.message || err);
      const isChunkError =
        /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|dynamically imported module/i.test(msg);
      if (isChunkError) {
        try {
          const KEY = 'it:chunk-reload-at';
          const last = Number(sessionStorage.getItem(KEY) || 0);
          if (Date.now() - last > 10000) {
            sessionStorage.setItem(KEY, String(Date.now()));
            window.location.reload();
            return new Promise(() => {}); // hold render until the reload takes over
          }
        } catch { /* sessionStorage unavailable — fall through to rethrow */ }
      }
      throw err;
    }
  });
}

const Account = lazyWithRetry(() => import('./pages/Account'));
const BrokerDashboard = lazyWithRetry(() => import('./pages/BrokerDashboard'));
const Dashboard = lazyWithRetry(() => import('./pages/Dashboard'));
const Embed = lazyWithRetry(() => import('./pages/Embed'));
const Inventory = lazyWithRetry(() => import('./pages/Inventory'));
const QuotePayment = lazyWithRetry(() => import('./pages/QuotePayment'));
const QuotePaymentCancel = lazyWithRetry(() => import('./pages/QuotePaymentCancel'));
const QuotePaymentSuccess = lazyWithRetry(() => import('./pages/QuotePaymentSuccess'));
const QuoteRequest = lazyWithRetry(() => import('./pages/QuoteRequest'));
const ResetPassword = lazyWithRetry(() => import('./pages/ResetPassword'));
const Wizard = lazyWithRetry(() => import('./pages/Wizard'));
const AdminPanel = lazyWithRetry(() => import('./pages/AdminPanel'));
const ArtApproval = lazyWithRetry(() => import('./pages/ArtApproval'));
const OrderStatus = lazyWithRetry(() => import('./pages/OrderStatus'));
const BrokerOnboarding = lazyWithRetry(() => import('./pages/BrokerOnboarding'));
const EmployeeOnboarding = lazyWithRetry(() => import('./pages/EmployeeOnboarding'));
const ManagerOnboarding = lazyWithRetry(() => import('./pages/ManagerOnboarding'));
const QuotesRoute = lazyWithRetry(() => import('./pages/QuotesRoute'));
const OrdersRoute = lazyWithRetry(() => import('./pages/OrdersRoute'));
const CustomersRoute = lazyWithRetry(() => import('./pages/CustomersRoute'));
const InvoicesRoute = lazyWithRetry(() => import('./pages/InvoicesRoute'));
const PerformanceRoute = lazyWithRetry(() => import('./pages/PerformanceRoute'));
const Mockups = lazyWithRetry(() => import('./pages/Mockups'));
const Production = lazyWithRetry(() => import('./pages/Production'));
const PurchaseOrders = lazyWithRetry(() => import('./pages/PurchaseOrders'));
const ShopFloor = lazyWithRetry(() => import('./pages/ShopFloor'));

export const PAGES = {
    "Account": Account,
    "BrokerDashboard": BrokerDashboard,
    // Shared routes — *Route dispatchers pick the broker variant when
    // user.role === "broker", else render the shop page. See
    // src/pages/QuotesRoute.jsx for the pattern. The shop-side
    // components (Customers, Orders, Invoices, Performance, Quotes)
    // are imported inside their dispatcher files; this map only
    // references the dispatchers.
    "Customers": CustomersRoute,
    "Dashboard": Dashboard,
    "Embed": Embed,
    "Inventory": Inventory,
    "Invoices": InvoicesRoute,
    "Orders": OrdersRoute,
    "QuotePayment": QuotePayment,
    "QuotePaymentCancel": QuotePaymentCancel,
    "QuotePaymentSuccess": QuotePaymentSuccess,
    "QuoteRequest": QuoteRequest,
    "Quotes": QuotesRoute,
    "ResetPassword": ResetPassword,
    "Wizard": Wizard,
    "Performance": PerformanceRoute,
    "AdminPanel": AdminPanel,
    "ArtApproval": ArtApproval,
    "OrderStatus": OrderStatus,
    "BrokerOnboarding": BrokerOnboarding,
    "EmployeeOnboarding": EmployeeOnboarding,
    "ManagerOnboarding": ManagerOnboarding,
    "Mockups": Mockups,
    "Production": Production,
    "PurchaseOrders": PurchaseOrders,
    "ShopFloor": ShopFloor,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};
