import Account from './pages/Account';
import BrokerDashboard from './pages/BrokerDashboard';
// Shop pages for shared routes (Customers, Orders, Invoices,
// Performance, Quotes) are imported inside their *Route dispatchers
// — not here — so this file stays focused on the route → component
// map. Dashboard, Embed, Inventory, etc. are still imported below
// because they aren't behind a dispatcher.
import Dashboard from './pages/Dashboard';
import Embed from './pages/Embed';
import Inventory from './pages/Inventory';
import QuotePayment from './pages/QuotePayment';
import QuotePaymentCancel from './pages/QuotePaymentCancel';
import QuotePaymentSuccess from './pages/QuotePaymentSuccess';
import QuoteRequest from './pages/QuoteRequest';
import ResetPassword from './pages/ResetPassword';
import Wizard from './pages/Wizard';
import AdminPanel from './pages/AdminPanel';
import ArtApproval from './pages/ArtApproval';
import OrderStatus from './pages/OrderStatus';
import BrokerOnboarding from './pages/BrokerOnboarding';
import EmployeeOnboarding from './pages/EmployeeOnboarding';
import QuotesRoute from './pages/QuotesRoute';
import OrdersRoute from './pages/OrdersRoute';
import CustomersRoute from './pages/CustomersRoute';
import InvoicesRoute from './pages/InvoicesRoute';
import PerformanceRoute from './pages/PerformanceRoute';
import Mockups from './pages/Mockups';
import Production from './pages/Production';
import PurchaseOrders from './pages/PurchaseOrders';
import ShopFloor from './pages/ShopFloor';
import __Layout from './Layout.jsx';

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
