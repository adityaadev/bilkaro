CREATE TABLE businesses (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  password_hash TEXT NOT NULL,
  category TEXT,
  business_description TEXT,
  is_existing BOOLEAN NOT NULL DEFAULT TRUE,
  years_running TEXT,
  address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE products (
  id SERIAL PRIMARY KEY, business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL, sku TEXT, category TEXT, purchase_price NUMERIC(12,2) DEFAULT 0,
  selling_price NUMERIC(12,2) DEFAULT 0, current_stock NUMERIC(12,2) DEFAULT 0,
  unit TEXT DEFAULT 'piece', low_stock_threshold NUMERIC(12,2) DEFAULT 5
);
CREATE TABLE customers (
  id SERIAL PRIMARY KEY, business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL, phone TEXT, email TEXT, address TEXT, balance NUMERIC(12,2) NOT NULL DEFAULT 0
);
CREATE TABLE invoices (
  id SERIAL PRIMARY KEY, business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id INTEGER REFERENCES customers(id), total NUMERIC(12,2) NOT NULL,
  paid NUMERIC(12,2) NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'paid',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE invoice_items (
  id SERIAL PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL, quantity NUMERIC(12,2) NOT NULL, price NUMERIC(12,2) NOT NULL
);
CREATE TABLE udhar_ledger (
  id SERIAL PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  invoice_id INTEGER REFERENCES invoices(id), type TEXT NOT NULL CHECK (type IN ('credit','payment')),
  amount NUMERIC(12,2) NOT NULL, note TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE expenses (
  id SERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id INTEGER,
  category TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  note TEXT,
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
