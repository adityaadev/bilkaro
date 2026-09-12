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
  Users,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import "./App.css";
import "./mobile.css";
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
const nav = [
  ["Dashboard", LayoutDashboard],
  ["Products", Package],
  ["Customers", Users],
  ["Invoices", FileText],
  ["Udhar", Wallet],
  ["Expenses", CreditCard],
  ["Reports", Boxes],
];
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
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState("");
  const loadRequest = useRef(0);
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
    try {
      const [dashboardResponse, productsResponse, customersResponse, invoicesResponse, expensesResponse] =
        await Promise.all([
          api.get("/dashboard"),
          api.get("/products"),
          api.get("/customers"),
          api.get("/invoices"),
          api.get("/expenses"),
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
    } catch (error) {
      reportError("Loading account data", error);
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
  const filteredProducts = products.filter((item) =>
    item.name.toLowerCase().includes(search.toLowerCase()),
  );
  const refresh = async () => {
    await loadData();
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
        onOpen={() => setModal("expense")}
      />
    ) : active === "Reports" ? (
      <ReportsView dashboard={dashboard} />
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
          {nav.map(([label, Icon]) => (
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
            className="nav-item"
            onClick={() => notify("Settings are coming soon")}
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
      {modal === "expense" && (
        <ExpenseModal
          expenses={expenses}
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
        <button className="primary" onClick={onAction}>
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
      <div className="table-card">
        <div className="table-head">
          <span>NAME</span>
          <span>CATEGORY / SKU</span>
          <span>SELLING PRICE</span>
          <span>STOCK</span>
          <span>ACTION</span>
        </div>
        {products.map((item) => (
          <div className="product-row" key={item.id}>
            <div className="product-name">
              <div className="product-icon">
                <Package size={16} />
              </div>
              <div>
                <strong>{item.name}</strong>
                <span>{item.sku || "No SKU"}</span>
              </div>
            </div>
            <span>{item.category || "Uncategorized"}</span>
            <strong>₹{item.selling_price}</strong>
            <span
              className={
                Number(item.current_stock) <= Number(item.low_stock_threshold)
                  ? "stock low"
                  : "stock"
              }
            >
              {item.current_stock} {item.unit}
            </span>
            <button
              className="outline row-action"
              onClick={() => remove(item.id)}
            >
              Delete
            </button>
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
      <div className="table-card">
        {customers.map((item) => (
          <div className="due-row" key={item.id}>
            <div className="avatar">{item.name.charAt(0)}</div>
            <div className="due-person">
              <strong>{item.name}</strong>
              <span>
                {item.phone || "No phone"} · {item.email || "No email"}
              </span>
            </div>
            <strong className="due-amount">₹{item.balance || 0}</strong>
            <button
              className="outline row-action"
              onClick={() => remove(item.id)}
            >
              Delete
            </button>
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
        <div className="table-card invoice-list">
          {invoices.map((invoice) => (
            <div className="invoice-row" key={invoice.id}>
              <div>
                <strong>Invoice #{invoice.id}</strong>
                <span>{invoice.customer_name || "Walk-in customer"} · {formatDate(invoice.created_at)}</span>
              </div>
              <strong>₹{Number(invoice.total).toFixed(2)}</strong>
              <span className="invoice-status">{invoice.status}</span>
              <a
                className={`outline whatsapp-action${invoiceWhatsAppUrl(invoice) ? "" : " disabled"}`}
                href={invoiceWhatsAppUrl(invoice) || undefined}
                target="_blank"
                rel="noreferrer"
                aria-disabled={!invoiceWhatsAppUrl(invoice)}
                onClick={(event) => { if (!invoiceWhatsAppUrl(invoice)) event.preventDefault() }}
              >
                <MessageCircle size={15} /> Send via WhatsApp
              </a>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <FileText size={28} />
          <strong>Create your first invoice</strong>
          <span>Stock and udhar will update when it is saved.</span>
          <button className="primary" onClick={onOpen}>
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
      <div className="table-card">
        {dueCustomers.map((item) => (
          <div className="due-row" key={item.id}>
            <div className="avatar">{item.name.charAt(0)}</div>
            <div className="due-person">
              <strong>{item.name}</strong>
              <span>{item.phone || "No phone"}</span>
            </div>
            <strong className="due-amount">₹{item.balance}</strong>
            <div className="row-actions">
              <button className="outline" onClick={onPayment}>Record</button>
              <a
                className={`outline whatsapp-action${reminderWhatsAppUrl(item) ? "" : " disabled"}`}
                href={reminderWhatsAppUrl(item) || undefined}
                target="_blank"
                rel="noreferrer"
                aria-disabled={!reminderWhatsAppUrl(item)}
                onClick={(event) => { if (!reminderWhatsAppUrl(item)) event.preventDefault() }}
              >
                <MessageCircle size={15} /> Send reminder
              </a>
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
      <div className="metric-panel">
        <span className="eyebrow">OUTSTANDING UDHAR</span>
        <strong>
          ₹{Number(dashboard?.outstandingUdhar || 0).toLocaleString("en-IN")}
        </strong>
        <span className="muted">
          {dashboard?.customers || 0} customers in your account
        </span>
      </div>
    </div>
  );
}
function Modal({ title, children, onClose }) {
  return (
    <div className="modal-backdrop">
      <div className="modal">
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
        <Field
          label="Name"
          value={form.name}
          onChange={(value) => setForm({ ...form, name: value })}
          required
        />
        <Field
          label="SKU"
          value={form.sku}
          onChange={(value) => setForm({ ...form, sku: value })}
        />
        <Field
          label="Category"
          value={form.category}
          onChange={(value) => setForm({ ...form, category: value })}
        />
        <Field
          label="Selling price"
          type="number"
          value={form.sellingPrice}
          onChange={(value) => setForm({ ...form, sellingPrice: value })}
          required
        />
        <Field
          label="Current stock"
          type="number"
          value={form.currentStock}
          onChange={(value) => setForm({ ...form, currentStock: value })}
          required
        />
        <button className="primary full" type="submit">
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
        <Field
          label="Name"
          value={form.name}
          onChange={(value) => setForm({ ...form, name: value })}
          required
        />
        <Field
          label="Phone"
          value={form.phone}
          onChange={(value) => setForm({ ...form, phone: value })}
        />
        <Field
          label="Email"
          type="email"
          value={form.email}
          onChange={(value) => setForm({ ...form, email: value })}
        />
        <Field
          label="Address"
          value={form.address}
          onChange={(value) => setForm({ ...form, address: value })}
        />
        <button className="primary full" type="submit">
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
        <label>
          Customer
          <select
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
        </label>
        <label>
          Product
          <select
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
        </label>
        <Field
          label="Quantity"
          type="number"
          value={quantity}
          onChange={setQuantity}
          required
        />
        <Field label="Paid now" type="number" value={paid} onChange={setPaid} />
        <div className="invoice-total">
          <span>Total</span>
          <strong>₹{total.toFixed(2)}</strong>
        </div>
        <button className="primary full" type="submit">
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
        <label>
          Customer
          <select
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
        </label>
        <Field
          label="Amount received"
          type="number"
          value={amount}
          onChange={setAmount}
          required
        />
        <button className="primary full" type="submit">
          Save payment
        </button>
      </form>
    </Modal>
  );
}
function Field({ label, value, onChange, type = "text", required = false }) {
  return (
    <label>
      {label}
      <input
        required={required}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
function AuthScreen({ mode, setMode, onAuthenticated }) {
  const [form, setForm] = useState({
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
  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="brand auth-brand">
          <span className="brand-mark">b</span>
          <span>bilkaro</span>
        </div>
        <div className="auth-heading">
          <span className="eyebrow">BUSINESS OPERATING SYSTEM</span>
          <h1>{mode === "signup" ? "Create your account" : "Welcome back"}</h1>
          <p>
            {mode === "signup"
              ? "Start managing your business in one place."
              : "Sign in to your workspace."}
          </p>
        </div>
        <form onSubmit={submit}>
          {mode === "signup" && (
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
          {error && <p className="auth-error">{error}</p>}
          <button className="primary full" type="submit">
            {mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>
        <button
          className="auth-toggle"
          type="button"
          onClick={() => {
            setError("");
            setMode(mode === "signup" ? "login" : "signup");
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
