import { useEffect, useRef, useState } from "react";
import axios from "axios";
import {
  ArrowUpRight,
  Bell,
  Boxes,
  CircleHelp,
  CreditCard,
  FileText,
  LayoutDashboard,
  MessageCircle,
  Menu,
  Package,
  Plus,
  Search,
  Settings,
  ShoppingCart,
  Table,
  Users,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import "./App.css";
import "./mobile.css";
import "./desktop.css";
import ExpensesView from "./ExpensesView";

const API_BASE = "http://localhost:4000/api";
export const api = axios.create({ baseURL: API_BASE });
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("bilkaro_token");
  if (token && !config.url?.startsWith("/auth/"))
    config.headers.Authorization = `Bearer ${token}`;
  return config;
});
api.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error("[Bilkaro API error]", {
      url: error.config?.url,
      method: error.config?.method,
      status: error.response?.status,
      response: error.response?.data,
      error,
    });
    return Promise.reject(error);
  },
);

const BUSINESS_TYPES = [
  {
    id: "retail",
    label: "Retail / General Store",
    description: "Shops, supermarkets, kirana stores, boutiques",
    icon: ShoppingCart,
    defaultModules: ["dashboard", "products", "customers", "udhar", "invoices", "expenses", "reports"],
  },
  {
    id: "wholesaler",
    label: "Wholesaler",
    description: "Bulk distributors, wholesale dealers, B2B suppliers",
    icon: Boxes,
    defaultModules: ["dashboard", "products", "customers", "udhar", "invoices", "expenses", "reports"],
  },
  {
    id: "restaurant",
    label: "Restaurant / Food",
    description: "Restaurants, cafes, food trucks, catering",
    icon: ShoppingCart,
    defaultModules: ["dashboard", "tables", "menu", "kot", "invoices", "expenses", "reports"],
  },
  {
    id: "school",
    label: "School",
    description: "Schools, coaching centers, tuition classes",
    icon: Users,
    defaultModules: ["dashboard", "customers", "udhar", "expenses", "reports"],
  },
  {
    id: "services",
    label: "Services (salon, repair, etc.)",
    description: "Salons, repair shops, consultants, freelancers",
    icon: Package,
    defaultModules: ["dashboard", "customers", "invoices", "expenses", "reports"],
  },
  {
    id: "other",
    label: "Other",
    description: "Any other business type - all modules available",
    icon: CircleHelp,
    defaultModules: ["dashboard", "products", "customers", "udhar", "invoices", "expenses", "reports", "tables", "menu", "kot"],
  },
];

const MODULE_KEYS = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard, required: true },
  { key: "products", label: "Products", icon: Package },
  { key: "customers", label: "Customers", icon: Users },
  { key: "invoices", label: "Invoices", icon: FileText },
  { key: "udhar", label: "Udhar (Credit)", icon: Wallet },
  { key: "expenses", label: "Expenses", icon: CreditCard },
  { key: "reports", label: "Reports", icon: Boxes },
  { key: "tables", label: "Tables", icon: Table },
  { key: "menu", label: "Menu", icon: FileText },
  { key: "kot", label: "KOT", icon: Bell },
];

function getEnabledModules(businessType) {
  const type = BUSINESS_TYPES.find((t) => t.id === businessType);
  return type?.defaultModules || BUSINESS_TYPES.find((t) => t.id === "other").defaultModules;
}

function getModuleKeysForBusiness(businessType, customEnabledModules = []) {
  const enabled = new Set([...getEnabledModules(businessType), ...customEnabledModules]);
  return MODULE_KEYS.filter((m) => enabled.has(m.key) || m.required);
}


const errorText = (error) =>
  error.response?.data?.error || error.message || "Request failed";

