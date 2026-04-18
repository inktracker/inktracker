/**
 * pages.config.js - Page routing configuration
 * 
 * This file is AUTO-GENERATED. Do not add imports or modify PAGES manually.
 * Pages are auto-registered when you create files in the ./pages/ folder.
 * 
 * THE ONLY EDITABLE VALUE: mainPage
 * This controls which page is the landing page (shown when users visit the app).
 * 
 * Example file structure:
 * 
 *   import HomePage from './pages/HomePage';
 *   import Dashboard from './pages/Dashboard';
 *   import Settings from './pages/Settings';
 *   
 *   export const PAGES = {
 *       "HomePage": HomePage,
 *       "Dashboard": Dashboard,
 *       "Settings": Settings,
 *   }
 *   
 *   export const pagesConfig = {
 *       mainPage: "HomePage",
 *       Pages: PAGES,
 *   };
 * 
 * Example with Layout (wraps all pages):
 *
 *   import Home from './pages/Home';
 *   import Settings from './pages/Settings';
 *   import __Layout from './Layout.jsx';
 *
 *   export const PAGES = {
 *       "Home": Home,
 *       "Settings": Settings,
 *   }
 *
 *   export const pagesConfig = {
 *       mainPage: "Home",
 *       Pages: PAGES,
 *       Layout: __Layout,
 *   };
 *
 * To change the main page from HomePage to Dashboard, use find_replace:
 *   Old: mainPage: "HomePage",
 *   New: mainPage: "Dashboard",
 *
 * The mainPage value must match a key in the PAGES object exactly.
 */
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
import Setup from './pages/Setup';
import Wizard from './pages/Wizard';
import Performance from './pages/Performance';
import AdminPanel from './pages/AdminPanel';
import ArtApproval from './pages/ArtApproval';
import OrderStatus from './pages/OrderStatus';
import BrokerOnboarding from './pages/BrokerOnboarding';
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
    "Setup": Setup,
    "Wizard": Wizard,
    "Performance": Performance,
    "AdminPanel": AdminPanel,
    "ArtApproval": ArtApproval,
    "OrderStatus": OrderStatus,
    "BrokerOnboarding": BrokerOnboarding,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};