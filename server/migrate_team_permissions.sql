-- BilKaro Team & Permissions Migration
-- Run on Neon branch: team-perms-migration (br-silent-frog-a5cichmq)
-- This migration is idempotent and can be re-run safely.

BEGIN;

-- ============================================================
-- 1. CREATE NEW TABLES
-- ============================================================

-- users: human identities (separate from businesses)
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- roles: business-scoped roles
CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, name)
);

-- permissions: global static catalog
CREATE TABLE IF NOT EXISTS permissions (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT
);

-- role_permissions: many-to-many roles <-> permissions
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- memberships: users <-> businesses with role
CREATE TABLE IF NOT EXISTS memberships (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'suspended')),
  invited_by INTEGER REFERENCES users(id),
  invited_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, business_id)
);

-- branches: optional multi-location support
CREATE TABLE IF NOT EXISTS branches (
  id SERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, name)
);

-- ============================================================
-- 2. INDEXES FOR PERFORMANCE
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_business ON memberships(business_id);
CREATE INDEX IF NOT EXISTS idx_roles_business ON roles(business_id);
CREATE INDEX IF NOT EXISTS idx_branches_business ON branches(business_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ============================================================
-- 3. SEED PERMISSIONS CATALOG (idempotent)
-- ============================================================

INSERT INTO permissions (key, name, category, description) VALUES
  -- dashboard
  ('dashboard.view', 'View Dashboard', 'dashboard', 'Access dashboard KPIs and summary'),
  -- products
  ('products.read', 'View Products', 'products', 'List and view products'),
  ('products.create', 'Create Products', 'products', 'Add new products'),
  ('products.update', 'Update Products', 'products', 'Edit existing products'),
  ('products.delete', 'Delete Products', 'products', 'Remove products'),
  -- customers
  ('customers.read', 'View Customers', 'customers', 'List and view customers'),
  ('customers.create', 'Create Customers', 'customers', 'Add new customers'),
  ('customers.update', 'Update Customers', 'customers', 'Edit existing customers'),
  ('customers.delete', 'Delete Customers', 'customers', 'Remove customers'),
  -- invoices
  ('invoices.read', 'View Invoices', 'invoices', 'List and view invoices'),
  ('invoices.create', 'Create Invoices', 'invoices', 'Create new invoices'),
  ('invoices.update', 'Update Invoices', 'invoices', 'Edit existing invoices'),
  ('invoices.delete', 'Delete Invoices', 'invoices', 'Remove invoices'),
  ('invoices.export', 'Export Invoices', 'invoices', 'Download invoice PDFs'),
  -- expenses
  ('expenses.read', 'View Expenses', 'expenses', 'List and view expenses'),
  ('expenses.create', 'Create Expenses', 'expenses', 'Add new expenses'),
  ('expenses.update', 'Update Expenses', 'expenses', 'Edit existing expenses'),
  ('expenses.delete', 'Delete Expenses', 'expenses', 'Remove expenses'),
  -- analytics
  ('analytics.view', 'View Analytics', 'analytics', 'Access analytics dashboard'),
  ('analytics.export', 'Export Analytics', 'analytics', 'Download analytics data'),
  -- reports
  ('reports.view', 'View Reports', 'reports', 'Access reports'),
  ('reports.export', 'Export Reports', 'reports', 'Download reports'),
  -- payments
  ('payments.create', 'Record Payments', 'payments', 'Record customer payments'),
  ('payments.read', 'View Payments', 'payments', 'View payment history'),
  -- restaurant
  ('restaurant.view', 'View Restaurant', 'restaurant', 'Access restaurant module'),
  ('restaurant.manage_tables', 'Manage Tables', 'restaurant', 'Create/edit table layout'),
  ('restaurant.manage_orders', 'Manage Orders', 'restaurant', 'Create/edit table orders'),
  ('restaurant.kot', 'KOT Access', 'restaurant', 'Generate kitchen order tickets'),
  -- settings
  ('settings.business_type', 'Change Business Type', 'settings', 'Modify business category'),
  ('settings.restaurant', 'Restaurant Settings', 'settings', 'Configure restaurant tables'),
  ('settings.modules', 'Manage Modules', 'settings', 'Enable/disable feature modules'),
  ('settings.team', 'Team Management', 'settings', 'Invite/remove users, assign roles'),
  -- users
  ('users.invite', 'Invite Users', 'users', 'Invite new team members'),
  ('users.manage_roles', 'Manage Roles', 'users', 'Create/edit roles and permissions'),
  ('users.remove', 'Remove Users', 'users', 'Remove team members')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 4. MIGRATE EXISTING BUSINESSES
-- ============================================================
-- This section must be run in application code (not pure SQL) because it requires
-- per-business logic: create user, create owner role, create membership, create default roles.
-- See migrate_businesses.mjs for the application-level migration script.

-- ============================================================
-- 5. ADD owner_user_id TO businesses (after migration)
-- ============================================================

ALTER TABLE businesses 
ADD COLUMN IF NOT EXISTS owner_user_id INTEGER REFERENCES users(id);

-- ============================================================
-- 6. ADD FK FROM expenses.branch_id TO branches
-- ============================================================

ALTER TABLE expenses 
DROP CONSTRAINT IF EXISTS expenses_branch_id_fkey;

ALTER TABLE expenses 
ADD CONSTRAINT expenses_branch_id_fkey 
FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL;

COMMIT;