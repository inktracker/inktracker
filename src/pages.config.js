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
const Account = lazy(() => import('./pages/Account'));
const BrokerDashboard = lazy(() => import('./pages/BrokerDashboard'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Embed = lazy(() => import('./pages/Embed'));
const Inventory = lazy(() => import('./pages/Inventory'));
const QuotePayment = lazy(() => import('./pages/QuotePayment'));
const QuotePaymentCancel = lazy(() => import('./pages/QuotePaymentCancel'));
const QuotePaymentSuccess = lazy(() => import('./pages/QuotePaymentSuccess'));
const QuoteRequest = lazy(() => import('./pages/QuoteRequest'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const Wizard = lazy(() => import('./pages/Wizard'));
const AdminPanel = lazy(() => import('./pages/AdminPanel'));
const ArtApproval = lazy(() => import('./pages/ArtApproval'));
const OrderStatus = lazy(() => import('./pages/OrderStatus'));
const BrokerOnboarding = lazy(() => import('./pages/BrokerOnboarding'));
const EmployeeOnboarding = lazy(() => import('./pages/EmployeeOnboarding'));
const ManagerOnboarding = lazy(() => import('./pages/ManagerOnboarding'));
const QuotesRoute = lazy(() => import('./pages/QuotesRoute'));
const OrdersRoute = lazy(() => import('./pages/OrdersRoute'));
const CustomersRoute = lazy(() => import('./pages/CustomersRoute'));
const InvoicesRoute = lazy(() => import('./pages/InvoicesRoute'));
const PerformanceRoute = lazy(() => import('./pages/PerformanceRoute'));
const Mockups = lazy(() => import('./pages/Mockups'));
const Production = lazy(() => import('./pages/Production'));
const PurchaseOrders = lazy(() => import('./pages/PurchaseOrders'));
const ShopFloor = lazy(() => import('./pages/ShopFloor'));

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