function App() {
  const [token, setToken] = useState(() =>
    localStorage.getItem("bilkaro_token"),
  );
  const [user, setUser] = useState(() => readStorage("bilkaro_user"));
  const [authMode, setAuthMode] = useState("login");
  const [active, setActive] = useState("Dashboard");
  const [dashboard, setDashboard] = useState(null);
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [tables, setTables] = useState([]);
  const [restaurantSettings, setRestaurantSettings] = useState({ totalTables: 0 });
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(!!localStorage.getItem("bilkaro_token"));
  const [enabledModules, setEnabledModules] = useState(() => {
    const stored = readStorage("bilkaro_enabled_modules");
    return stored || [];
  });
  const loadRequest = useRef(0);

  const businessType = user?.businessType || "other";
  const currentNav = getModuleKeysForBusiness(businessType, enabledModules).map((m) => [m.label, m.icon]);
  const notify = (message) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3500);
  };
  const reportError = (action, error) => {
    console.error(`[Bilkaro ${action}]`, {
      url: error.config?.url,
      method: error.config?.method,
      status: error.response?.status,
      response: error.response?.data,
      error,
    });
    notify(`${action} failed: ${errorText(error)}`);
  };
  const loadData = async () => {
    const requestId = ++loadRequest.current;
    setLoading(true);
    try {
      const [dashboardResponse, productsResponse, customersResponse, invoicesResponse, expensesResponse, tablesResponse, settingsResponse] =
        await Promise.all([
          api.get("/dashboard"),
          api.get("/products"),
          api.get("/customers"),
          api.get("/invoices"),
          api.get("/expenses"),
          api.get("/restaurant/tables"),
          api.get("/restaurant/settings"),
        ]);
      if (requestId !== loadRequest.current) return;
      setDashboard(dashboardResponse.data);
      setUser({
        ...dashboardResponse.data.business,
        ownerName:
          dashboardResponse.data.business.name ||
          dashboardResponse.data.business.ownerName,
      });
      localStorage.setItem(
        "bilkaro_user",
        JSON.stringify(dashboardResponse.data.business),
      );
      setProducts(productsResponse.data);
      setCustomers(customersResponse.data);
      setInvoices(invoicesResponse.data);
      setExpenses(expensesResponse.data);
      setTables(tablesResponse.data);
      setRestaurantSettings(settingsResponse.data);
    } catch (error) {
      reportError("Loading account data", error);
    } finally {
      if (requestId === loadRequest.current) {
        setLoading(false);
      }
    }
  };
  // Account hydration is intentionally triggered by the authenticated session.
  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => {
    if (token) void loadData();
  }, [token]);
  useEffect(() => {
    const menu = document.querySelector(".mobile-menu");
    const sidebar = document.querySelector(".sidebar");
    if (!menu || !sidebar) return undefined;
    const toggleSidebar = (event) => {
      event.stopPropagation();
      sidebar.classList.toggle("open");
    };
    const closeSidebar = () => sidebar.classList.remove("open");
    menu.addEventListener("click", toggleSidebar, true);
    sidebar
      .querySelectorAll(".nav-item, .logout-side")
      .forEach((item) => item.addEventListener("click", closeSidebar, true));
    return () => {
      menu.removeEventListener("click", toggleSidebar, true);
      sidebar
        .querySelectorAll(".nav-item, .logout-side")
        .forEach((item) =>
          item.removeEventListener("click", closeSidebar, true),
        );
    };
  }, [token, active]);
  const saveSession = ({ token: nextToken, user: nextUser }) => {
    localStorage.removeItem("bilkaro_token");
    localStorage.removeItem("bilkaro_user");
    localStorage.setItem("bilkaro_token", nextToken);
    localStorage.setItem("bilkaro_user", JSON.stringify(nextUser));
    setUser(nextUser);
    setDashboard(null);
    setProducts([]);
    setCustomers([]);
    setInvoices([]);
    setExpenses([]);
    setToken(nextToken);
  };
  const logout = () => {
    localStorage.removeItem("bilkaro_token");
    localStorage.removeItem("bilkaro_user");
    setToken(null);
    setUser(null);
    setDashboard(null);
    setProducts([]);
    setCustomers([]);
    setInvoices([]);
    setExpenses([]);
    setActive("Dashboard");
  };
  if (!token)
    return (
      <AuthScreen
        mode={authMode}
        setMode={setAuthMode}
        onAuthenticated={saveSession}
      />
    );

  const isModuleEnabled = (moduleKey) => {
    const enabled = new Set([...getEnabledModules(businessType), ...enabledModules]);
    return enabled.has(moduleKey);
  };

  if (!isModuleEnabled(active.toLowerCase()) && active !== "Settings") {
    setActive("Dashboard");
  }

  const filteredProducts = products.filter((item) =>
    item.name.toLowerCase().includes(search.toLowerCase()),
  );
  const refresh = async () => {
    await loadData();
  };
  const refreshTables = async () => {
    try {
      const [tablesResponse, settingsResponse] = await Promise.all([
        api.get("/restaurant/tables"),
        api.get("/restaurant/settings"),
      ]);
      setTables(tablesResponse.data);
      setRestaurantSettings(settingsResponse.data);
    } catch (error) {
      reportError("Loading tables", error);
    }
  };
  const content =
    active === "Products" ? (
      <ProductsView
        products={filteredProducts}
        onSaved={refresh}
        onError={reportError}
        onOpen={() => setModal("product")}
      />
    ) : active === "Customers" ? (
      <CustomersView
        customers={customers}
        onSaved={refresh}
        onError={reportError}
        onOpen={() => setModal("customer")}
      />
    ) : active === "Invoices" ? (
      <InvoicesView
        products={products}
        customers={customers}
        invoices={invoices}
        onSaved={refresh}
        onError={reportError}
        onOpen={() => setModal("invoice")}
      />
    ) : active === "Udhar" ? (
      <UdharView
        customers={customers}
        onPayment={() => setModal("payment")}
        onSaved={refresh}
        onError={reportError}
      />
    ) : active === "Expenses" ? (
      <ExpensesView
        expenses={expenses}
        onSaved={refresh}
        onError={reportError}
      />
    ) : active === "Reports" ? (
      <ReportsView dashboard={dashboard} />
    ) : active === "Tables" ? (
      <TablesView
        tables={tables}
        restaurantSettings={restaurantSettings}
        onSaved={refreshTables}
        onError={reportError}
        notify={notify}
        products={products}
        customers={customers}
      />
    ) : active === "Settings" ? (
      <SettingsView
        restaurantSettings={restaurantSettings}
        onSaved={refreshTables}
        onError={reportError}
        notify={notify}
        user={user}
        enabledModules={enabledModules}
        setEnabledModules={setEnabledModules}
      />
    ) : (
      <DashboardView
        dashboard={dashboard}
        onInvoice={() => setModal("invoice")}
        onPayment={() => setModal("payment")}
        onNotify={notify}
      />
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">b</span>
          <span>bilkaro</span>
        </div>
        <div className="business-switch">
          <div className="business-avatar">{(user?.name || "B").charAt(0)}</div>
          <div>
            <strong>{user?.name || "Your business"}</strong>
            <span>{user?.category || "Business account"}</span>
          </div>
        </div>
        <nav>
          {currentNav.map(([label, Icon]) => (
            <button
              className={active === label ? "nav-item active" : "nav-item"}
              key={label}
              onClick={() => setActive(label)}
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className={active === "Settings" ? "nav-item active" : "nav-item"}
            onClick={() => setActive("Settings")}
          >
            <Settings size={18} />
            <span>Settings</span>
          </button>
          <button
            className="nav-item"
            onClick={() => notify("Help center is coming soon")}
          >
            <CircleHelp size={18} />
            <span>Help center</span>
          </button>
          <button className="logout-side" onClick={logout}>
            Log out
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <button
            className="mobile-menu"
            onClick={() => notify("Use the sidebar to navigate")}
          >
            <Menu size={20} />
          </button>
          <div className="breadcrumb">
            <span>Workspace</span>
            <span>/</span>
            <strong>{active}</strong>
          </div>
          <div className="top-actions">
            <button
              className="icon-btn"
              title="Notifications"
              onClick={() => notify("No new notifications")}
            >
              <Bell size={18} />
            </button>
            <div className="top-avatar">
              {(user?.ownerName || "AK").slice(0, 2).toUpperCase()}
            </div>
          </div>
        </header>
        <div className="content">
          <div className="mobile-heading">
            <div>
              <span className="eyebrow">YOUR BUSINESS WORKSPACE</span>
              <h1>
                Good morning, {user?.ownerName || "there"} <span>✦</span>
              </h1>
            </div>
            <div className="quick-actions">
              <button className="outline" onClick={() => setModal("payment")}>
                <CreditCard size={16} /> Record payment
              </button>
              <button className="primary" onClick={() => setModal("invoice")}>
                <Plus size={16} /> New invoice
              </button>
            </div>
          </div>
          {active === "Dashboard" && (
            <div className="search-row">
              <div className="search">
                <Search size={17} />
                <input
                  placeholder="Search products..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
            </div>
          )}
          {content}
        </div>
      </main>
      {loading && (
        <div className="loading-overlay" role="status" aria-live="polite" aria-label="Loading your business data">
          <div className="loading-skeleton">
            <div className="skeleton-bar"></div>
            <div className="skeleton-bar"></div>
            <div className="skeleton-bar"></div>
            <div className="skeleton-bar short"></div>
            <div className="skeleton-bar"></div>
            <div className="skeleton-bar"></div>
            <div className="skeleton-bar short"></div>
          </div>
          <div className="loading-spinner" aria-hidden="true" />
          <p className="loading-text">Waking up your database…</p>
        </div>
      )}
      {toast && (
        <div className="toast">
          <Zap size={16} />
          {toast}
        </div>
      )}
      {modal === "product" && (
        <ProductModal
          onClose={() => setModal(null)}
          onSaved={refresh}
          onError={reportError}
        />
      )}
      {modal === "customer" && (
        <CustomerModal
          onClose={() => setModal(null)}
          onSaved={refresh}
          onError={reportError}
        />
      )}
      {modal === "invoice" && (
        <InvoiceModal
          products={products}
          customers={customers}
          onClose={() => setModal(null)}
          onSaved={refresh}
          onError={reportError}
        />
      )}
      {modal === "payment" && (
        <PaymentModal
          customers={customers}
          onClose={() => setModal(null)}
          onSaved={refresh}
          onError={reportError}
        />
      )}
    </div>
  );
}

function readStorage(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}
function PageHeading({ title, subtitle, action, onAction }) {
  return (
    <div className="page-heading">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {action && (
        <button className="btn btn-primary" onClick={onAction}>
          <Plus size={16} /> {action}
        </button>
      )}
    </div>
  );
}
function DashboardView({ dashboard, onInvoice, onPayment, onNotify }) {
  return (
    <div className="dashboard">
      <div className="business-summary">
        <div className="business-summary-mark">
          {(dashboard?.business?.name || "B").charAt(0)}
        </div>
        <div>
          <strong>{dashboard?.business?.name || "Loading business..."}</strong>
          <span>
            {dashboard?.business?.category || "Business profile"}
            {dashboard?.business?.businessDescription
              ? ` · ${dashboard.business.businessDescription}`
              : ""}
          </span>
        </div>
        <span className="business-location">
          {dashboard?.business?.address || ""}
        </span>
        <button className="outline" onClick={onPayment}>
          Record payment
        </button>
      </div>
      <div className="kpis">
        <Kpi
          icon={ShoppingCart}
          label="Sales today"
          value={`₹${Number(dashboard?.salesToday || 0).toLocaleString("en-IN")}`}
          detail="Live from your account"
        />
        <Kpi
          icon={Users}
          label="Total customers"
          value={dashboard?.customers || 0}
          detail="Your saved customers"
        />
        <Kpi
          icon={Package}
          label="Low stock items"
          value={dashboard?.lowStock || 0}
          detail="Needs your attention"
        />
        <Kpi
          icon={Wallet}
          label="Udhar outstanding"
          value={`₹${Number(dashboard?.outstandingUdhar || 0).toLocaleString("en-IN")}`}
          detail="Current account balance"
        />
      </div>
      <div className="action-banner">
        <div className="banner-icon">
          <FileText size={22} />
        </div>
        <div>
          <strong>Ready to make a sale?</strong>
          <span>Create an invoice and update stock automatically.</span>
        </div>
        <button className="primary" onClick={onInvoice}>
          New invoice <ArrowUpRight size={15} />
        </button>
      </div>
      <button
        className="text-button"
        onClick={() => onNotify("Dashboard data is already live from the API")}
      >
        <ArrowUpRight size={14} /> Data status
      </button>
    </div>
  );
}
function Kpi({ icon: Icon, label, value, detail }) {
  return (
    <div className="kpi">
      <div className="kpi-top">
        <span>{label}</span>
        <div className="kpi-icon">
          <Icon size={17} />
        </div>
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
function ProductsView({ products, onOpen, onSaved, onError }) {
  const remove = async (id) => {
    try {
      await api.delete(`/products/${id}`);
      await onSaved();
    } catch (error) {
      onError("Delete product", error);
    }
  };
  return (
    <div className="section-view">
      <PageHeading
        title="Products"
        subtitle="Manage your inventory and stock levels"
        action="Add product"
        onAction={onOpen}
      />
      <div className="card">
        <div className="table-head">
          <div className="table-head-cell">NAME</div>
          <div className="table-head-cell">CATEGORY</div>
          <div className="table-head-cell">SKU</div>
          <div className="table-head-cell">SELLING PRICE</div>
          <div className="table-head-cell">COST PRICE</div>
          <div className="table-head-cell">MARGIN</div>
          <div className="table-head-cell">STOCK</div>
          <div className="table-head-cell">LOW STOCK</div>
          <div className="table-head-cell">UNIT</div>
          <div className="table-head-cell">ACTION</div>
        </div>
        {products.map((item) => (
          <div className="table-row" key={item.id}>
            <div className="table-cell">
              <div className="table-cell-content">
                <div className="product-icon" style={{width: 36, height: 36}}>
                  <Package size={16} />
                </div>
                <div>
                  <strong>{item.name}</strong>
                </div>
              </div>
            </div>
            <div className="table-cell">
              <span className="table-cell-content">{item.category || "Uncategorized"}</span>
            </div>
            <div className="table-cell">
              <span className="table-cell-content">{item.sku || "—"}</span>
            </div>
            <div className="table-cell">
              <strong className="table-cell-content">₹{Number(item.selling_price).toFixed(2)}</strong>
            </div>
            <div className="table-cell">
              <span className="table-cell-content">₹{Number(item.cost_price || 0).toFixed(2)}</span>
            </div>
            <div className="table-cell">
              <span className="table-cell-content" style={{color: Number(item.selling_price) > Number(item.cost_price || 0) ? 'var(--color-success)' : 'var(--color-danger)'}}>
                {item.cost_price && item.selling_price ? `${(((Number(item.selling_price) - Number(item.cost_price)) / Number(item.cost_price)) * 100).toFixed(1)}%` : '—'}
              </span>
            </div>
            <div className="table-cell">
              <span className={`table-cell-content ${Number(item.current_stock) <= Number(item.low_stock_threshold) ? 'product-stock low' : 'product-stock ok'}`}>
                {item.current_stock}
              </span>
            </div>
            <div className="table-cell">
              <span className="table-cell-content">{item.low_stock_threshold}</span>
            </div>
            <div className="table-cell">
              <span className="table-cell-content">{item.unit || 'pcs'}</span>
            </div>
            <div className="table-cell table-cell-action">
              <button className="btn btn-secondary btn-sm" onClick={() => remove(item.id)}>
                Delete
              </button>
            </div>
          </div>
        ))}
        {!products.length && (
          <div className="empty-state">
            <Package size={28} />
            <strong>No products yet</strong>
            <span>Add your first product to start tracking stock.</span>
          </div>
        )}
      </div>
    </div>
  );
}
function CustomersView({ customers, onOpen, onSaved, onError }) {
  const remove = async (id) => {
    try {
      await api.delete(`/customers/${id}`);
      await onSaved();
    } catch (error) {
      onError("Delete customer", error);
    }
  };
  return (
    <div className="section-view">
      <PageHeading
        title="Customers"
        subtitle="Your customer relationships, in one place"
        action="Add customer"
        onAction={onOpen}
      />
      <div className="card">
        <div className="table-head">
          <div className="table-head-cell">NAME</div>
          <div className="table-head-cell">PHONE</div>
          <div className="table-head-cell">EMAIL</div>
          <div className="table-head-cell">ADDRESS</div>
          <div className="table-head-cell">BALANCE</div>
          <div className="table-head-cell">TOTAL SPENT</div>
          <div className="table-head-cell">LAST VISIT</div>
          <div className="table-head-cell">ACTION</div>
        </div>
        {customers.map((item) => (
          <div className="table-row" key={item.id}>
            <div className="table-cell">
              <div className="table-cell-content">
                <div className="list-avatar" style={{width: 36, height: 36, fontSize: 'var(--font-size-sm)'}}>{item.name.charAt(0)}</div>
                <div>
                  <strong>{item.name}</strong>
                </div>
              </div>
            </div>
            <div className="table-cell">
              <span className="table-cell-content">{item.phone || "—"}</span>
            </div>
            <div className="table-cell">
              <span className="table-cell-content">{item.email || "—"}</span>
            </div>
            <div className="table-cell">
              <span className="table-cell-content" style={{maxWidth: '200px', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', display: 'block'}}>{item.address || "—"}</span>
            </div>
            <div className="table-cell">
              <strong className={`table-cell-content ${Number(item.balance) > 0 ? 'list-amount due' : ''}`}>
                ₹{Number(item.balance || 0).toFixed(2)}
              </strong>
            </div>
            <div className="table-cell">
              <span className="table-cell-content">₹{Number(item.total_spent || 0).toFixed(2)}</span>
            </div>
            <div className="table-cell">
              <span className="table-cell-content">{item.last_visit ? formatDate(item.last_visit) : "—"}</span>
            </div>
            <div className="table-cell table-cell-action">
              <button className="btn btn-secondary btn-sm" onClick={() => remove(item.id)}>
                Delete
              </button>
            </div>
          </div>
        ))}
        {!customers.length && (
          <div className="empty-state">
            <Users size={28} />
            <strong>No customers yet</strong>
            <span>Add your first customer to track sales and udhar.</span>
          </div>
        )}
      </div>
    </div>
  );
}
function whatsappUrl(phone, message) {
  const rawDigits = String(phone || "").replace(/\D/g, "");
  const digits = rawDigits.length === 10 ? `91${rawDigits}` : rawDigits;
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : "";
}

function formatDate(value) {
  return new Date(value).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function invoiceWhatsAppUrl(invoice) {
  const dueDate = new Date(invoice.created_at);
  dueDate.setDate(dueDate.getDate() + 7);
  const balance = Math.max(Number(invoice.total) - Number(invoice.paid), 0);
  const message = `Hello${invoice.customer_name ? ` ${invoice.customer_name}` : ""}, your Bilkaro invoice #${invoice.id} totals ₹${Number(invoice.total).toFixed(2)}. Paid: ₹${Number(invoice.paid).toFixed(2)}. Due: ₹${balance.toFixed(2)} by ${formatDate(dueDate)}. Thank you.`;
  return whatsappUrl(invoice.customer_phone, message);
}

function reminderWhatsAppUrl(customer) {
  const message = `Hello ${customer.name}, this is a polite reminder that ₹${Number(customer.balance).toFixed(2)} is pending on your Bilkaro account. Please make the payment when convenient. Thank you.`;
  return whatsappUrl(customer.phone, message);
}

function InvoicesView({ products, customers, invoices, onOpen }) {
  return (
    <div className="section-view">
      <PageHeading
        title="Invoices"
        subtitle="Create and track every sale"
        action="New invoice"
        onAction={onOpen}
      />
      {invoices.length ? (
        <div className="card">
          <div className="table-head">
            <div className="table-head-cell">INVOICE</div>
            <div className="table-head-cell">CUSTOMER</div>
            <div className="table-head-cell">DATE</div>
            <div className="table-head-cell">TOTAL</div>
            <div className="table-head-cell">PAID</div>
            <div className="table-head-cell">BALANCE</div>
            <div className="table-head-cell">STATUS</div>
            <div className="table-head-cell">PAYMENT</div>
            <div className="table-head-cell">ACTIONS</div>
          </div>
          {invoices.map((invoice) => (
            <div className="table-row" key={invoice.id}>
              <div className="table-cell">
                <div className="table-cell-content">
                  <strong>#{invoice.id}</strong>
                </div>
              </div>
              <div className="table-cell">
                <div className="table-cell-content">
                  <strong>{invoice.customer_name || "Walk-in customer"}</strong>
                  <span>{invoice.customer_phone || "No phone"}</span>
                </div>
              </div>
              <div className="table-cell">
                <span className="table-cell-content">{formatDate(invoice.created_at)}</span>
              </div>
              <div className="table-cell">
                <strong className="table-cell-content">₹{Number(invoice.total).toFixed(2)}</strong>
              </div>
              <div className="table-cell">
                <span className="table-cell-content">₹{Number(invoice.paid || 0).toFixed(2)}</span>
              </div>
              <div className="table-cell">
                <strong className={`table-cell-content ${Number(invoice.total) > Number(invoice.paid || 0) ? 'list-amount due' : ''}`}>
                  ₹{Math.max(Number(invoice.total) - Number(invoice.paid || 0), 0).toFixed(2)}
                </strong>
              </div>
              <div className="table-cell">
                <span className={`invoice-status ${invoice.status}`}>{invoice.status}</span>
              </div>
              <div className="table-cell">
                <span className="table-cell-content">{invoice.payment_method || '—'}</span>
              </div>
              <div className="table-cell table-cell-action">
                <a
                  className={`btn btn-secondary btn-sm whatsapp-action${invoiceWhatsAppUrl(invoice) ? "" : " disabled"}`}
                  href={invoiceWhatsAppUrl(invoice) || undefined}
                  target="_blank"
                  rel="noreferrer"
                  aria-disabled={!invoiceWhatsAppUrl(invoice)}
                  onClick={(event) => { if (!invoiceWhatsAppUrl(invoice)) event.preventDefault() }}
                >
                  <MessageCircle size={15} /> WhatsApp
                </a>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <FileText size={28} />
          <strong>Create your first invoice</strong>
          <span>Stock and udhar will update when it is saved.</span>
          <button className="btn btn-primary" onClick={onOpen}>
            <Plus size={16} /> Create invoice
          </button>
          <small>{products.length} products · {customers.length} customers available</small>
        </div>
      )}
    </div>
  );
}
function UdharView({ customers, onPayment }) {
  const dueCustomers = customers.filter((item) => Number(item.balance) > 0);
  return (
    <div className="section-view">
      <PageHeading
        title="Udhar"
        subtitle="Keep your cash flow moving"
        action="Record payment"
        onAction={onPayment}
      />
      <div className="card">
        <div className="table-head">
          <div className="table-head-cell">CUSTOMER</div>
          <div className="table-head-cell">PHONE</div>
          <div className="table-head-cell">EMAIL</div>
          <div className="table-head-cell">TOTAL SPENT</div>
          <div className="table-head-cell">BALANCE DUE</div>
          <div className="table-head-cell">LAST VISIT</div>
          <div className="table-head-cell">ACTIONS</div>
        </div>
        {dueCustomers.map((item) => (
          <div className="table-row" key={item.id}>
            <div className="table-cell">
              <div className="table-cell-content">
                <div className="list-avatar" style={{width: 36, height: 36, fontSize: 'var(--font-size-sm)'}}>{item.name.charAt(0)}</div>
                <div>
                  <strong>{item.name}</strong>
                </div>
              </div>
            </div>
            <div className="table-cell">
              <span className="table-cell-content">{item.phone || "—"}</span>
            </div>
            <div className="table-cell">
              <span className="table-cell-content">{item.email || "—"}</span>
            </div>
            <div className="table-cell">
              <span className="table-cell-content">₹{Number(item.total_spent || 0).toFixed(2)}</span>
            </div>
            <div className="table-cell">
              <strong className="list-amount due table-cell-content">₹{Number(item.balance).toFixed(2)}</strong>
            </div>
            <div className="table-cell">
              <span className="table-cell-content">{item.last_visit ? formatDate(item.last_visit) : "—"}</span>
            </div>
            <div className="table-cell table-cell-action">
              <div className="list-actions">
                <button className="btn btn-secondary btn-sm" onClick={onPayment}>Record</button>
                <a
                  className={`btn btn-secondary btn-sm whatsapp-action${reminderWhatsAppUrl(item) ? "" : " disabled"}`}
                  href={reminderWhatsAppUrl(item) || undefined}
                  target="_blank"
                  rel="noreferrer"
                  aria-disabled={!reminderWhatsAppUrl(item)}
                  onClick={(event) => { if (!reminderWhatsAppUrl(item)) event.preventDefault() }}
                >
                  <MessageCircle size={15} /> Remind
                </a>
              </div>
            </div>
          </div>
        ))}
        {!dueCustomers.length && (
          <div className="empty-state">
            <Wallet size={28} />
            <strong>No outstanding udhar</strong>
            <span>Customer balances will appear here.</span>
          </div>
        )}
      </div>
    </div>
  );
}
function ReportsView({ dashboard }) {
  return (
    <div className="section-view">
      <PageHeading title="Reports" subtitle="Live account summary" />
      <div className="card">
        <div className="card-body">
          <div style={{display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--spacing-lg)', flexWrap: 'wrap'}}>
            <div>
              <span style={{fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 'var(--spacing-xs)'}}>
                OUTSTANDING UDHAR
              </span>
              <strong style={{fontSize: 'var(--font-size-4xl)', fontWeight: 700, color: 'var(--color-text)', fontFamily: 'Georgia, serif', lineHeight: 'var(--line-height-tight)'}}>
                ₹{Number(dashboard?.outstandingUdhar || 0).toLocaleString("en-IN")}
              </strong>
            </div>
            <div style={{textAlign: 'right'}}>
              <span style={{fontSize: 'var(--font-size-base)', color: 'var(--color-text-secondary)'}}>
                {dashboard?.customers || 0} customers in your account
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
function groupProductsByCategory(products) {
  const grouped = {};
  products.forEach(product => {
    const category = product.category || "Uncategorized";
    if (!grouped[category]) grouped[category] = [];
    grouped[category].push(product);
  });
  return grouped;
}
function QuantityStepper({ value, onChange, min = 1, max = 99, ariaLabel }) {
  const handleDecrement = () => {
    if (value > min) onChange(value - 1);
  };
  const handleIncrement = () => {
    if (value < max) onChange(value + 1);
  };
  const handleInputChange = (e) => {
    const num = parseInt(e.target.value) || min;
    onChange(Math.min(Math.max(num, min), max));
  };
  const handleBlur = (e) => {
    const num = parseInt(e.target.value) || min;
    onChange(Math.min(Math.max(num, min), max));
  };
  return (
    <div className="qty-stepper" role="group" aria-label={ariaLabel}>
      <button
        type="button"
        onClick={handleDecrement}
        disabled={value <= min}
        aria-label="Decrease quantity"
      >
        <span aria-hidden="true">−</span>
      </button>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={handleInputChange}
        onBlur={handleBlur}
        aria-label="Quantity"
      />
      <button
        type="button"
        onClick={handleIncrement}
        disabled={value >= max}
        aria-label="Increase quantity"
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}
function TablesView({ tables, restaurantSettings, onSaved, onError, notify, products, customers }) {
  const [modal, setModal] = useState(null);
  const [selectedTable, setSelectedTable] = useState(null);
  const [reserveForm, setReserveForm] = useState({ customerName: "", expectedTime: "" });
  const [orderData, setOrderData] = useState(null);
  const [orderItems, setOrderItems] = useState([]);
  const [loadingOrder, setLoadingOrder] = useState(false);
  const [quantities, setQuantities] = useState({});
  const [kotData, setKotData] = useState(null);
  const [showKOTModal, setShowKOTModal] = useState(false);
  const [billPreview, setBillPreview] = useState(null);
  const [showBillModal, setShowBillModal] = useState(false);
  const [generatingBill, setGeneratingBill] = useState(false);
  const [billCustomerId, setBillCustomerId] = useState("");
  const [billPaidAmount, setBillPaidAmount] = useState("");
  const [activeCategory, setActiveCategory] = useState(() => Object.keys(groupProductsByCategory(products))[0] || "");

  const openModal = (type, table) => {
    setSelectedTable(table);
    setReserveForm({ customerName: "", expectedTime: "" });
    setModal(type);
    if (type === "occupied") {
      loadOrderData(table.id);
    }
  };

  const closeModal = () => {
    setModal(null);
    setSelectedTable(null);
    setOrderData(null);
    setOrderItems([]);
    setQuantities({});
    setKotData(null);
    setShowKOTModal(false);
    setBillPreview(null);
    setShowBillModal(false);
    setBillCustomerId("");
    setBillPaidAmount("");
  };

  const loadOrderData = async (tableId) => {
    setLoadingOrder(true);
    try {
      const response = await api.get(`/restaurant/tables/${tableId}/order`);
      setOrderData(response.data.order);
      setOrderItems(response.data.items);
    } catch (error) {
      onError("Load order", error);
    } finally {
      setLoadingOrder(false);
    }
  };

  const updateTableStatus = async (status, extra = {}) => {
    if (!selectedTable) return;
    try {
      await api.patch(`/restaurant/tables/${selectedTable.id}`, { status, ...extra });
      closeModal();
      await onSaved();
    } catch (error) {
      onError(`Update table ${status}`, error);
    }
  };

  const handleReserve = async (event) => {
    event.preventDefault();
    const expectedTime = reserveForm.expectedTime ? new Date(reserveForm.expectedTime).toISOString() : null;
    await updateTableStatus("reserved", { customerName: reserveForm.customerName || null, expectedTime });
  };

  const handleSeatNow = async () => {
    await updateTableStatus("occupied");
  };

  const handleCancelReservation = async () => {
    await updateTableStatus("vacant");
  };

  const handleSeatCustomer = async () => {
    await updateTableStatus("occupied");
  };

  const handleAddItem = async (productId) => {
    if (!selectedTable || !orderData) return;
    const qty = quantities[productId] || 1;
    if (qty < 1) return;
    try {
      const response = await api.post(`/restaurant/tables/${selectedTable.id}/order/items`, {
        items: [{ productId, quantity: qty }]
      });
      setOrderData(response.data.order);
      setOrderItems(response.data.items);
      setQuantities({ ...quantities, [productId]: 1 });
    } catch (error) {
      onError("Add item to order", error);
    }
  };

  const handleQuantityChange = (productId, value) => {
    const num = Math.max(1, parseInt(value) || 1);
    setQuantities({ ...quantities, [productId]: num });
  };

  const handleSendToKitchen = async () => {
    if (!selectedTable || !orderData) return;
    try {
      await api.post(`/restaurant/tables/${selectedTable.id}/order/send-to-kitchen`);
      const kotResponse = await api.get(`/restaurant/tables/${selectedTable.id}/kot`);
      setKotData(kotResponse.data);
      setShowKOTModal(true);
      notify("Order sent to kitchen!");
      await loadOrderData(selectedTable.id);
    } catch (error) {
      onError("Send to kitchen", error);
    }
  };

  const handleShowBillPreview = async () => {
    if (!selectedTable || !orderData) return;
    setBillCustomerId("");
    setBillPaidAmount("");
    try {
      const response = await api.get(`/restaurant/tables/${selectedTable.id}/order/bill-preview`);
      setBillPreview(response.data);
      setShowBillModal(true);
    } catch (error) {
      onError("Load bill preview", error);
    }
  };

  const handleGenerateBill = async (customerId, paid) => {
    if (!selectedTable || !orderData) return;
    setGeneratingBill(true);
    try {
      const response = await api.post(`/restaurant/tables/${selectedTable.id}/order/generate-bill`, {
        customerId: customerId || null,
        paid: paid || 0
      });
      notify(`Bill generated! Invoice #${response.data.invoice.id}`);
      setShowBillModal(false);
      closeModal();
      await onSaved();
    } catch (error) {
      onError("Generate bill", error);
    } finally {
      setGeneratingBill(false);
    }
  };

  const handlePrintKOT = () => {
    window.print();
  };

  const getStatusColor = (status) => {
    switch (status) {
      case "vacant": return "vacant";
      case "occupied": return "occupied";
      case "reserved": return "reserved";
      default: return "";
    }
  };

  const getStatusLabel = (status) => {
    switch (status) {
      case "vacant": return "Vacant";
      case "occupied": return "Occupied";
      case "reserved": return "Reserved";
      default: return status;
    }
  };

  const getOrderTotal = () => {
    return orderItems.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0);
  };

  if (!restaurantSettings.totalTables) {
    return (
      <div className="section-view">
        <PageHeading
          title="Tables"
          subtitle="Configure Restaurant Mode in Settings to set up tables"
          action="Open Settings"
          onAction={() => notify("Settings coming soon")}
        />
        <div className="empty-state">
          <Table size={28} />
          <strong>Restaurant Mode not configured</strong>
          <span>Set the total number of tables in Settings to get started.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="section-view">
      <PageHeading
        title="Tables"
        subtitle={`${tables.length} tables configured · Restaurant Mode active`}
      />
      <div className="tables-grid">
        {tables.map((table) => (
          <button
            key={table.id}
            className={`table-tile ${getStatusColor(table.status)}`}
            onClick={() => {
              if (table.status === "vacant") {
                openModal("vacant", table);
              } else if (table.status === "reserved") {
                openModal("reserved", table);
              } else if (table.status === "occupied") {
                openModal("occupied", table);
              }
            }}
          >
            <div className="table-number">Table {table.table_number}</div>
            <div className="table-status">{getStatusLabel(table.status)}</div>
            {table.status === "reserved" && table.customer_name && (
              <div className="table-reserved-info">Reserved: {table.customer_name}</div>
            )}
            {table.status === "reserved" && table.expected_time && (
              <div className="table-reserved-info">Expected: {new Date(table.expected_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
            )}
          </button>
        ))}
      </div>

      {modal === "vacant" && selectedTable && (
        <Modal title={`Table ${selectedTable.table_number} - Vacant`} onClose={closeModal}>
          <div className="order-actions">
            <button className="btn btn-primary btn-full" onClick={handleSeatCustomer}>
              Seat Customer
            </button>
            <button className="btn btn-secondary btn-full" onClick={() => openModal("reserve", selectedTable)}>
              Reserve Table
            </button>
          </div>
        </Modal>
      )}

      {modal === "reserve" && selectedTable && (
        <Modal title={`Reserve Table ${selectedTable.table_number}`} onClose={closeModal}>
          <form onSubmit={handleReserve}>
            <div className="form-group">
              <label className="form-label">Customer Name (optional)</label>
              <input
                type="text"
                className="form-input"
                value={reserveForm.customerName}
                onChange={(e) => setReserveForm({ ...reserveForm, customerName: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Expected Time (optional)</label>
              <input
                type="datetime-local"
                className="form-input"
                value={reserveForm.expectedTime}
                onChange={(e) => setReserveForm({ ...reserveForm, expectedTime: e.target.value })}
              />
            </div>
            <button className="btn btn-primary btn-full" type="submit">
              Confirm Reservation
            </button>
          </form>
        </Modal>
      )}

      {modal === "reserved" && selectedTable && (
        <Modal title={`Table ${selectedTable.table_number} - Reserved`} onClose={closeModal}>
          <div className="card" style={{marginBottom: 'var(--spacing-md)'}}>
            <div className="card-body" style={{padding: 'var(--spacing-md) var(--spacing-lg)'}}>
              <p style={{margin: 'var(--spacing-xs) 0'}}><strong>Customer:</strong> {selectedTable.customer_name || "Not specified"}</p>
              <p style={{margin: 'var(--spacing-xs) 0'}}><strong>Expected:</strong> {selectedTable.expected_time ? new Date(selectedTable.expected_time).toLocaleString() : "Not specified"}</p>
            </div>
          </div>
          <div className="order-actions">
            <button className="btn btn-primary btn-full" onClick={handleSeatNow}>
              Seat Now
            </button>
            <button className="btn btn-secondary btn-full" onClick={handleCancelReservation}>
              Cancel Reservation
            </button>
          </div>
        </Modal>
      )}

      {modal === "occupied" && selectedTable && (
        <Modal title={`Table ${selectedTable.table_number} - Order`} onClose={closeModal} className="order-modal">
          <div className="order-screen">
            <aside className="order-categories">
              <div className="categories-header">
                <h4>Categories</h4>
              </div>
              <nav className="categories-list" role="navigation" aria-label="Menu categories">
                {Object.keys(groupProductsByCategory(products)).map((category, index) => (
                  <button
                    key={category}
                    className={`category-btn ${activeCategory === category ? 'active' : ''}`}
                    onClick={() => setActiveCategory(category)}
                    role="tab"
                    aria-selected={activeCategory === category}
                  >
                    {category}
                  </button>
                ))}
              </nav>
            </aside>
            <div className="order-menu">
              <div className="menu-header">
                <h4>{activeCategory || 'Menu'}</h4>
              </div>
              {loadingOrder ? (
                <div className="loading">Loading menu...</div>
              ) : (
                <div className="menu-items-grid">
                  {(groupProductsByCategory(products)[activeCategory] || []).map(product => (
                    <button
                      key={product.id}
                      className="menu-item-tile"
                      onClick={() => handleAddItem(product.id)}
                      disabled={loadingOrder}
                      aria-label={`Add ${product.name} to order`}
                    >
                      <div className="menu-tile-info">
                        <strong>{product.name}</strong>
                        <span className="menu-tile-price">₹{Number(product.selling_price).toFixed(2)}</span>
                      </div>
                      <QuantityStepper
                        value={quantities[product.id] || 1}
                        onChange={value => handleQuantityChange(product.id, value)}
                        min={1}
                        max={99}
                        aria-label={`Quantity for ${product.name}`}
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
            <aside className="order-summary">
              <div className="order-summary-header">
                <h4>Order Summary</h4>
              </div>
              {orderItems.length === 0 ? (
                <div className="empty-order">
                  <Package size={32} />
                  <p>No items added yet</p>
                  <span>Select items from the menu to build the order</span>
                </div>
              ) : (
                <>
                  <div className="order-items-list">
                    {orderItems.map(item => (
                      <div key={item.id} className="order-summary-item">
                        <div className="order-item-details">
                          <strong>{item.name}</strong>
                          <span className="order-item-meta">{Number(item.quantity)} x ₹{Number(item.price).toFixed(2)}</span>
                        </div>
                        <div className="order-item-right">
                          <span className="order-item-total">₹{(Number(item.price) * Number(item.quantity)).toFixed(2)}</span>
                          {item.sent_to_kitchen && <span className="sent-badge">Sent</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="order-total">
                    <span>Subtotal</span>
                    <strong>₹{getOrderTotal().toFixed(2)}</strong>
                  </div>
                  <div className="order-actions">
                    <button
                      className="btn btn-primary btn-full send-kitchen-btn"
                      onClick={handleSendToKitchen}
                      disabled={orderItems.length === 0 || loadingOrder}
                    >
                      Send to Kitchen
                    </button>
                    <button
                      className="btn btn-success btn-full generate-bill-btn"
                      onClick={handleShowBillPreview}
                      disabled={orderItems.length === 0 || loadingOrder}
                    >
                      Generate Bill
                    </button>
                  </div>
                </>
              )}
            </aside>
          </div>
        </Modal>
      )}

      {showKOTModal && kotData && (
        <Modal title={`KOT - Table ${kotData.tableNumber}`} onClose={() => setShowKOTModal(false)} className="kot-modal">
          <div className="kot-view">
            <div className="kot-header">
              <h3>{kotData.businessName}</h3>
              <div className="kot-meta">
                <span>Table: {kotData.tableNumber}</span>
                <span>Order: #{kotData.orderId}</span>
                <span>{new Date(kotData.timestamp).toLocaleString()}</span>
              </div>
            </div>
            <div className="kot-items">
              {kotData.items.map(item => (
                <div key={item.id} className="kot-item">
                  <span className="kot-item-name">{item.name}</span>
                  <span className="kot-item-qty">x {Number(item.quantity).toLocaleString()}</span>
                  <span className="kot-item-price">₹{Number(item.price).toFixed(2)}</span>
                </div>
              ))}
            </div>
            <div className="kot-total">
              <span>Total: ₹{Number(kotData.totalAmount).toFixed(2)}</span>
            </div>
            <div className="kot-actions">
              <button className="btn btn-primary" onClick={handlePrintKOT}>
                Print KOT
              </button>
              <button className="btn btn-secondary" onClick={() => setShowKOTModal(false)}>
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showBillModal && billPreview && (
        <Modal title={`Bill Preview - Table ${billPreview.tableNumber}`} onClose={() => setShowBillModal(false)} className="bill-modal">
          <div className="bill-preview">
            <div className="bill-header">
              <h3>{billPreview.businessName}</h3>
              {billPreview.businessAddress && <p className="bill-address">{billPreview.businessAddress}</p>}
              <div className="bill-meta">
                <span>Table: {billPreview.tableNumber}</span>
                <span>Order: #{billPreview.orderId}</span>
                <span>{new Date(billPreview.timestamp).toLocaleString()}</span>
              </div>
            </div>
            <div className="bill-items">
              {billPreview.items.map(item => (
                <div key={item.id} className="bill-item">
                  <div className="bill-item-info">
                    <strong>{item.name}</strong>
                    <span className="bill-item-category">{item.category}</span>
                  </div>
                  <div className="bill-item-qty-price">
                    <span className="bill-item-qty">{Number(item.quantity).toLocaleString()} x ₹{Number(item.price).toFixed(2)}</span>
                    <span className="bill-item-total">₹{(Number(item.price) * Number(item.quantity)).toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="bill-total">
              <span>Total</span>
              <strong>₹{Number(billPreview.subtotal).toFixed(2)}</strong>
            </div>
            <div className="bill-actions">
              <label className="bill-field">
                <span>Customer (optional)</span>
                <select
                  value={billCustomerId || ""}
                  onChange={(e) => setBillCustomerId(e.target.value)}
                  className="form-input"
                >
                  <option value="">Walk-in</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.phone || 'No phone'})</option>
                  ))}
                </select>
              </label>
              <label className="bill-field">
                <span>Amount Paid (optional)</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={billPaidAmount}
                  onChange={(e) => setBillPaidAmount(e.target.value)}
                  className="form-input"
                  placeholder="0"
                />
              </label>
              <button
                className="btn btn-primary btn-full confirm-bill-btn"
                onClick={() => handleGenerateBill(billCustomerId || null, billPaidAmount || 0)}
                disabled={generatingBill}
              >
                {generatingBill ? "Generating..." : "Confirm & Bill"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
function SettingsView({ restaurantSettings, onSaved, onError, notify, user, enabledModules, setEnabledModules }) {
  const [totalTables, setTotalTables] = useState(restaurantSettings.totalTables || 0);
  const [saving, setSaving] = useState(false);
  const [moduleSaving, setModuleSaving] = useState(false);

  const businessType = user?.businessType || "other";
  const defaultModules = getEnabledModules(businessType);
  const availableModules = MODULE_KEYS.filter((m) => !m.required);

  const handleSave = async (event) => {
    event.preventDefault();
    if (totalTables < 0 || totalTables > 100) {
      notify("Total tables must be between 0 and 100");
      return;
    }
    setSaving(true);
    try {
      await api.post("/restaurant/settings", { totalTables });
      notify(totalTables > 0 ? `Restaurant Mode configured with ${totalTables} tables` : "Restaurant Mode disabled");
      await onSaved();
    } catch (error) {
      onError("Save restaurant settings", error);
    } finally {
      setSaving(false);
    }
  };

  const handleModuleToggle = (moduleKey) => {
    setEnabledModules((prev) => {
      const next = new Set(prev);
      if (next.has(moduleKey)) {
        next.delete(moduleKey);
      } else {
        next.add(moduleKey);
      }
      return Array.from(next);
    });
  };

  const handleSaveModules = async () => {
    setModuleSaving(true);
    try {
      localStorage.setItem("bilkaro_enabled_modules", JSON.stringify(enabledModules));
      notify("Module preferences saved");
    } catch (error) {
      onError("Save module preferences", error);
    } finally {
      setModuleSaving(false);
    }
  };

  const isModuleEnabled = (moduleKey) => {
    return defaultModules.includes(moduleKey) || enabledModules.includes(moduleKey);
  };

  const isModuleDefault = (moduleKey) => {
    return defaultModules.includes(moduleKey);
  };

  return (
    <div className="section-view">
      <PageHeading title="Settings" subtitle="Configure your business preferences" />
      <div className="settings-section">
        <h3>Enabled Modules</h3>
        <p className="settings-description">Turn modules on or off based on your needs. Default modules for your business type ({BUSINESS_TYPES.find((t) => t.id === businessType)?.label || "Other"}) are shown with a badge.</p>
        <div className="module-grid">
          {availableModules.map((module) => {
            const enabled = isModuleEnabled(module.key);
            const isDefault = isModuleDefault(module.key);
            return (
              <label key={module.key} className={`module-toggle ${enabled ? "enabled" : ""}`}>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={() => handleModuleToggle(module.key)}
                  disabled={isDefault}
                />
                <div className="module-toggle-content">
                  <module.icon size={20} className="module-toggle-icon" />
                  <div>
                    <strong className="module-toggle-label">{module.label}</strong>
                    {isDefault && <span className="module-toggle-badge">Default</span>}
                  </div>
                </div>
                <span className="module-toggle-switch" />
              </label>
            );
          })}
        </div>
        <button className="btn btn-primary" onClick={handleSaveModules} disabled={moduleSaving} style={{marginTop: 'var(--spacing-lg)'}}>
          {moduleSaving ? "Saving..." : "Save Module Preferences"}
        </button>
      </div>
      <div className="settings-section" style={{marginTop: 'var(--spacing-xl)'}}>
        <h3>Restaurant Mode</h3>
        <p className="settings-description">Enable table management for your restaurant. Set the total number of tables to auto-generate the table grid.</p>
        <form onSubmit={handleSave} className="settings-form">
          <div className="form-group">
            <label className="form-label">Total Tables</label>
            <input
              type="number"
              className="form-input"
              value={totalTables}
              onChange={(e) => setTotalTables(Number(e.target.value) || 0)}
              min="0"
              max="100"
              required
            />
          </div>
          <p className="settings-hint">Enter a number between 0 and 100. Setting to 0 disables Restaurant Mode.</p>
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save Settings"}
          </button>
        </form>
        {restaurantSettings.totalTables && (
          <div className="settings-status">
            <span className="status-badge active">Restaurant Mode Active</span>
            <span>{restaurantSettings.totalTables} tables configured</span>
          </div>
        )}
      </div>
    </div>
  );
}
function Modal({ title, children, onClose, className = "" }) {
  return (
    <div className="modal-backdrop">
      <div className={`modal ${className}`}>
        <button className="modal-close" onClick={onClose}>
          <X size={18} />
        </button>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
function ProductModal({ onClose, onSaved, onError }) {
  const [form, setForm] = useState({
    name: "",
    sku: "",
    category: "",
    sellingPrice: "",
    currentStock: "",
    unit: "piece",
    lowStockThreshold: 5,
  });
  const submit = async (event) => {
    event.preventDefault();
    try {
      await api.post("/products", form);
      onClose();
      await onSaved();
    } catch (error) {
      console.error("[Bilkaro Add product]", error);
      onError("Add product", error);
    }
  };
  return (
    <Modal title="Add product" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-group">
          <label className="form-label">Name</label>
          <input
            type="text"
            className="form-input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </div>
        <div className="form-group">
          <label className="form-label">SKU</label>
          <input
            type="text"
            className="form-input"
            value={form.sku}
            onChange={(e) => setForm({ ...form, sku: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Category</label>
          <input
            type="text"
            className="form-input"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Selling price</label>
          <input
            type="number"
            className="form-input"
            value={form.sellingPrice}
            onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })}
            required
          />
        </div>
        <div className="form-group">
          <label className="form-label">Current stock</label>
          <input
            type="number"
            className="form-input"
            value={form.currentStock}
            onChange={(e) => setForm({ ...form, currentStock: e.target.value })}
            required
          />
        </div>
        <button className="btn btn-primary btn-full" type="submit">
          Save product
        </button>
      </form>
    </Modal>
  );
}
function CustomerModal({ onClose, onSaved, onError }) {
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    address: "",
  });
  const submit = async (event) => {
    event.preventDefault();
    try {
      await api.post("/customers", form);
      onClose();
      await onSaved();
    } catch (error) {
      console.error("[Bilkaro Add customer]", error);
      onError("Add customer", error);
    }
  };
  return (
    <Modal title="Add customer" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-group">
          <label className="form-label">Name</label>
          <input
            type="text"
            className="form-input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </div>
        <div className="form-group">
          <label className="form-label">Phone</label>
          <input
            type="tel"
            className="form-input"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Email</label>
          <input
            type="email"
            className="form-input"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Address</label>
          <input
            type="text"
            className="form-input"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
        </div>
        <button className="btn btn-primary btn-full" type="submit">
          Save customer
        </button>
      </form>
    </Modal>
  );
}
function InvoiceModal({ products, customers, onClose, onSaved, onError }) {
  const [customerId, setCustomerId] = useState("");
  const [productId, setProductId] = useState(products[0]?.id || "");
  const [quantity, setQuantity] = useState(1);
  const [paid, setPaid] = useState(0);
  const product = products.find(
    (item) => String(item.id) === String(productId),
  );
  const total = Number(product?.selling_price || 0) * Number(quantity || 0);
  const submit = async (event) => {
    event.preventDefault();
    try {
      await api.post("/invoices", {
        customerId: customerId || null,
        total,
        paid,
        status: Number(paid) >= total ? "paid" : paid > 0 ? "partial" : "udhar",
        items: [
          {
            productId: Number(productId),
            quantity: Number(quantity),
            price: Number(product?.selling_price || 0),
          },
        ],
      });
      onClose();
      await onSaved();
    } catch (error) {
      console.error("[Bilkaro Create invoice]", error);
      onError("Create invoice", error);
    }
  };
  return (
    <Modal title="Create invoice" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-group">
          <label className="form-label">Customer</label>
          <select
            className="form-select"
            value={customerId}
            onChange={(event) => setCustomerId(event.target.value)}
          >
            <option value="">Walk-in customer</option>
            {customers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Product</label>
          <select
            className="form-select"
            required
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
          >
            {products.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · ₹{item.selling_price}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Quantity</label>
          <input
            type="number"
            className="form-input"
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
            required
            min="1"
          />
        </div>
        <div className="form-group">
          <label className="form-label">Paid now</label>
          <input
            type="number"
            className="form-input"
            value={paid}
            onChange={(e) => setPaid(Number(e.target.value))}
            min="0"
            step="0.01"
          />
        </div>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--spacing-md) 0', borderTop: '1px solid var(--color-border)', marginTop: 'var(--spacing-md)'}}>
          <span style={{color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-base)'}}>Total</span>
          <strong style={{fontSize: 'var(--font-size-xl)', fontWeight: 700, color: 'var(--color-text)', fontFamily: 'Georgia, serif'}}>₹{total.toFixed(2)}</strong>
        </div>
        <button className="btn btn-primary btn-full" type="submit">
          Save invoice
        </button>
      </form>
    </Modal>
  );
}
function PaymentModal({ customers, onClose, onSaved, onError }) {
  const [customerId, setCustomerId] = useState(customers[0]?.id || "");
  const [amount, setAmount] = useState("");
  const submit = async (event) => {
    event.preventDefault();
    try {
      await api.post("/payments", {
        customerId: Number(customerId),
        amount: Number(amount),
      });
      onClose();
      await onSaved();
    } catch (error) {
      console.error("[Bilkaro Record payment]", error);
      onError("Record payment", error);
    }
  };
  return (
    <Modal title="Record payment" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-group">
          <label className="form-label">Customer</label>
          <select
            className="form-select"
            required
            value={customerId}
            onChange={(event) => setCustomerId(event.target.value)}
          >
            {customers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · ₹{item.balance} due
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Amount received</label>
          <input
            type="number"
            className="form-input"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            min="0.01"
            step="0.01"
          />
        </div>
        <button className="btn btn-primary btn-full" type="submit">
          Save payment
        </button>
      </form>
    </Modal>
  );
}
function Field({ label, value, onChange, type = "text", required = false }) {
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <input
        required={required}
        type={type}
        className="form-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
function AuthScreen({ mode, setMode, onAuthenticated }) {
  const [step, setStep] = useState("type");
  const [form, setForm] = useState({
    businessType: "",
    businessName: "",
    ownerName: "",
    email: "",
    phone: "",
    password: "",
  });
  const [error, setError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    try {
      const { data } = await api.post(
        `/auth/${mode === "signup" ? "signup" : "login"}`,
        form,
      );
      onAuthenticated(data);
    } catch (requestError) {
      console.error("[Bilkaro auth]", {
        url: requestError.config?.url,
        status: requestError.response?.status,
        response: requestError.response?.data,
        error: requestError,
      });
      setError(errorText(requestError));
    }
  };

  const handleBusinessTypeSelect = (businessTypeId) => {
    setForm((prev) => ({ ...prev, businessType: businessTypeId }));
    setStep("details");
  };

  const goBack = () => {
    setStep("type");
    setError("");
  };

  const isSignup = mode === "signup";
  const headingText = isSignup ? "Create your account" : "Welcome back";
  const bodyText = isSignup ? "Start managing your business in one place." : "Sign in to your workspace.";
  const submitText = isSignup ? "Create account" : "Sign in";

  if (step === "type" && isSignup) {
    return (
      <main className="auth-page">
        <div className="auth-card">
          <div className="brand auth-brand">
            <span className="brand-mark">b</span>
            <span>bilkaro</span>
          </div>
          <div className="auth-heading">
            <span style={{fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '1.2px', display: 'block', marginBottom: 'var(--spacing-sm)'}}>BUSINESS OPERATING SYSTEM</span>
            <h1 style={{margin: 'var(--spacing-sm) 0', fontSize: 'var(--font-size-4xl)', fontWeight: 700, color: 'var(--color-text)', fontFamily: 'Georgia, serif', lineHeight: 'var(--line-height-tight)'}}>What type of business do you run?</h1>
            <p style={{margin: 0, color: 'var(--color-text-muted)', fontSize: 'var(--font-size-base)', lineHeight: 'var(--line-height-relaxed)'}}>This helps us set up the right modules for you.</p>
          </div>
          <div className="business-type-grid">
            {BUSINESS_TYPES.map((type) => (
              <button
                key={type.id}
                type="button"
                className="business-type-card"
                onClick={() => handleBusinessTypeSelect(type.id)}
              >
                <type.icon size={28} className="business-type-icon" />
                <strong className="business-type-label">{type.label}</strong>
                <span className="business-type-desc">{type.description}</span>
              </button>
            ))}
          </div>
          <button
            className="btn btn-ghost"
            type="button"
            style={{marginTop: 'var(--spacing-lg)', width: '100%'}}
            onClick={() => {
              setError("");
              setMode("login");
            }}
          >
            Already have an account? Sign in
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="brand auth-brand">
          <span className="brand-mark">b</span>
          <span>bilkaro</span>
        </div>
        <div className="auth-heading">
          <span style={{fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '1.2px', display: 'block', marginBottom: 'var(--spacing-sm)'}}>BUSINESS OPERATING SYSTEM</span>
          <h1 style={{margin: 'var(--spacing-sm) 0', fontSize: 'var(--font-size-4xl)', fontWeight: 700, color: 'var(--color-text)', fontFamily: 'Georgia, serif', lineHeight: 'var(--line-height-tight)'}}>{headingText}</h1>
          <p style={{margin: 0, color: 'var(--color-text-muted)', fontSize: 'var(--font-size-base)', lineHeight: 'var(--line-height-relaxed)'}}>{bodyText}</p>
        </div>
        {isSignup && form.businessType && (
          <div className="auth-step-indicator">
            <span className="step done">1</span>
            <span className="step-label done">Business Type</span>
            <span className="step-separator" />
            <span className="step active">2</span>
            <span className="step-label active">Details</span>
          </div>
        )}
        <form onSubmit={submit}>
          {isSignup && form.businessType && (
            <input type="hidden" name="businessType" value={form.businessType} />
          )}
          {isSignup && (
            <>
              <Field
                label="Business name"
                value={form.businessName}
                onChange={(value) => setForm({ ...form, businessName: value })}
                required
              />
              <Field
                label="Owner name"
                value={form.ownerName}
                onChange={(value) => setForm({ ...form, ownerName: value })}
                required
              />
              <Field
                label="Phone"
                value={form.phone}
                onChange={(value) => setForm({ ...form, phone: value })}
                required
              />
            </>
          )}
          <Field
            label="Email address"
            type="email"
            value={form.email}
            onChange={(value) => setForm({ ...form, email: value })}
            required
          />
          <Field
            label="Password"
            type="password"
            value={form.password}
            onChange={(value) => setForm({ ...form, password: value })}
            required
          />
          {error && <p style={{color: 'var(--color-danger)', fontSize: 'var(--font-size-sm)', marginTop: 'var(--spacing-sm)', marginBottom: 'var(--spacing-md)', background: 'var(--color-danger-bg)', padding: 'var(--spacing-sm) var(--spacing-md)', borderRadius: 'var(--radius-sm)'}}>{error}</p>}
          <div style={{display: 'flex', gap: 'var(--spacing-md)', marginTop: 'var(--spacing-sm)'}}>
            {isSignup && form.businessType && (
              <button type="button" className="btn btn-secondary" onClick={goBack} style={{flex: 1}}>
                Back
              </button>
            )}
            <button className="btn btn-primary btn-full" type="submit" style={{flex: isSignup && form.businessType ? 1 : 0, width: isSignup && form.businessType ? 'auto' : '100%'}}>
              {submitText}
            </button>
          </div>
        </form>
        <button
          className="btn btn-ghost"
          type="button"
          style={{marginTop: 'var(--spacing-lg)', width: '100%'}}
          onClick={() => {
            setError("");
            setMode(mode === "signup" ? "login" : "signup");
            setStep("type");
            setForm({ businessType: "", businessName: "", ownerName: "", email: "", phone: "", password: "" });
          }}
        >
          {mode === "signup"
            ? "Already have an account? Sign in"
            : "New to Bilkaro? Create an account"}
        </button>
      </div>
    </main>
  );
}
export default App;
