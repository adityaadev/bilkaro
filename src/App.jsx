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
  TrendingUp,
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
    defaultModules: ["dashboard", "products", "customers", "udhar", "invoices", "expenses", "analytics", "reports"],
  },
  {
    id: "wholesaler",
    label: "Wholesaler",
    description: "Bulk distributors, wholesale dealers, B2B suppliers",
    icon: Boxes,
    defaultModules: ["dashboard", "products", "customers", "udhar", "invoices", "expenses", "analytics", "reports"],
  },
  {
    id: "restaurant",
    label: "Restaurant / Food",
    description: "Restaurants, cafes, food trucks, catering",
    icon: ShoppingCart,
    defaultModules: ["dashboard", "tables", "menu", "kot", "invoices", "expenses", "analytics", "reports"],
  },
  {
    id: "school",
    label: "School",
    description: "Schools, coaching centers, tuition classes",
    icon: Users,
    defaultModules: ["dashboard", "customers", "udhar", "expenses", "analytics", "reports"],
  },
  {
    id: "services",
    label: "Services (salon, repair, etc.)",
    description: "Salons, repair shops, consultants, freelancers",
    icon: Package,
    defaultModules: ["dashboard", "customers", "invoices", "expenses", "analytics", "reports"],
  },
  {
    id: "other",
    label: "Other",
    description: "Any other business type - all modules available",
    icon: CircleHelp,
    defaultModules: ["dashboard", "products", "customers", "udhar", "invoices", "expenses", "analytics", "reports", "tables", "menu", "kot"],
  },
];

