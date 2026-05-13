import Account from './pages/Account';
import BrokerDashboard from './pages/BrokerDashboard';
import Customers from './pages/Customers';
import Dashboard from './pages/Dashboard';
import Embed from './pages/Embed';
import Inventory from './pages/Inventory';
import Invoices from './pages/Invoices';
import Orders from './pages/Orders';
import QuotePayment from './pages/QuotePayment';
import QuotePaymentCancel from './pages/QuotePaymentCancel';
import QuotePaymentSuccess from './pages/QuotePaymentSuccess';
import QuoteRequest from './pages/QuoteRequest';
import Quotes from './pages/Quotes';
import Wizard from './pages/Wizard';
import Performance from './pages/Performance';
import AdminPanel from './pages/AdminPanel';
import ArtApproval from './pages/ArtApproval';
import OrderStatus from './pages/OrderStatus';
import BrokerOnboarding from './pages/BrokerOnboarding';
import Mockups from './pages/Mockups';
import Production from './pages/Production';
import ShopFloor from './pages/ShopFloor';
import __Layout from './Layout.jsx';

export const PAGES = {
    "Account": Account,
    "BrokerDashboard": BrokerDashboard,
    "Customers": Customers,
    "Dashboard": Dashboard,
    "Embed": Embed,
    "Inventory": Inventory,
    "Invoices": Invoices,
    "Orders": Orders,
    "QuotePayment": QuotePayment,
    "QuotePaymentCancel": QuotePaymentCancel,
    "QuotePaymentSuccess": QuotePaymentSuccess,
    "QuoteRequest": QuoteRequest,
    "Quotes": Quotes,
    "Wizard": Wizard,
    "Performance": Performance,
    "AdminPanel": AdminPanel,
    "ArtApproval": ArtApproval,
    "OrderStatus": OrderStatus,
    "BrokerOnboarding": BrokerOnboarding,
    "Mockups": Mockups,
    "Production": Production,
    "ShopFloor": ShopFloor,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};