const MODULE_KEYS = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard, required: true },
  { key: "products", label: "Products", icon: Package },
  { key: "customers", label: "Customers", icon: Users },
  { key: "invoices", label: "Invoices", icon: FileText },
  { key: "udhar", label: "Udhar (Credit)", icon: Wallet },
  { key: "expenses", label: "Expenses", icon: CreditCard },
  { key: "analytics", label: "Analytics", icon: TrendingUp },
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
    ) : active === "Analytics" ? (
      <AnalyticsView onError={reportError} notify={notify} />
    ) : active === "Reports" ? (
      <ReportsView dashboard={dashboard} />
    ) : active === "Menu" ? (
      <MenuView
        products={products}
        onSaved={refresh}
        onError={reportError}
      />
    ) : active === "KOT" ? (
      <KOTView
        tables={tables}
        products={products}
        onError={reportError}
        notify={notify}
      />
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
        setUser={setUser}
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
          user={user}
          notify={notify}
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
function AnalyticsView({ onError, notify }) {
  const [analytics, setAnalytics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState('month')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const fetchAnalytics = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ period })
      if (startDate) params.append('startDate', startDate)
      if (endDate) params.append('endDate', endDate)
      const response = await api.get(`/analytics?${params.toString()}`)
      setAnalytics(response.data)
    } catch (error) {
      onError('Load analytics', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAnalytics()
  }, [period, startDate, endDate, fetchAnalytics])

  if (!analytics && loading) {
    return (
      <div className="section-view">
        <PageHeading title="Business Analytics" subtitle="Sales, expenses, and profit insights" />
        <div className="loading">Loading analytics...</div>
      </div>
    )
  }

  const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
  const formatNumber = (value) => Number(value || 0).toLocaleString('en-IN')

  const sales = analytics?.sales || {}
  const expenses = analytics?.expenses || {}
  const profit = analytics?.profit || {}
  const topProducts = analytics?.topProducts || []
  const outstanding = analytics?.outstanding || {}

  const profitColor = profit.operatingProfit >= 0 ? 'var(--color-success)' : 'var(--color-danger)'
  const grossProfitColor = profit.grossProfit >= 0 ? 'var(--color-success)' : 'var(--color-danger)'

  return (
    <div className="section-view">
      <PageHeading title="Business Analytics" subtitle="Sales, expenses, and profit insights" />

      <div className="card" style={{marginBottom: 'var(--spacing-lg)'}}>
        <div className="card-body" style={{padding: 'var(--spacing-md) var(--spacing-lg)'}}>
          <div style={{display: 'flex', gap: 'var(--spacing-md)', flexWrap: 'wrap', alignItems: 'end'}}>
            <div className="form-group" style={{flex: 1, minWidth: '160px'}}>
              <label className="form-label">Period</label>
              <select className="form-select" value={period} onChange={(e) => { setPeriod(e.target.value); setStartDate(''); setEndDate(''); }}>
                <option value="day">Today</option>
                <option value="week">This Week</option>
                <option value="month">This Month</option>
                <option value="year">This Year</option>
                <option value="custom">Custom Range</option>
              </select>
            </div>
            {period === 'custom' && (
              <>
                <div className="form-group" style={{flex: 1, minWidth: '160px'}}>
                  <label className="form-label">From</label>
                  <input type="date" className="form-input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <div className="form-group" style={{flex: 1, minWidth: '160px'}}>
                  <label className="form-label">To</label>
                  <input type="date" className="form-input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
              </>
            )}
            <button className="btn btn-primary" onClick={fetchAnalytics} disabled={loading} style={{height: 'fit-content'}}>
              <Search size={16} /> Refresh
            </button>
          </div>
        </div>
      </div>

      <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-lg)'}}>
        <div className="card kpi">
          <div className="kpi-top">
            <span>Total Sales</span>
            <div className="kpi-icon"><ShoppingCart size={17} /></div>
          </div>
          <strong style={{fontSize: 'var(--font-size-2xl)'}}>{formatCurrency(sales.total)}</strong>
          <small>{sales.invoiceCount} invoices · {formatCurrency(sales.paid)} paid</small>
        </div>
        <div className="card kpi">
          <div className="kpi-top">
            <span>Total Expenses</span>
            <div className="kpi-icon"><CreditCard size={17} /></div>
          </div>
          <strong style={{fontSize: 'var(--font-size-2xl)', color: 'var(--color-danger)'}}>{formatCurrency(expenses.total)}</strong>
          <small>{expenses.byCategory?.length || 0} categories</small>
        </div>
        <div className="card kpi">
          <div className="kpi-top">
            <span>Gross Profit</span>
            <div className="kpi-icon"><Wallet size={17} /></div>
          </div>
          <strong style={{fontSize: 'var(--font-size-2xl)', color: grossProfitColor}}>{formatCurrency(profit.grossProfit)}</strong>
          <small>Margin: {profit.grossMargin}% · Revenue: {formatCurrency(profit.revenue)}</small>
        </div>
        <div className="card kpi">
          <div className="kpi-top">
            <span>Operating Profit</span>
            <div className="kpi-icon"><Zap size={17} /></div>
          </div>
          <strong style={{fontSize: 'var(--font-size-2xl)', color: profitColor}}>{formatCurrency(profit.operatingProfit)}</strong>
          <small>Margin: {profit.operatingMargin}% · Expenses: {formatCurrency(profit.expenses)}</small>
        </div>
        <div className="card kpi">
          <div className="kpi-top">
            <span>Outstanding</span>
            <div className="kpi-icon"><Users size={17} /></div>
          </div>
          <strong style={{fontSize: 'var(--font-size-2xl)', color: 'var(--color-warning)'}}>{formatCurrency(outstanding.total)}</strong>
          <small>{outstanding.customers?.length || 0} customers</small>
        </div>
      </div>

      <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 'var(--spacing-lg)'}}>
        <div className="card">
          <div className="card-body">
            <h3 style={{marginBottom: 'var(--spacing-md)'}}>Sales Trend</h3>
            {sales.byDay?.length ? (
              <div style={{height: '280px', position: 'relative'}}>
                <SalesChart data={sales.byDay} />
              </div>
            ) : (
              <div className="empty-state" style={{padding: 'var(--spacing-xl)'}}>
                <ShoppingCart size={28} />
                <strong>No sales data</strong>
                <span>Create invoices to see sales trends.</span>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-body">
            <h3 style={{marginBottom: 'var(--spacing-md)'}}>Expenses by Category</h3>
            {expenses.byCategory?.length ? (
              <div style={{height: '280px', position: 'relative'}}>
                <ExpenseChart data={expenses.byCategory} />
              </div>
            ) : (
              <div className="empty-state" style={{padding: 'var(--spacing-xl)'}}>
                <CreditCard size={28} />
                <strong>No expense data</strong>
                <span>Add expenses to see breakdown.</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 'var(--spacing-lg)', marginTop: 'var(--spacing-lg)'}}>
        <div className="card">
          <div className="card-body">
            <h3 style={{marginBottom: 'var(--spacing-md)'}}>Top Selling Products</h3>
            {topProducts.length ? (
              <div className="table-responsive">
                <table style={{width: '100%', borderCollapse: 'collapse'}}>
                  <thead>
                    <tr style={{borderBottom: '1px solid var(--color-border)'}}>
                      <th style={{textAlign: 'left', padding: 'var(--spacing-sm)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)'}}>Product</th>
                      <th style={{textAlign: 'left', padding: 'var(--spacing-sm)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)'}}>Category</th>
                      <th style={{textAlign: 'right', padding: 'var(--spacing-sm)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)'}}>Qty</th>
                      <th style={{textAlign: 'right', padding: 'var(--spacing-sm)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)'}}>Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topProducts.map((product, index) => (
                      <tr key={index} style={{borderBottom: '1px solid var(--color-border)'}}>
                        <td style={{padding: 'var(--spacing-sm)', fontSize: 'var(--font-size-sm)'}}><strong>{product.name}</strong></td>
                        <td style={{padding: 'var(--spacing-sm)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)'}}>{product.category || '—'}</td>
                        <td style={{padding: 'var(--spacing-sm)', fontSize: 'var(--font-size-sm)', textAlign: 'right'}}>{formatNumber(product.quantity)}</td>
                        <td style={{padding: 'var(--spacing-sm)', fontSize: 'var(--font-size-sm)', textAlign: 'right', fontWeight: 500}}>{formatCurrency(product.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state" style={{padding: 'var(--spacing-xl)'}}>
                <Package size={28} />
                <strong>No product sales</strong>
                <span>Create invoices with products to see top sellers.</span>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-body">
            <h3 style={{marginBottom: 'var(--spacing-md)'}}>Outstanding Balances</h3>
            {outstanding.customers?.length ? (
              <div className="table-responsive">
                <table style={{width: '100%', borderCollapse: 'collapse'}}>
                  <thead>
                    <tr style={{borderBottom: '1px solid var(--color-border)'}}>
                      <th style={{textAlign: 'left', padding: 'var(--spacing-sm)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)'}}>Customer</th>
                      <th style={{textAlign: 'left', padding: 'var(--spacing-sm)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)'}}>Phone</th>
                      <th style={{textAlign: 'right', padding: 'var(--spacing-sm)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)'}}>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outstanding.customers.map((customer, index) => (
                      <tr key={index} style={{borderBottom: '1px solid var(--color-border)'}}>
                        <td style={{padding: 'var(--spacing-sm)', fontSize: 'var(--font-size-sm)'}}><strong>{customer.name}</strong></td>
                        <td style={{padding: 'var(--spacing-sm)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)'}}>{customer.phone || '—'}</td>
                        <td style={{padding: 'var(--spacing-sm)', fontSize: 'var(--font-size-sm)', textAlign: 'right', color: 'var(--color-danger)', fontWeight: 600}}>{formatCurrency(customer.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state" style={{padding: 'var(--spacing-xl)'}}>
                <Wallet size={28} />
                <strong>No outstanding balances</strong>
                <span>All customers are up to date.</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{marginTop: 'var(--spacing-lg)', background: 'var(--color-info-bg)', border: '1px solid var(--color-info-border)'}}>
        <div className="card-body">
          <div style={{display: 'flex', gap: 'var(--spacing-sm)', alignItems: 'flex-start'}}>
            <CircleHelp size={20} style={{color: 'var(--color-info)', marginTop: '2px', flexShrink: 0}} />
            <div style={{fontSize: 'var(--font-size-sm)', color: 'var(--color-info-text)', lineHeight: 'var(--line-height-relaxed)'}}>
              <strong>Profit Calculation Notes:</strong>
              <ul style={{margin: 'var(--spacing-xs) 0 0 var(--spacing-lg)', padding: 0}}>
                <li><strong>Gross Profit</strong> = Revenue - COGS (Cost of Goods Sold). COGS is estimated from product purchase_price × quantity sold.</li>
                <li><strong>Operating Profit</strong> = Gross Profit - Operating Expenses (from expenses table).</li>
                <li>These are <strong>estimates</strong>. Actual net profit requires accounting for taxes, depreciation, payroll, rent, and other overheads not tracked here.</li>
                <li>Ensure product <strong>purchase_price</strong> is set accurately for meaningful COGS calculation.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function SalesChart({ data }) {
  if (!data.length) return null
  const maxSales = Math.max(...data.map(d => d.sales))
  const height = 260
  const padding = { top: 20, right: 40, bottom: 40, left: 50 }
  const chartWidth = `calc(100% - ${padding.left + padding.right}px)`
  const chartHeight = height - padding.top - padding.bottom

  return (
    <svg width="100%" height={height} style={{display: 'block'}}>
      <defs>
        <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g transform={`translate(${padding.left},${padding.top})`}>
        <rect width={chartWidth} height={chartHeight} fill="url(#salesGradient)" />
        <path
          d={data.map((d, i) => {
            const x = (i / (data.length - 1 || 1)) * chartWidth
            const y = chartHeight - (d.sales / (maxSales || 1)) * chartHeight
            return `${i === 0 ? 'M' : 'L'} ${x} ${y}`
          }).join(' ')}
          stroke="var(--color-primary)"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {data.map((d, i) => {
          const x = (i / (data.length - 1 || 1)) * chartWidth
          const y = chartHeight - (d.sales / (maxSales || 1)) * chartHeight
          return (
            <circle key={i} cx={x} cy={y} r={4} fill="var(--color-primary)" stroke="var(--color-bg)" strokeWidth={2} />
          )
        })}
      </g>
      <g transform={`translate(${padding.left},${height - padding.bottom})`} style={{fontSize: '10px', fill: 'var(--color-text-muted)'}}>
        {data.map((d, i) => (
          <text key={i} x={(i / (data.length - 1 || 1)) * chartWidth} y={15} textAnchor="middle" dominantBaseline="hanging">
            {new Date(d.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </text>
        ))}
      </g>
      <g transform={`translate(${padding.left - 40},${padding.top})`} style={{fontSize: '10px', fill: 'var(--color-text-muted)'}}>
        {[0, 0.25, 0.5, 0.75, 1].map((frac) => (
          <text key={frac} x={-5} y={chartHeight * (1 - frac)} textAnchor="end" dominantBaseline="middle">
            {formatCurrency(maxSales * frac)}
          </text>
        ))}
      </g>
    </svg>
  )
}

function ExpenseChart({ data }) {
  if (!data.length) return null
  const total = data.reduce((sum, d) => sum + d.total, 0)
  const radius = 100
  const centerX = 120
  const centerY = 130
  const colors = ['var(--color-primary)', 'var(--color-success)', 'var(--color-warning)', 'var(--color-danger)', 'var(--color-info)', 'var(--color-purple)', 'var(--color-pink)', 'var(--color-teal)']

  return (
    <div style={{display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'center', justifyContent: 'center', height: '280px'}}>
      <svg width={240} height={260} viewBox="0 0 240 260">
        {data.map((d, i) => {
          const percentage = d.total / total
          const startAngle = data.slice(0, i).reduce((sum, item) => sum + (item.total / total) * 360, 0)
          const endAngle = startAngle + percentage * 360
          const largeArc = percentage > 0.5 ? 1 : 0
          const startX = centerX + radius * Math.cos((startAngle - 90) * Math.PI / 180)
          const startY = centerY + radius * Math.sin((startAngle - 90) * Math.PI / 180)
          const endX = centerX + radius * Math.cos((endAngle - 90) * Math.PI / 180)
          const endY = centerY + radius * Math.sin((endAngle - 90) * Math.PI / 180)
          return (
            <path
              key={i}
              d={`M ${centerX} ${centerY} L ${startX} ${startY} A ${radius} ${radius} 0 ${largeArc} 1 ${endX} ${endY} Z`}
              fill={colors[i % colors.length]}
              stroke="var(--color-bg)"
              strokeWidth={2}
            />
          )
        })}
        <circle cx={centerX} cy={centerY} r={50} fill="var(--color-bg)" />
        <text x={centerX} y={centerY - 5} textAnchor="middle" dominantBaseline="middle" fontSize="18" fontWeight="bold" fill="var(--color-text)" fontFamily="Georgia, serif">
          {formatCurrency(total)}
        </text>
        <text x={centerX} y={centerY + 15} textAnchor="middle" dominantBaseline="middle" fontSize="10" fill="var(--color-text-secondary)">
          Total Expenses
        </text>
      </svg>
      <div style={{flex: 1, maxWidth: '300px'}}>
        {data.map((d, i) => (
          <div key={i} style={{display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)', marginBottom: 'var(--spacing-sm)', padding: 'var(--spacing-xs) var(--spacing-sm)', background: 'var(--color-surface)', borderRadius: 'var(--radius-sm)'}}>
            <div style={{width: 12, height: 12, borderRadius: '50%', background: colors[i % colors.length]}} />
            <span style={{flex: 1, fontSize: 'var(--font-size-sm)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{d.category}</span>
            <span style={{fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text)'}}>{formatCurrency(d.total)}</span>
            <span style={{fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)'}}>{((d.total / total) * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
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
function MenuView({ products, onSaved, onError }) {
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [form, setForm] = useState({
    name: "",
    category: "",
    sellingPrice: "",
    currentStock: "",
    unit: "piece",
    lowStockThreshold: 5,
  });

  const categories = [...new Set(products.map(p => p.category || "Uncategorized"))].sort();

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingProduct) {
        await api.put(`/products/${editingProduct.id}`, form);
      } else {
        await api.post("/products", form);
      }
      setShowModal(false);
      setEditingProduct(null);
      setForm({ name: "", category: "", sellingPrice: "", currentStock: "", unit: "piece", lowStockThreshold: 5 });
      await onSaved();
    } catch (error) {
      onError("Save menu item", error);
    }
  };

  const handleEdit = (product) => {
    setEditingProduct(product);
    setForm({
      name: product.name,
      category: product.category || "",
      sellingPrice: product.selling_price,
      currentStock: product.current_stock,
      unit: product.unit || "piece",
      lowStockThreshold: product.low_stock_threshold || 5,
    });
    setShowModal(true);
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this menu item?")) return;
    try {
      await api.delete(`/products/${id}`);
      await onSaved();
    } catch (error) {
      onError("Delete menu item", error);
    }
  };

  const handleNew = () => {
    setEditingProduct(null);
    setForm({ name: "", category: "", sellingPrice: "", currentStock: "", unit: "piece", lowStockThreshold: 5 });
    setShowModal(true);
  };

  const grouped = {};
  products.forEach(p => {
    const cat = p.category || "Uncategorized";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(p);
  });

  return (
    <div className="section-view">
      <PageHeading title="Menu Management" subtitle="Manage your restaurant menu items" action="Add Menu Item" onAction={handleNew} />
      {Object.keys(grouped).length === 0 ? (
        <div className="empty-state">
          <FileText size={28} />
          <strong>No menu items yet</strong>
          <span>Add your first menu item to get started.</span>
        </div>
      ) : (
        <div className="card">
          {Object.entries(grouped).map(([category, items]) => (
            <div key={category} style={{marginBottom: 'var(--spacing-xl)'}}>
              <h4 style={{margin: '0 0 var(--spacing-md) var(--spacing-xl)', padding: '0 var(--spacing-xl)', fontSize: 'var(--font-size-lg)', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid var(--color-border)', paddingBottom: 'var(--spacing-sm)'}}>
                {category}
              </h4>
              <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 'var(--spacing-md)', padding: '0 var(--spacing-xl) var(--spacing-xl)'}}>
                {items.map(item => (
                  <div key={item.id} className="menu-item-tile" style={{display: 'flex', flexDirection: 'column', padding: 'var(--spacing-md)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', gap: 'var(--spacing-sm)'}}>
                    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'}}>
                      <div>
                        <strong style={{fontSize: 'var(--font-size-base)'}}>{item.name}</strong>
                        {item.sku && <span style={{fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)'}}>{item.sku}</span>}
                      </div>
                      <span style={{fontSize: 'var(--font-size-lg)', fontWeight: 700, color: 'var(--color-primary)'}}>
                        ₹{Number(item.selling_price).toFixed(2)}
                      </span>
                    </div>
                    <div style={{display: 'flex', gap: 'var(--spacing-xs)', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)'}}>
                      <span>Stock: {item.current_stock} {item.unit || 'pcs'}</span>
                      {Number(item.current_stock) <= Number(item.low_stock_threshold) && (
                        <span style={{color: 'var(--color-warning)'}}>⚠ Low</span>
                      )}
                    </div>
                    <div style={{display: 'flex', gap: 'var(--spacing-sm)', marginTop: 'var(--spacing-xs)'}}>
                      <button className="btn btn-secondary btn-sm" onClick={() => handleEdit(item)} style={{flex: 1}}>Edit</button>
                      <button className="btn btn-danger btn-sm" onClick={() => handleDelete(item.id)} style={{flex: 1}}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <Modal title={editingProduct ? "Edit Menu Item" : "Add Menu Item"} onClose={() => { setShowModal(false); setEditingProduct(null); setForm({ name: "", category: "", sellingPrice: "", currentStock: "", unit: "piece", lowStockThreshold: 5 }); }}>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Name</label>
              <input type="text" className="form-input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required />
            </div>
            <div className="form-group">
              <label className="form-label">Category</label>
              <select className="form-select" value={form.category} onChange={e => setForm({...form, category: e.target.value})}>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
                <option value="">New Category...</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Selling Price</label>
              <input type="number" className="form-input" value={form.sellingPrice} onChange={e => setForm({...form, sellingPrice: e.target.value})} required min="0" step="0.01" />
            </div>
            <div className="form-group">
              <label className="form-label">Current Stock</label>
              <input type="number" className="form-input" value={form.currentStock} onChange={e => setForm({...form, currentStock: e.target.value})} required min="0" />
            </div>
            <div className="form-group">
              <label className="form-label">Unit</label>
              <input type="text" className="form-input" value={form.unit} onChange={e => setForm({...form, unit: e.target.value})} />
            </div>
            <div className="form-group">
              <label className="form-label">Low Stock Threshold</label>
              <input type="number" className="form-input" value={form.lowStockThreshold} onChange={e => setForm({...form, lowStockThreshold: Number(e.target.value)})} required min="1" />
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function KOTView({ tables, products, onError, notify }) {
  const [selectedTableId, setSelectedTableId] = useState("");
  const [kotData, setKotData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showPrint, setShowPrint] = useState(false);

  const handleLoadKOT = async () => {
    if (!selectedTableId) return;
    setLoading(true);
    try {
      const response = await api.get(`/restaurant/tables/${selectedTableId}/kot`);
      setKotData(response.data);
      setShowPrint(true);
    } catch (error) {
      onError("Load KOT", error);
      setShowPrint(false);
    } finally {
      setLoading(false);
    }
  };

  const occupiedTables = tables.filter(t => t.status === "occupied");

  if (occupiedTables.length === 0) {
    return (
      <div className="section-view">
        <PageHeading title="KOT (Kitchen Order Ticket)" subtitle="Generate kitchen tickets for active tables" />
        <div className="empty-state">
          <Bell size={28} />
          <strong>No occupied tables</strong>
          <span>Tables must be occupied with active orders to generate KOT.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="section-view">
      <PageHeading title="KOT (Kitchen Order Ticket)" subtitle="Generate and print kitchen tickets for active orders" />
      <div className="card" style={{maxWidth: '480px'}}>
        <div className="card-body">
          <div className="form-group">
            <label className="form-label">Select Table</label>
            <select className="form-select" value={selectedTableId} onChange={e => setSelectedTableId(e.target.value)}>
              <option value="">-- Choose a table --</option>
              {occupiedTables.map(t => (
                <option key={t.id} value={t.id}>Table {t.table_number} {t.customer_name ? `({t.customer_name})` : ""}</option>
              ))}
            </select>
          </div>
          <button className="btn btn-primary btn-full" onClick={handleLoadKOT} disabled={loading || !selectedTableId}>
            {loading ? "Generating..." : "Generate KOT"}
          </button>
        </div>
      </div>

      {showPrint && kotData && (
        <div className="modal-backdrop" onClick={() => setShowPrint(false)}>
          <div className="modal kot-modal" style={{width: 'min(500px, 95vw)', maxHeight: '90vh'}} onClick={e => e.stopPropagation()}>
            <div className="kot-view" style={{padding: 'var(--spacing-xl)'}}>
              <div className="kot-header" style={{textAlign: 'center', marginBottom: 'var(--spacing-lg)', paddingBottom: 'var(--spacing-md)', borderBottom: '2px solid var(--color-text)'}}>
                <h3 style={{margin: '0 0 var(--spacing-sm)', fontSize: 'var(--font-size-2xl)', fontWeight: 700, fontFamily: 'Georgia, serif'}}>{kotData.businessName}</h3>
                <div className="kot-meta" style={{display: 'flex', justifyContent: 'center', gap: 'var(--spacing-lg)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', flexWrap: 'wrap'}}>
                  <span>Table: {kotData.tableNumber}</span>
                  <span>Order: #{kotData.orderId}</span>
                  <span>{new Date(kotData.timestamp).toLocaleString()}</span>
                </div>
              </div>
              <div className="kot-items">
                {kotData.items.map(item => (
                  <div key={item.id} className="kot-item" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--spacing-md) var(--spacing-sm)', borderBottom: '1px dashed var(--color-border)'}}>
                    <span className="kot-item-name" style={{flex: 1, fontSize: 'var(--font-size-base)'}}>{item.name}</span>
                    <span className="kot-item-qty" style={{color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', margin: '0 var(--spacing-md)', whiteSpace: 'nowrap'}}>
                      x {Number(item.quantity).toLocaleString()}
                    </span>
                    <span className="kot-item-price" style={{fontSize: 'var(--font-size-base)', fontWeight: 600, whiteSpace: 'nowrap'}}>
                      ₹{Number(item.price).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="kot-total" style={{textAlign: 'right', padding: 'var(--spacing-md) var(--spacing-sm)', borderTop: '2px solid var(--color-text)', fontSize: 'var(--font-size-xl)', fontWeight: 700, fontFamily: 'Georgia, serif'}}>
                Total: ₹{Number(kotData.totalAmount).toFixed(2)}
              </div>
              <div className="kot-actions" style={{display: 'flex', gap: 'var(--spacing-md)', justifyContent: 'center', marginTop: 'var(--spacing-lg)'}}>
                <button className="btn btn-primary" onClick={() => window.print()}>
                  Print KOT
                </button>
                <button className="btn btn-secondary" onClick={() => setShowPrint(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsView({ restaurantSettings, onSaved, onError, notify, user, enabledModules, setEnabledModules, setUser }) {
  const [totalTables, setTotalTables] = useState(restaurantSettings.totalTables || 0);
  const [saving, setSaving] = useState(false);
  const [moduleSaving, setModuleSaving] = useState(false);
  const [businessType, setBusinessType] = useState(user?.businessType || "other");
  const [typeSaving, setTypeSaving] = useState(false);

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

  const handleBusinessTypeChange = async (newType) => {
    setBusinessType(newType);
    setTypeSaving(true);
    try {
      const response = await api.post("/business/update-type", { category: newType });
      setUser(response.data.user);
      notify(`Business type updated to ${BUSINESS_TYPES.find(t => t.id === newType)?.label || newType}`);
    } catch (error) {
      onError("Update business type", error);
      setBusinessType(user?.businessType || "other");
    } finally {
      setTypeSaving(false);
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
        <h3>Business Type</h3>
        <p className="settings-description">Change your business type to enable the right modules for your needs. This will reset default modules based on the new type.</p>
        <div className="module-grid">
          {BUSINESS_TYPES.map((type) => (
            <label
              key={type.id}
              className={`module-toggle ${businessType === type.id ? "enabled" : ""}`}
              onClick={() => handleBusinessTypeChange(type.id)}
              style={{cursor: 'pointer', opacity: typeSaving ? 0.7 : 1}}
            >
              <input
                type="radio"
                name="businessType"
                checked={businessType === type.id}
                onChange={() => handleBusinessTypeChange(type.id)}
                style={{display: 'none'}}
              />
              <div className="module-toggle-content">
                <type.icon size={20} className="module-toggle-icon" />
                <div>
                  <strong className="module-toggle-label">{type.label}</strong>
                  <span className="module-toggle-desc">{type.description}</span>
                </div>
              </div>
              <span className="module-toggle-switch" />
            </label>
          ))}
        </div>
        {typeSaving && <p className="settings-hint" style={{marginTop: 'var(--spacing-md)'}}>Updating business type...</p>}
      </div>
      <div className="settings-section" style={{marginTop: 'var(--spacing-xl)'}}>
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
function Modal({ title, children, onClose, className = "", footer }) {
  return (
    <div className="modal-backdrop">
      <div className={`modal ${className}`}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          {children}
        </div>
        {footer && (
          <div className="modal-footer">
            {footer}
          </div>
        )}
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
  const footer = (
    <button className="btn btn-primary btn-full" onClick={() => {
      const formEl = document.querySelector('.modal-body form');
      if (formEl) formEl.requestSubmit();
    }}>
      Save product
    </button>
  );
  return (
    <Modal title="Add product" onClose={onClose} footer={footer}>
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
  const footer = (
    <button className="btn btn-primary btn-full" onClick={() => {
      const formEl = document.querySelector('.modal-body form');
      if (formEl) formEl.requestSubmit();
    }}>
      Save customer
    </button>
  );
  return (
    <Modal title="Add customer" onClose={onClose} footer={footer}>
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
      </form>
    </Modal>
  );
}
function InvoiceModal({ products, customers, onClose, onSaved, onError, user, notify }) {
  const [customerId, setCustomerId] = useState("")
  const [items, setItems] = useState([{ productId: products[0]?.id || "", quantity: 1, gstPercent: 0, discountPercent: 0 }])
  const [paid, setPaid] = useState(0)
  const [gstEnabled, setGstEnabled] = useState(true)
  const [generatingPdf, setGeneratingPdf] = useState(false)
  const [invoiceId, setInvoiceId] = useState(null)

  const getProduct = (productId) => products.find((p) => String(p.id) === String(productId))

  const addItem = () => {
    setItems([...items, { productId: products[0]?.id || "", quantity: 1, gstPercent: gstEnabled ? 18 : 0, discountPercent: 0 }])
  }

  const removeItem = (index) => {
    if (items.length <= 1) return
    setItems(items.filter((_, i) => i !== index))
  }

  const updateItem = (index, field, value) => {
    setItems(items.map((item, i) => (i === index ? { ...item, [field]: value } : item)))
  }

  const calculateTotals = () => {
    let subtotal = 0
    let totalGst = 0
    let totalDiscount = 0
    items.forEach((item) => {
      const product = getProduct(item.productId)
      if (!product) return
      const qty = Number(item.quantity) || 0
      const price = Number(product.selling_price) || 0
      const gstPercent = gstEnabled ? (Number(item.gstPercent) || 0) : 0
      const discountPercent = Number(item.discountPercent) || 0
      const itemTotal = qty * price
      const discountAmount = (itemTotal * discountPercent) / 100
      const taxableAmount = itemTotal - discountAmount
      const gstAmount = (taxableAmount * gstPercent) / 100
      subtotal += itemTotal
      totalDiscount += discountAmount
      totalGst += gstAmount
    })
    const cgst = totalGst / 2
    const sgst = totalGst / 2
    const grandTotal = subtotal - totalDiscount + totalGst
    return { subtotal, totalDiscount, totalGst, cgst, sgst, grandTotal }
  }

  const { subtotal, totalDiscount, totalGst, cgst, sgst, grandTotal } = calculateTotals()

  const submit = async (event) => {
    event.preventDefault()
    try {
      const invoiceItems = items
        .filter((item) => item.productId)
        .map((item) => {
          const product = getProduct(item.productId)
          const price = Number(product?.selling_price || 0)
          const qty = Number(item.quantity) || 1
          const itemTotal = qty * price
          const discountPercent = Number(item.discountPercent) || 0
          const discountAmount = (itemTotal * discountPercent) / 100
          return {
            productId: Number(item.productId),
            quantity: qty,
            price,
            gstPercent: gstEnabled ? (Number(item.gstPercent) || 0) : 0,
            discountPercent,
            discountAmount,
          }
        })

      if (!invoiceItems.length) return

      const response = await api.post("/invoices", {
        customerId: customerId || null,
        total: grandTotal,
        paid,
        items: invoiceItems,
      })

      setInvoiceId(response.data.id)
      notify("Invoice created successfully!")
      await onSaved()
    } catch (error) {
      console.error("[Bilkaro Create invoice]", error)
      onError("Create invoice", error)
    }
  }

  const handleDownloadPdf = async () => {
    if (!invoiceId) return
    setGeneratingPdf(true)
    try {
      const response = await api.post(`/invoices/${invoiceId}/pdf`, null, { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', `invoice-${invoiceId}.pdf`)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (error) {
      console.error("[Bilkaro PDF generation]", error)
      onError("Generate PDF", error)
    } finally {
      setGeneratingPdf(false)
    }
  }

  const footer = (
    <div style={{display: 'flex', gap: 'var(--spacing-md)', flexWrap: 'wrap', width: '100%'}}>
      <button className="btn btn-primary btn-full" onClick={() => {
        const formEl = document.querySelector('.modal-body form');
        if (formEl) formEl.requestSubmit();
      }} style={{flex: 1, minWidth: '200px'}}>
        Save invoice
      </button>
      {invoiceId && (
        <button
          type="button"
          className="btn btn-success btn-full"
          onClick={handleDownloadPdf}
          disabled={generatingPdf}
          style={{flex: 1, minWidth: '200px'}}
        >
          {generatingPdf ? "Generating..." : "Download PDF"}
        </button>
      )}
    </div>
  );

  return (
    <Modal title="Create invoice" onClose={onClose} className="invoice-modal" footer={footer}>
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
          <label className="form-label" style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
            GST Enabled
            <input
              type="checkbox"
              checked={gstEnabled}
              onChange={(e) => {
                const enabled = e.target.checked
                setGstEnabled(enabled)
                if (!enabled) {
                  setItems(items.map(item => ({ ...item, gstPercent: 0 })))
                }
              }}
              style={{width: 'auto', marginLeft: 'var(--spacing-sm)'}}
            />
          </label>
        </div>

        <div className="invoice-items">
          {items.map((item, index) => {
            const product = getProduct(item.productId)
            const price = Number(product?.selling_price || 0)
            const qty = Number(item.quantity) || 0
            const gstPercent = gstEnabled ? (Number(item.gstPercent) || 0) : 0
            const discountPercent = Number(item.discountPercent) || 0
            const itemTotal = price * qty
            const discountAmount = (itemTotal * discountPercent) / 100
            const taxableAmount = itemTotal - discountAmount
            const gstAmount = (taxableAmount * gstPercent) / 100
            const rowTotal = taxableAmount + gstAmount
            return (
              <div key={index} className="invoice-item-row" style={{display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr auto', gap: 'var(--spacing-sm)', alignItems: 'end', padding: 'var(--spacing-sm)', background: 'var(--color-surface)', borderRadius: 'var(--radius-sm)', marginBottom: 'var(--spacing-sm)'}}>
                <div>
                  <label className="form-label" style={{fontSize: 'var(--font-size-xs)'}}>Product</label>
                  <select
                    className="form-select"
                    value={item.productId}
                    onChange={(e) => updateItem(index, 'productId', e.target.value)}
                    style={{fontSize: 'var(--font-size-sm)'}}
                  >
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} · ₹{p.selling_price}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label" style={{fontSize: 'var(--font-size-xs)'}}>Qty</label>
                  <input
                    type="number"
                    className="form-input"
                    value={item.quantity}
                    onChange={(e) => updateItem(index, 'quantity', Number(e.target.value) || 1)}
                    min="1"
                    style={{fontSize: 'var(--font-size-sm)'}}
                  />
                </div>
                <div>
                  <label className="form-label" style={{fontSize: 'var(--font-size-xs)'}}>Price</label>
                  <input
                    type="number"
                    className="form-input"
                    value={price.toFixed(2)}
                    readOnly
                    style={{fontSize: 'var(--font-size-sm)', background: 'var(--color-bg)'}}
                  />
                </div>
                <div>
                  <label className="form-label" style={{fontSize: 'var(--font-size-xs)'}}>Disc %</label>
                  <input
                    type="number"
                    className="form-input"
                    value={item.discountPercent}
                    onChange={(e) => updateItem(index, 'discountPercent', Number(e.target.value) || 0)}
                    min="0"
                    max="100"
                    step="0.5"
                    style={{fontSize: 'var(--font-size-sm)'}}
                  />
                </div>
                {gstEnabled && (
                  <div>
                    <label className="form-label" style={{fontSize: 'var(--font-size-xs)'}}>GST %</label>
                    <input
                      type="number"
                      className="form-input"
                      value={item.gstPercent}
                      onChange={(e) => updateItem(index, 'gstPercent', Number(e.target.value) || 0)}
                      min="0"
                      max="100"
                      step="0.5"
                      style={{fontSize: 'var(--font-size-sm)'}}
                    />
                  </div>
                )}
                <div style={{textAlign: 'right'}}>
                  <label className="form-label" style={{fontSize: 'var(--font-size-xs)'}}>Total</label>
                  <div style={{fontSize: 'var(--font-size-base)', fontWeight: 600, color: 'var(--color-primary)'}}>₹{rowTotal.toFixed(2)}</div>
                </div>
                {items.length > 1 && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => removeItem(index)}
                    style={{height: 'fit-content', marginBottom: 'var(--spacing-xs)'}}
                    aria-label="Remove item"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            )
          })}
          <button type="button" className="btn btn-secondary" onClick={addItem} style={{width: 'fit-content', marginTop: 'var(--spacing-sm)'}}>
            <Plus size={16} /> Add item
          </button>
        </div>

        <div className="invoice-totals" style={{marginTop: 'var(--spacing-lg)', padding: 'var(--spacing-md)', background: 'var(--color-surface)', borderRadius: 'var(--radius-md)'}}>
          <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--spacing-xs)'}}>
            <span>Subtotal</span>
            <strong>₹{subtotal.toFixed(2)}</strong>
          </div>
          {totalDiscount > 0 && (
            <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--spacing-xs)', color: 'var(--color-success)', fontSize: 'var(--font-size-sm)'}}>
              <span>Discount</span>
              <span>-₹{totalDiscount.toFixed(2)}</span>
            </div>
          )}
          {gstEnabled && totalGst > 0 && (
            <>
              <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--spacing-xs)', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)'}}>
                <span>CGST</span>
                <span>₹{cgst.toFixed(2)}</span>
              </div>
              <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--spacing-xs)', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)'}}>
                <span>SGST</span>
                <span>₹{sgst.toFixed(2)}</span>
              </div>
              <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--spacing-sm)', fontWeight: 500}}>
                <span>Total GST</span>
                <span>₹{totalGst.toFixed(2)}</span>
              </div>
            </>
          )}
          <div style={{display: 'flex', justifyContent: 'space-between', paddingTop: 'var(--spacing-sm)', borderTop: '1px solid var(--color-border)', fontSize: 'var(--font-size-lg)', fontWeight: 700}}>
            <span>Grand Total</span>
            <span style={{color: 'var(--color-primary)', fontFamily: 'Georgia, serif'}}>₹{grandTotal.toFixed(2)}</span>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Paid now</label>
          <input
            type="number"
            className="form-input"
            value={paid}
            onChange={(e) => setPaid(Number(e.target.value) || 0)}
            min="0"
            step="0.01"
          />
        </div>
      </form>
    </Modal>
  )
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
  const footer = (
    <button className="btn btn-primary btn-full" onClick={() => {
      const formEl = document.querySelector('.modal-body form');
      if (formEl) formEl.requestSubmit();
    }}>
      Save payment
    </button>
  );
  return (
    <Modal title="Record payment" onClose={onClose} footer={footer}>
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
