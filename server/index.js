import express from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import { auth, requirePermission, requireRole, requireBusinessOwnership, generateAccessToken, generateRefreshToken, verifyRefreshToken, getPermissionsForRole } from './middleware/auth.js'
import { pool, getDatabaseStatus } from './db.js'

const app = express()
const port = process.env.PORT || 4000
const allowedOrigins = new Set(['http://localhost:5173', 'http://localhost:5174', 'http://127.0.0.1:5173', 'http://127.0.0.1:5174'])
app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)), credentials: false }))
app.use(express.json())

const normalizeEnabledModules = (value) => {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

const roundCurrency = (value) => Number(Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100)

const calculateInvoiceItemTotals = (item = {}) => {
  const quantity = Math.max(Number(item.quantity ?? 1), 0)
  const unitPrice = Math.max(Number(item.price ?? item.sellingPrice ?? 0), 0)
  const discountPercent = Math.max(Number(item.discountPercent ?? item.discount_percent ?? 0), 0)
  const gstPercent = Math.max(Number(item.gstPercent ?? item.gst_percent ?? 0), 0)
  const baseAmount = roundCurrency(quantity * unitPrice)
  const discountAmount = roundCurrency(baseAmount * (discountPercent / 100))
  const taxableAmount = roundCurrency(baseAmount - discountAmount)
  const gstAmount = roundCurrency(taxableAmount * (gstPercent / 100))
  const totalLine = roundCurrency(taxableAmount + gstAmount)

  return {
    quantity,
    unitPrice,
    discountPercent,
    gstPercent,
    baseAmount,
    discountAmount,
    taxableAmount,
    gstAmount,
    totalLine,
  }
}

const calculateInvoiceTotals = (items = []) => {
  const lines = items.map(calculateInvoiceItemTotals)
  const subtotal = roundCurrency(lines.reduce((sum, line) => sum + line.baseAmount, 0))
  const discount = roundCurrency(lines.reduce((sum, line) => sum + line.discountAmount, 0))
  const gst = roundCurrency(lines.reduce((sum, line) => sum + line.gstAmount, 0))
  const total = roundCurrency(lines.reduce((sum, line) => sum + line.totalLine, 0))
  return { subtotal, discount, gst, total, lines }
}

const toBusiness = (business) => business && ({ id: business.id, name: business.name, ownerName: business.owner_name, email: business.email, phone: business.phone, category: business.category, businessType: business.category, businessDescription: business.business_description, isExisting: business.is_existing, yearsRunning: business.years_running, address: business.address, enabledModules: normalizeEnabledModules(business.enabled_modules || business.enabledModules || []) })

const toSessionUser = (business, role = 'owner', teamMemberId = null) => ({
  ...toBusiness(business),
  role,
  teamMemberId: teamMemberId ?? business?.team_member_id ?? business?.teamMemberId ?? null,
  enabledModules: normalizeEnabledModules(business?.enabled_modules || business?.enabledModules || []),
})

async function getNewAuthContext(client, email, businessId) {
  const result = await client.query(`
    SELECT m.id AS membership_id, m.user_id, m.role_id, m.business_id, r.name AS role_name,
           u.id AS user_id, u.email, u.full_name, tm.id AS team_member_id
    FROM memberships m
    JOIN roles r ON r.id = m.role_id
    JOIN users u ON u.id = m.user_id
    LEFT JOIN team_members tm ON tm.business_id = m.business_id AND tm.email = u.email
    WHERE u.email = $1 AND m.business_id = $2 AND m.status = 'active'
    ORDER BY m.joined_at DESC NULLS LAST
    LIMIT 1
  `, [email, businessId])
  return result.rows[0] || null
}

async function hasNewAuthTables(client) {
  const result = await client.query(`
    SELECT to_regclass('public.users') AS users_table,
           to_regclass('public.roles') AS roles_table,
           to_regclass('public.memberships') AS memberships_table
  `)
  const row = result.rows[0] || {}
  return Boolean(row.users_table && row.roles_table && row.memberships_table)
}

app.get('/api/health', async (_req, res) => res.json({ ok: true, database: Boolean(pool), ...getDatabaseStatus() }))
app.post('/api/auth/signup', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Set DATABASE_URL to enable account creation' })

  const { businessName, ownerName, email, phone, password, category, businessDescription, isExisting, yearsRunning, address } = req.body
  if (!businessName || !ownerName || !email || !password) {
    return res.status(400).json({ error: 'Business name, owner name, email, and password are required' })
  }

  const passwordHash = await bcrypt.hash(password, 12)
  const defaultModulesMap = {
    retail: ["dashboard", "products", "customers", "udhar", "invoices", "expenses", "analytics", "reports", "team"],
    wholesaler: ["dashboard", "products", "customers", "udhar", "invoices", "expenses", "analytics", "reports", "team"],
    restaurant: ["dashboard", "tables", "menu", "kot", "invoices", "expenses", "analytics", "reports", "team"],
    school: ["dashboard", "customers", "udhar", "expenses", "analytics", "reports", "team"],
    services: ["dashboard", "customers", "invoices", "expenses", "analytics", "reports", "team"],
    other: ["dashboard", "products", "customers", "udhar", "invoices", "expenses", "analytics", "reports", "tables", "menu", "kot", "team"]
  }
  const defaultModules = defaultModulesMap[category] || defaultModulesMap.other
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query('INSERT INTO businesses (name, owner_name, email, phone, password_hash, category, business_description, is_existing, years_running, address, enabled_modules) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, name, owner_name, email, phone, category, business_description, is_existing, years_running, address, enabled_modules', [businessName, ownerName, email, phone, passwordHash, category, businessDescription, isExisting !== 'new', yearsRunning || null, address, JSON.stringify(defaultModules)])
    const business = result.rows[0]

    let userId = null
    let roleId = null
    let teamMemberId = null
    const authTableCheck = await client.query(`
      SELECT to_regclass('public.users') AS users_table,
             to_regclass('public.roles') AS roles_table,
             to_regclass('public.memberships') AS memberships_table
    `)
    const hasNewAuthTables = authTableCheck.rows[0]?.users_table && authTableCheck.rows[0]?.roles_table && authTableCheck.rows[0]?.memberships_table

    if (hasNewAuthTables) {
      const userResult = await client.query(
        `INSERT INTO users (email, password_hash, full_name, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, TRUE, NOW(), NOW())
         ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, full_name = EXCLUDED.full_name, updated_at = NOW()
         RETURNING id`,
        [email, passwordHash, ownerName]
      )
      userId = userResult.rows[0].id

      const ownerRole = await client.query(
        `INSERT INTO roles (business_id, name, description, is_system, created_at)
         VALUES ($1, 'owner', 'Business owner', TRUE, NOW())
         ON CONFLICT (business_id, name) DO UPDATE SET description = EXCLUDED.description
         RETURNING id`,
        [business.id]
      )
      roleId = ownerRole.rows[0].id

      await client.query(
        `INSERT INTO memberships (user_id, business_id, role_id, status, joined_at, created_at)
         VALUES ($1, $2, $3, 'active', NOW(), NOW())
         ON CONFLICT (user_id, business_id) DO UPDATE SET role_id = EXCLUDED.role_id, status = 'active', joined_at = NOW()
         RETURNING id`,
        [userId, business.id, roleId]
      )
    }

    const tmResult = await client.query('INSERT INTO team_members (business_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (business_id, email) DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, role = EXCLUDED.role RETURNING id', [business.id, ownerName, email, passwordHash, 'owner'])
    teamMemberId = tmResult.rows[0].id

    await client.query('COMMIT')

    const accessPayload = { userId: userId || teamMemberId, businessId: business.id, roleId: roleId || null, roleName: 'owner', permissions: getPermissionsForRole('owner') }
    const refreshPayload = { userId: userId || teamMemberId, businessId: business.id, roleId: roleId || null, roleName: 'owner', permissions: getPermissionsForRole('owner') }

    const accessToken = generateAccessToken(accessPayload)
    const refreshToken = generateRefreshToken(refreshPayload)

    res.status(201).json({ token: accessToken, refreshToken, user: toSessionUser(business, 'owner', teamMemberId) })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
})
app.post('/api/auth/login', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Set DATABASE_URL to enable login' })
  const { email, password } = req.body
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' })

  let teamMember = await pool.query('SELECT * FROM team_members WHERE email = $1 ORDER BY created_at DESC LIMIT 1', [email])
  let business
  let role = 'owner'
  let teamMemberId = null
  let userId = null
  let roleId = null

  if (teamMember.rows.length > 0) {
    const member = teamMember.rows[0]
    if (!(await bcrypt.compare(password, member.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    business = await pool.query('SELECT id, name, owner_name, email, phone, category, business_description, is_existing, years_running, address, enabled_modules FROM businesses WHERE id = $1', [member.business_id])
    role = member.role || 'owner'
    teamMemberId = member.id

    const newMembership = await getNewAuthContext(pool, email, member.business_id)
    if (newMembership) {
      userId = newMembership.user_id
      roleId = newMembership.role_id
      role = newMembership.role_name || role
      teamMemberId = newMembership.team_member_id || teamMemberId
    }
  } else {
    const result = await pool.query('SELECT * FROM businesses WHERE email = $1', [email])
    const user = result.rows[0]
    if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Invalid email or password' })

    business = await pool.query('SELECT id, name, owner_name, email, phone, category, business_description, is_existing, years_running, address, enabled_modules FROM businesses WHERE id = $1', [user.id])

    const existingMember = await pool.query('SELECT * FROM team_members WHERE business_id = $1 AND email = $2 ORDER BY created_at DESC LIMIT 1', [user.id, email])
    if (existingMember.rows.length > 0) {
      role = existingMember.rows[0].role || 'owner'
      teamMemberId = existingMember.rows[0].id
    } else {
      role = 'owner'
      const insertResult = await pool.query('INSERT INTO team_members (business_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (business_id, email) DO NOTHING RETURNING id', [user.id, user.owner_name, email, user.password_hash, 'owner'])
      teamMemberId = insertResult.rows[0]?.id || null
    }

    const newMembership = await getNewAuthContext(pool, email, user.id)
    if (newMembership) {
      userId = newMembership.user_id
      roleId = newMembership.role_id
      role = newMembership.role_name || role
      teamMemberId = newMembership.team_member_id || teamMemberId
    }
  }

  const businessRecord = business.rows[0]
  if (!businessRecord) return res.status(401).json({ error: 'Business not found for this account' })

  const resolvedUserId = userId || teamMemberId || businessRecord.id
  const accessPayload = { userId: resolvedUserId, businessId: businessRecord.id, roleId: roleId || null, roleName: role, permissions: getPermissionsForRole(role) }
  const refreshPayload = { userId: resolvedUserId, businessId: businessRecord.id, roleId: roleId || null, roleName: role, permissions: getPermissionsForRole(role) }

  const accessToken = generateAccessToken(accessPayload)
  const refreshToken = generateRefreshToken(refreshPayload)

  res.json({ token: accessToken, refreshToken, user: toSessionUser(businessRecord, role, teamMemberId) })
})
app.post('/api/auth/refresh', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' })
  const { refreshToken } = req.body
  if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' })

  try {
    const decoded = verifyRefreshToken(refreshToken)
    if (!decoded.userId || !decoded.businessId) {
      return res.status(401).json({ error: 'Invalid refresh token' })
    }

    let membershipResult = await pool.query(`
      SELECT m.id AS membership_id, m.user_id, m.role_id, m.business_id, r.name AS role_name,
             u.id AS user_id, u.email, tm.id AS team_member_id
      FROM memberships m
      JOIN roles r ON r.id = m.role_id
      JOIN users u ON u.id = m.user_id
      LEFT JOIN team_members tm ON tm.business_id = m.business_id AND tm.email = u.email
      WHERE m.user_id = $1 AND m.business_id = $2 AND m.status = 'active'
      LIMIT 1
    `, [decoded.userId, decoded.businessId])

    if (membershipResult.rows.length === 0) {
      membershipResult = await pool.query(`
        SELECT tm.id as membership_id, tm.id as team_member_id, tm.business_id, tm.email, tm.role as role_name, tm.id as user_id
        FROM team_members tm
        WHERE tm.id = $1 AND tm.business_id = $2
      `, [decoded.userId, decoded.businessId])
    }

    if (membershipResult.rows.length === 0) {
      return res.status(401).json({ error: 'Membership not found or inactive' })
    }

    const membership = membershipResult.rows[0]
    const resolvedUserId = membership.user_id || decoded.userId
    const roleName = membership.role_name || decoded.roleName || 'owner'
    const permissions = getPermissionsForRole(roleName)
    const newAccessPayload = { userId: resolvedUserId, businessId: decoded.businessId, roleId: membership.role_id || null, roleName, permissions }
    const newRefreshPayload = { userId: resolvedUserId, businessId: decoded.businessId, roleId: membership.role_id || null, roleName, permissions }

    const newAccessToken = generateAccessToken(newAccessPayload)
    const newRefreshToken = generateRefreshToken(newRefreshPayload)

    res.json({ token: newAccessToken, refreshToken: newRefreshToken })
  } catch (e) {
    if (e.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Refresh token expired', code: 'REFRESH_EXPIRED' })
    }
    return res.status(401).json({ error: 'Invalid refresh token' })
  }
})
app.get('/api/dashboard', auth, requirePermission('dashboard.view'), async (req, res) => {
  if (!pool) return res.json({ business: null, salesToday: 0, customers: 0, lowStock: 0, outstandingUdhar: 0 })
  const businessId = req.businessId
  const [business, sales, customers, lowStock, udhar, teamMember] = await Promise.all([
    pool.query('SELECT id, name, owner_name, email, phone, category, business_description, is_existing, years_running, address, enabled_modules FROM businesses WHERE id=$1', [businessId]),
    pool.query('SELECT COALESCE(SUM(total),0) AS value FROM invoices WHERE business_id=$1 AND created_at::date=CURRENT_DATE', [businessId]),
    pool.query('SELECT COUNT(*) AS value FROM customers WHERE business_id=$1', [businessId]),
    pool.query('SELECT COUNT(*) AS value FROM products WHERE business_id=$1 AND current_stock <= low_stock_threshold', [businessId]),
    pool.query('SELECT COALESCE(SUM(balance),0) AS value FROM customers WHERE business_id=$1', [businessId]),
    pool.query('SELECT id, role FROM team_members WHERE business_id=$1 AND email=$2 ORDER BY created_at DESC LIMIT 1', [businessId, req.email])
  ])
  const role = req.roleName || teamMember.rows[0]?.role || 'owner'
  const teamMemberId = req.membershipId || teamMember.rows[0]?.id || req.userId
  const businessRow = business.rows[0]
  res.json({ business: toSessionUser(businessRow, role, teamMemberId), salesToday: sales.rows[0].value, customers: customers.rows[0].value, lowStock: lowStock.rows[0].value, outstandingUdhar: udhar.rows[0].value, role, teamMemberId })
})
app.get('/api/products', auth, requirePermission('products.read'), async (req, res) => {
  const result = await pool.query('SELECT id, name, sku, category, purchase_price, selling_price, current_stock, unit, low_stock_threshold FROM products WHERE business_id=$1 ORDER BY name', [req.businessId])
  res.json(result.rows)
})
app.post('/api/products', auth, requirePermission('products.create'), async (req, res) => {
  const { name, sku, category, purchasePrice = 0, sellingPrice = 0, currentStock = 0, unit = 'piece', lowStockThreshold = 5 } = req.body
  if (!name) return res.status(400).json({ error: 'Product name is required' })
  const result = await pool.query('INSERT INTO products (business_id, name, sku, category, purchase_price, selling_price, current_stock, unit, low_stock_threshold) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *', [req.businessId, name, sku, category, purchasePrice, sellingPrice, currentStock, unit, lowStockThreshold])
  res.status(201).json(result.rows[0])
})
app.delete('/api/products/:id', auth, requirePermission('products.delete'), async (req, res) => {
  const result = await pool.query('DELETE FROM products WHERE id=$1 AND business_id=$2 RETURNING id', [req.params.id, req.businessId])
  if (!result.rows.length) return res.status(404).json({ error: 'Product not found' })
  res.status(204).end()
})
app.get('/api/customers', auth, requirePermission('customers.read'), async (req, res) => {
  const result = await pool.query('SELECT id, name, phone, email, address, balance FROM customers WHERE business_id=$1 ORDER BY name', [req.businessId])
  res.json(result.rows)
})
app.post('/api/customers', auth, requirePermission('customers.create'), async (req, res) => {
  const { name, phone, email, address } = req.body
  if (!name) return res.status(400).json({ error: 'Customer name is required' })
  const result = await pool.query('INSERT INTO customers (business_id, name, phone, email, address) VALUES ($1,$2,$3,$4,$5) RETURNING *', [req.businessId, name, phone, email, address])
  res.status(201).json(result.rows[0])
})
app.delete('/api/customers/:id', auth, requirePermission('customers.delete'), async (req, res) => {
  const result = await pool.query('DELETE FROM customers WHERE id=$1 AND business_id=$2 RETURNING id', [req.params.id, req.businessId])
  if (!result.rows.length) return res.status(404).json({ error: 'Customer not found' })
  res.status(204).end()
})
app.post('/api/invoices', auth, requirePermission('invoices.create'), async (req, res) => {
  const { customerId, items = [], total, paid = 0, status } = req.body
  const safeItems = Array.isArray(items) ? items : []

  if (!safeItems.length) {
    return res.status(400).json({ error: 'Invoice items are required' })
  }

  const computed = calculateInvoiceTotals(safeItems)
  const normalizedTotal = roundCurrency(total ?? computed.total)
  const normalizedPaid = roundCurrency(paid)

  if (Math.abs(normalizedTotal - computed.total) > 0.01) {
    return res.status(400).json({ error: 'Invoice total does not match the itemized calculation', expectedTotal: computed.total, receivedTotal: normalizedTotal })
  }

  if (normalizedPaid < 0 || normalizedPaid > normalizedTotal + 0.01) {
    return res.status(400).json({ error: 'Paid amount must be between 0 and the invoice total' })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const customer = customerId ? await client.query('SELECT id FROM customers WHERE id=$1 AND business_id=$2', [customerId, req.businessId]) : { rows: [{ id: null }] }
    if (customerId && !customer.rows.length) {
      throw Object.assign(new Error('Customer does not belong to this business'), { status: 403 })
    }

    for (const item of safeItems) {
      const product = await client.query('SELECT id, current_stock FROM products WHERE id=$1 AND business_id=$2 FOR UPDATE', [item.productId, req.businessId])
      if (!product.rows.length) {
        throw Object.assign(new Error('Product does not belong to this business'), { status: 403 })
      }
      const line = calculateInvoiceItemTotals(item)
      if (Number(product.rows[0].current_stock) < line.quantity) {
        throw Object.assign(new Error(`Insufficient stock for product ${item.productId}`), { status: 400 })
      }
    }

    const businessResult = await client.query('SELECT enabled_modules FROM businesses WHERE id=$1', [req.businessId])
    const enabledModules = businessResult.rows[0]?.enabled_modules || []
    const hasUdhar = Array.isArray(enabledModules) && enabledModules.includes('udhar')
    const defaultStatus = status || (normalizedPaid >= normalizedTotal ? 'paid' : normalizedPaid > 0 ? 'partial' : (hasUdhar ? 'udhar' : 'unpaid'))
    const invoice = await client.query('INSERT INTO invoices (business_id, customer_id, total, paid, status) VALUES ($1,$2,$3,$4,$5) RETURNING *', [req.businessId, customerId || null, normalizedTotal, normalizedPaid, defaultStatus])

    for (const item of safeItems) {
      const line = calculateInvoiceItemTotals(item)
      await client.query(
        'INSERT INTO invoice_items (invoice_id, product_id, quantity, price, gst_percent, discount_percent, discount_amount) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [invoice.rows[0].id, item.productId, line.quantity, line.unitPrice, line.gstPercent, line.discountPercent, line.discountAmount]
      )
      await client.query('UPDATE products SET current_stock=current_stock-$1 WHERE id=$2 AND business_id=$3', [line.quantity, item.productId, req.businessId])
    }

    const due = Math.max(roundCurrency(normalizedTotal - normalizedPaid), 0)
    if (customerId && due > 0) {
      await client.query('UPDATE customers SET balance=balance+$1 WHERE id=$2 AND business_id=$3', [due, customerId, req.businessId])
      await client.query("INSERT INTO udhar_ledger (customer_id, invoice_id, type, amount, note) VALUES ($1,$2,'credit',$3,'Invoice credit')", [customerId, invoice.rows[0].id, due])
    }

    await client.query('COMMIT')
    res.status(201).json({ ...invoice.rows[0], totals: computed, status: defaultStatus })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
})
app.get('/api/invoices', auth, requirePermission('invoices.read'), async (req, res) => {
  const result = await pool.query('SELECT i.id, i.total, i.paid, i.status, i.created_at, c.name AS customer_name, c.phone AS customer_phone FROM invoices i LEFT JOIN customers c ON c.id=i.customer_id WHERE i.business_id=$1 ORDER BY i.created_at DESC', [req.businessId])
  res.json(result.rows)
})
app.get('/api/expenses', auth, requirePermission('expenses.read'), async (req, res) => {
  const result = await pool.query('SELECT * FROM expenses WHERE business_id=$1 ORDER BY expense_date DESC', [req.businessId])
  res.json(result.rows)
})
app.post('/api/expenses', auth, requirePermission('expenses.create'), async (req, res) => {
  const { category, amount, note, expense_date, branch_id } = req.body
  if (!category || !amount || !expense_date) return res.status(400).json({ error: 'Category, amount, and date are required' })
  const result = await pool.query(
    'INSERT INTO expenses (business_id, branch_id, category, amount, note, expense_date) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [req.businessId, branch_id || null, category, amount, note, expense_date]
  )
  res.status(201).json(result.rows[0])
})
app.delete('/api/expenses/:id', auth, requirePermission('expenses.delete'), async (req, res) => {
  const result = await pool.query('DELETE FROM expenses WHERE id=$1 AND business_id=$2 RETURNING id', [req.params.id, req.businessId])
  if (!result.rows.length) return res.status(404).json({ error: 'Expense not found' })
  res.status(204).end()
})

app.get('/api/analytics', auth, requirePermission('analytics.view'), async (req, res) => {
  if (!pool) return res.json({ sales: {}, expenses: {}, profit: {}, topProducts: [], outstanding: {} })
  const businessId = req.businessId
  const { period = 'month', startDate, endDate } = req.query

  let dateFilter = ''
  let dateParams = [businessId]
  let paramIndex = 2

  if (startDate && endDate) {
    dateFilter = `AND i.created_at::date BETWEEN $${paramIndex} AND $${paramIndex + 1}`
    dateParams.push(startDate, endDate)
    paramIndex += 2
  } else {
    switch (period) {
      case 'day':
        dateFilter = "AND i.created_at::date = CURRENT_DATE"
        break
      case 'week':
        dateFilter = "AND i.created_at::date >= CURRENT_DATE - INTERVAL '6 days'"
        break
      case 'month':
        dateFilter = "AND i.created_at::date >= DATE_TRUNC('month', CURRENT_DATE)"
        break
      case 'year':
        dateFilter = "AND i.created_at::date >= DATE_TRUNC('year', CURRENT_DATE)"
        break
    }
  }

  const expenseDateFilter = dateFilter.replace('i.created_at', 'expense_date')

  try {
    const [
      salesSummary,
      salesByDay,
      expensesSummary,
      expensesByCategory,
      topProducts,
      outstandingBalances,
      profitEstimate
    ] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(i.total),0) as total_sales, COALESCE(SUM(i.paid),0) as total_paid, COUNT(*) as invoice_count FROM invoices i WHERE i.business_id=$1 ${dateFilter}`, dateParams),
      pool.query(`SELECT i.created_at::date as date, COALESCE(SUM(i.total),0) as daily_sales, COUNT(*) as invoice_count FROM invoices i WHERE i.business_id=$1 ${dateFilter} GROUP BY i.created_at::date ORDER BY date`, dateParams),
      pool.query(`SELECT COALESCE(SUM(amount),0) as total_expenses FROM expenses WHERE business_id=$1 ${expenseDateFilter}`, dateParams),
      pool.query(`SELECT category, COALESCE(SUM(amount),0) as total FROM expenses WHERE business_id=$1 ${expenseDateFilter} GROUP BY category ORDER BY total DESC`, dateParams),
      pool.query(`
        SELECT p.name, p.category, COALESCE(SUM(ii.quantity),0) as total_qty, COALESCE(SUM(ii.quantity * ii.price),0) as total_revenue
        FROM invoice_items ii
        JOIN invoices i ON i.id = ii.invoice_id
        JOIN products p ON p.id = ii.product_id
        WHERE i.business_id=$1 ${dateFilter}
        GROUP BY p.id, p.name, p.category
        ORDER BY total_revenue DESC
        LIMIT 10
      `, dateParams),
      pool.query(`SELECT c.name, c.phone, c.balance FROM customers c WHERE business_id=$1 AND balance > 0 ORDER BY c.balance DESC LIMIT 20`, [businessId]),
      pool.query(`
        SELECT 
          COALESCE(SUM(i.total),0) as revenue,
          COALESCE(SUM(ii.quantity * p.purchase_price),0) as cogs,
          COALESCE(SUM(e.amount),0) as expenses
        FROM invoices i
        LEFT JOIN invoice_items ii ON ii.invoice_id = i.id
        LEFT JOIN products p ON p.id = ii.product_id
        LEFT JOIN expenses e ON e.business_id = i.business_id AND e.expense_date::date = i.created_at::date
        WHERE i.business_id=$1 ${dateFilter}
      `, dateParams)
    ])

    const sales = salesSummary.rows[0]
    const expenses = expensesSummary.rows[0]
    const profit = profitEstimate.rows[0]

    const grossProfit = Number(profit.revenue) - Number(profit.cogs)
    const operatingProfit = grossProfit - Number(profit.expenses)

    res.json({
      sales: {
        total: Number(sales.total_sales || 0),
        paid: Number(sales.total_paid || 0),
        invoiceCount: Number(sales.invoice_count || 0),
        byDay: salesByDay.rows.map(r => ({ date: r.date, sales: Number(r.daily_sales), count: Number(r.invoice_count) }))
      },
      expenses: {
        total: Number(expenses.total_expenses || 0),
        byCategory: expensesByCategory.rows.map(r => ({ category: r.category, total: Number(r.total) }))
      },
      profit: {
        revenue: Number(profit.revenue || 0),
        cogs: Number(profit.cogs || 0),
        expenses: Number(profit.expenses || 0),
        grossProfit: Math.round(grossProfit * 100) / 100,
        operatingProfit: Math.round(operatingProfit * 100) / 100,
        grossMargin: profit.revenue > 0 ? Math.round((grossProfit / Number(profit.revenue)) * 10000) / 100 : 0,
        operatingMargin: profit.revenue > 0 ? Math.round((operatingProfit / Number(profit.revenue)) * 10000) / 100 : 0,
        note: 'Gross Profit = Revenue - COGS (product purchase prices). Operating Profit = Gross Profit - Expenses. Both are estimates based on recorded purchase prices and expenses.'
      },
      topProducts: topProducts.rows.map(r => ({
        name: r.name,
        category: r.category,
        quantity: Number(r.total_qty),
        revenue: Number(r.total_revenue)
      })),
      outstanding: {
        total: outstandingBalances.rows.reduce((sum, r) => sum + Number(r.balance), 0),
        customers: outstandingBalances.rows.map(r => ({ name: r.name, phone: r.phone, balance: Number(r.balance) }))
      }
    })
  } catch (error) {
    console.error('[Analytics]', error)
    res.status(500).json({ error: 'Failed to fetch analytics' })
  }
})

app.get('/api/restaurant/settings', auth, requirePermission('restaurant.view'), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' })
  const result = await pool.query('SELECT total_tables FROM restaurant_settings WHERE business_id=$1', [req.businessId])
  res.json({ totalTables: result.rows[0]?.total_tables || 0 })
})

app.post('/api/restaurant/settings', auth, requirePermission('settings.restaurant'), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' })
  const { totalTables } = req.body
  if (typeof totalTables !== 'number' || totalTables < 0 || totalTables > 100) {
    return res.status(400).json({ error: 'Total tables must be a number between 0 and 100' })
  }
  const businessId = req.businessId
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      'INSERT INTO restaurant_settings (business_id, total_tables, updated_at) VALUES ($1,$2,NOW()) ON CONFLICT (business_id) DO UPDATE SET total_tables=$2, updated_at=NOW()',
      [businessId, totalTables]
    )
    if (totalTables > 0) {
      const existing = await client.query('SELECT table_number FROM restaurant_tables WHERE business_id=$1', [businessId])
      const existingNumbers = new Set(existing.rows.map(r => r.table_number))
      const toInsert = []
      for (let i = 1; i <= totalTables; i++) {
        if (!existingNumbers.has(i)) toInsert.push(i)
      }
      if (toInsert.length) {
        const values = toInsert.map((_, idx) => `($1, $${idx + 2}, 'vacant', NOW(), NOW())`).join(',')
        await client.query(
          `INSERT INTO restaurant_tables (business_id, table_number, status, created_at, updated_at) VALUES ${values} ON CONFLICT (business_id, table_number) DO NOTHING`,
          [businessId, ...toInsert]
        )
      }
      if (totalTables < Math.max(...existingNumbers, 0)) {
        await client.query('DELETE FROM restaurant_tables WHERE business_id=$1 AND table_number > $2', [businessId, totalTables])
      }
    } else {
      await client.query('DELETE FROM restaurant_tables WHERE business_id=$1', [businessId])
    }
    await client.query('COMMIT')
    res.json({ success: true })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
})

app.get('/api/restaurant/tables', auth, requirePermission('restaurant.view'), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' })
  const result = await pool.query(
    'SELECT id, table_number, status, customer_name, expected_time FROM restaurant_tables WHERE business_id=$1 ORDER BY table_number',
    [req.businessId]
  )
  res.json(result.rows)
})

app.patch('/api/restaurant/tables/:id', auth, requirePermission('restaurant.manage_tables'), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' })
  const { status, customerName, expectedTime } = req.body
  if (!['vacant', 'occupied', 'reserved'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' })
  }
  const result = await pool.query(
    'UPDATE restaurant_tables SET status=$1, customer_name=$2, expected_time=$3, updated_at=NOW() WHERE id=$4 AND business_id=$5 RETURNING *',
    [status, customerName || null, expectedTime || null, req.params.id, req.businessId]
  )
  if (!result.rows.length) return res.status(404).json({ error: 'Table not found' })
  res.json(result.rows[0])
})

// Get or create open order for a table
app.get('/api/restaurant/tables/:tableId/order', auth, requirePermission('restaurant.manage_orders'), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' })
  const tableId = req.params.tableId
  
  // Verify table belongs to business
  const tableCheck = await pool.query('SELECT id FROM restaurant_tables WHERE id=$1 AND business_id=$2', [tableId, req.businessId])
  if (!tableCheck.rows.length) return res.status(404).json({ error: 'Table not found' })
  
  // Get or create open order
  let orderResult = await pool.query(
    'SELECT * FROM table_orders WHERE table_id=$1 AND business_id=$2 AND status IN (\'open\', \'sent_to_kitchen\') ORDER BY created_at DESC LIMIT 1',
    [tableId, req.businessId]
  )
  
  if (!orderResult.rows.length) {
    orderResult = await pool.query(
      'INSERT INTO table_orders (business_id, table_id, status, total_amount) VALUES ($1,$2,\'open\',0) RETURNING *',
      [req.businessId, tableId]
    )
  }
  
  const order = orderResult.rows[0]
  
  // Get order items
  const itemsResult = await pool.query(
    `SELECT oi.*, p.name, p.category, p.unit 
     FROM table_order_items oi 
     JOIN products p ON p.id = oi.product_id 
     WHERE oi.order_id=$1 
     ORDER BY oi.created_at`,
    [order.id]
  )
  
  res.json({ order, items: itemsResult.rows })
})

// Add items to table order
app.post('/api/restaurant/tables/:tableId/order/items', auth, requirePermission('restaurant.manage_orders'), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' })
  const tableId = req.params.tableId
  const { items } = req.body // [{ productId, quantity, note }]
  
  if (!items || !items.length) return res.status(400).json({ error: 'Items required' })
  
  // Verify table belongs to business
  const tableCheck = await pool.query('SELECT id FROM restaurant_tables WHERE id=$1 AND business_id=$2', [tableId, req.businessId])
  if (!tableCheck.rows.length) return res.status(404).json({ error: 'Table not found' })
  
  // Get or create open order
  let orderResult = await pool.query(
    'SELECT * FROM table_orders WHERE table_id=$1 AND business_id=$2 AND status IN (\'open\', \'sent_to_kitchen\') ORDER BY created_at DESC LIMIT 1',
    [tableId, req.businessId]
  )
  
  if (!orderResult.rows.length) {
    orderResult = await pool.query(
      'INSERT INTO table_orders (business_id, table_id, status, total_amount) VALUES ($1,$2,\'open\',0) RETURNING *',
      [req.businessId, tableId]
    )
  }
  
  const order = orderResult.rows[0]
  const client = await pool.connect()
  
  try {
    await client.query('BEGIN')
    
    let orderTotal = Number(order.total_amount)
    const addedItems = []
    
    for (const item of items) {
      const { productId, quantity = 1, note } = item
      
      // Verify product belongs to business and get price
      const productResult = await client.query(
        'SELECT id, selling_price FROM products WHERE id=$1 AND business_id=$2',
        [productId, req.businessId]
      )
      if (!productResult.rows.length) throw Object.assign(new Error('Product not found'), { status: 404 })
      
      const price = Number(productResult.rows[0].selling_price)
      const qty = Number(quantity)
      const itemTotal = price * qty
      orderTotal += itemTotal
      
      const itemResult = await client.query(
        'INSERT INTO table_order_items (order_id, product_id, quantity, price, note) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [order.id, productId, qty, price, note || null]
      )
      addedItems.push(itemResult.rows[0])
    }
    
    // Update order total
    await client.query(
      'UPDATE table_orders SET total_amount=$1, updated_at=NOW() WHERE id=$2',
      [orderTotal, order.id]
    )
    
    await client.query('COMMIT')
    
    // Return updated order with items
    const itemsResult = await pool.query(
      `SELECT oi.*, p.name, p.category, p.unit 
       FROM table_order_items oi 
       JOIN products p ON p.id = oi.product_id 
       WHERE oi.order_id=$1 
       ORDER BY oi.created_at`,
      [order.id]
    )
    
    res.json({ order: { ...order, total_amount: orderTotal }, items: itemsResult.rows })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
})

// Generate KOT (Kitchen Order Ticket)
app.get('/api/restaurant/tables/:tableId/kot', auth, requirePermission('restaurant.kot'), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' })
  const tableId = req.params.tableId
  
  // Verify table belongs to business
  const tableResult = await pool.query(
    'SELECT id, table_number FROM restaurant_tables WHERE id=$1 AND business_id=$2',
    [tableId, req.businessId]
  )
  if (!tableResult.rows.length) return res.status(404).json({ error: 'Table not found' })
  
  const table = tableResult.rows[0]
  
  // Get the latest order for this table
  const orderResult = await pool.query(
    'SELECT * FROM table_orders WHERE table_id=$1 AND business_id=$2 AND status IN (\'open\', \'sent_to_kitchen\') ORDER BY created_at DESC LIMIT 1',
    [tableId, req.businessId]
  )
  
  if (!orderResult.rows.length) return res.status(404).json({ error: 'No active order for this table' })
  
  const order = orderResult.rows[0]
  
  // Get order items
  const itemsResult = await pool.query(
    `SELECT oi.*, p.name, p.category, p.unit 
     FROM table_order_items oi 
     JOIN products p ON p.id = oi.product_id 
     WHERE oi.order_id=$1 
     ORDER BY p.category, oi.created_at`,
    [order.id]
  )
  
  // Get business name
  const businessResult = await pool.query('SELECT name FROM businesses WHERE id=$1', [req.businessId])
  
  res.json({
    tableNumber: table.table_number,
    businessName: businessResult.rows[0]?.name || 'Restaurant',
    orderId: order.id,
    orderStatus: order.status,
    items: itemsResult.rows,
    timestamp: new Date().toISOString(),
    totalAmount: order.total_amount
  })
})

// Mark order as sent to kitchen
app.post('/api/restaurant/tables/:tableId/order/send-to-kitchen', auth, requirePermission('restaurant.manage_orders'), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' })
  const tableId = req.params.tableId
  
  // Verify table belongs to business
  const tableCheck = await pool.query('SELECT id FROM restaurant_tables WHERE id=$1 AND business_id=$2', [tableId, req.businessId])
  if (!tableCheck.rows.length) return res.status(404).json({ error: 'Table not found' })
  
  // Get the latest order
  const orderResult = await pool.query(
    'SELECT * FROM table_orders WHERE table_id=$1 AND business_id=$2 AND status IN (\'open\', \'sent_to_kitchen\') ORDER BY created_at DESC LIMIT 1',
    [tableId, req.businessId]
  )
  
  if (!orderResult.rows.length) return res.status(404).json({ error: 'No active order for this table' })
  
  const order = orderResult.rows[0]
  
  // Update order status and mark items as sent
  await pool.query(
    'UPDATE table_orders SET status=\'sent_to_kitchen\', updated_at=NOW() WHERE id=$1',
    [order.id]
  )
  await pool.query(
    'UPDATE table_order_items SET sent_to_kitchen=TRUE WHERE order_id=$1',
    [order.id]
  )
  
  res.json({ success: true, orderId: order.id })
})

// Generate bill from table order - creates invoice
app.post('/api/restaurant/tables/:tableId/order/generate-bill', auth, requirePermission('invoices.create'), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' })
  const tableId = req.params.tableId
  const { customerId, paid = 0 } = req.body
  
  // Verify table belongs to business
  const tableCheck = await pool.query('SELECT id, table_number FROM restaurant_tables WHERE id=$1 AND business_id=$2', [tableId, req.businessId])
  if (!tableCheck.rows.length) return res.status(404).json({ error: 'Table not found' })
  const table = tableCheck.rows[0]
  
  // Get the latest order
  const orderResult = await pool.query(
    'SELECT * FROM table_orders WHERE table_id=$1 AND business_id=$2 AND status IN (\'open\', \'sent_to_kitchen\') ORDER BY created_at DESC LIMIT 1',
    [tableId, req.businessId]
  )
  
  if (!orderResult.rows.length) return res.status(404).json({ error: 'No active order for this table' })
  
  const order = orderResult.rows[0]
  
  // Get order items
  const itemsResult = await pool.query(
    `SELECT oi.*, p.name 
     FROM table_order_items oi 
     JOIN products p ON p.id = oi.product_id 
     WHERE oi.order_id=$1 
     ORDER BY oi.created_at`,
    [order.id]
  )
  
  if (!itemsResult.rows.length) return res.status(400).json({ error: 'No items in order' })
  
  const client = await pool.connect()
  
  try {
    await client.query('BEGIN')
    
    const computedOrderTotal = roundCurrency(itemsResult.rows.reduce((sum, item) => sum + (Number(item.quantity) * Number(item.price)), 0))
    if (Math.abs(Number(order.total_amount) - computedOrderTotal) > 0.01) {
      await client.query('UPDATE table_orders SET total_amount=$1, updated_at=NOW() WHERE id=$2', [computedOrderTotal, order.id])
    }

    const total = computedOrderTotal
    const paymentAmount = roundCurrency(paid)
    const due = Math.max(total - paymentAmount, 0)
    const businessResult = await client.query('SELECT enabled_modules FROM businesses WHERE id=$1', [req.businessId])
    const enabledModules = businessResult.rows[0]?.enabled_modules || []
    const hasUdhar = Array.isArray(enabledModules) && enabledModules.includes('udhar')
    const status = paymentAmount >= total ? 'paid' : paymentAmount > 0 ? 'partial' : (hasUdhar ? 'udhar' : 'unpaid')
    
    const invoiceResult = await client.query(
      'INSERT INTO invoices (business_id, customer_id, total, paid, status) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [req.businessId, customerId || null, total, paymentAmount, status]
    )
    const invoice = invoiceResult.rows[0]
    
    for (const item of itemsResult.rows) {
      const gstPercent = 5
      await client.query(
        'INSERT INTO invoice_items (invoice_id, product_id, quantity, price, gst_percent, discount_percent, discount_amount) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [invoice.id, item.product_id, item.quantity, item.price, gstPercent, 0, 0]
      )
    }
    
    if (customerId && due > 0) {
      await client.query('UPDATE customers SET balance=balance+$1 WHERE id=$2 AND business_id=$3', [due, customerId, req.businessId])
      await client.query("INSERT INTO udhar_ledger (customer_id, invoice_id, type, amount, note) VALUES ($1,$2,'credit',$3,'Invoice credit')", [customerId, invoice.id, due])
    }
    
    await client.query(
      'UPDATE table_orders SET status=\'closed\', updated_at=NOW() WHERE id=$1',
      [order.id]
    )
    
    await client.query(
      'UPDATE restaurant_tables SET status=\'vacant\', customer_name=NULL, expected_time=NULL, updated_at=NOW() WHERE id=$1',
      [tableId]
    )
    
    await client.query('COMMIT')
    
    res.status(201).json({ 
      invoice: { ...invoice, total, paid: paymentAmount }, 
      tableNumber: table.table_number,
      message: 'Bill generated successfully'
    })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
})

// Get bill preview for table order (without creating invoice)
app.get('/api/restaurant/tables/:tableId/order/bill-preview', auth, requirePermission('invoices.read'), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' })
  const tableId = req.params.tableId
  
  // Verify table belongs to business
  const tableCheck = await pool.query('SELECT id, table_number FROM restaurant_tables WHERE id=$1 AND business_id=$2', [tableId, req.businessId])
  if (!tableCheck.rows.length) return res.status(404).json({ error: 'Table not found' })
  const table = tableCheck.rows[0]
  
  // Get the latest order
  const orderResult = await pool.query(
    'SELECT * FROM table_orders WHERE table_id=$1 AND business_id=$2 AND status IN (\'open\', \'sent_to_kitchen\') ORDER BY created_at DESC LIMIT 1',
    [tableId, req.businessId]
  )
  
  if (!orderResult.rows.length) return res.status(404).json({ error: 'No active order for this table' })
  
  const order = orderResult.rows[0]
  
// Get order items
  const itemsResult = await pool.query(
    `SELECT oi.*, p.name, p.category 
     FROM table_order_items oi 
     JOIN products p ON p.id = oi.product_id 
     WHERE oi.order_id=$1 
     ORDER BY p.category, oi.created_at`,
    [order.id]
  )

  // Calculate GST for bill preview (default 5% for restaurant)
  const itemsWithGst = itemsResult.rows.map(item => {
    const qty = Number(item.quantity)
    const price = Number(item.price)
    const itemTotal = qty * price
    const gstPercent = 5 // Default GST for restaurant food
    const gstAmount = (itemTotal * gstPercent) / 100
    return {
      ...item,
      gstPercent,
      gstAmount,
      itemTotal,
      totalWithGst: itemTotal + gstAmount
    }
  })
  const subtotal = itemsWithGst.reduce((sum, item) => sum + item.itemTotal, 0)
  const totalGst = itemsWithGst.reduce((sum, item) => sum + item.gstAmount, 0)
  const grandTotal = subtotal + totalGst

  // Get business name
  const businessResult = await pool.query('SELECT name, address FROM businesses WHERE id=$1', [req.businessId])

  res.json({
    tableNumber: table.table_number,
    businessName: businessResult.rows[0]?.name || 'Restaurant',
    businessAddress: businessResult.rows[0]?.address || '',
    orderId: order.id,
    orderStatus: order.status,
    items: itemsWithGst,
    subtotal,
    totalGst,
    grandTotal,
    timestamp: new Date().toISOString()
  })
})

app.post('/api/payments', auth, requirePermission('payments.create'), async (req, res) => {
  const { customerId, amount, note = 'Payment received' } = req.body
  if (!customerId || !amount || Number(amount) <= 0) return res.status(400).json({ error: 'Customer and positive payment amount are required' })
  const result = await pool.query('UPDATE customers SET balance=GREATEST(balance-$1,0) WHERE id=$2 AND business_id=$3 RETURNING *', [amount, customerId, req.businessId])
  if (!result.rows.length) return res.status(404).json({ error: 'Customer not found' })
  await pool.query("INSERT INTO udhar_ledger (customer_id, type, amount, note) VALUES ($1,'payment',$2,$3)", [customerId, amount, note])
  res.status(201).json(result.rows[0])
})

app.post('/api/invoices/:id/pdf', auth, requirePermission('invoices.export'), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' })
  const invoiceId = req.params.id
  
  // Get invoice with items and business info
  const invoiceResult = await pool.query(
    `SELECT i.*, b.name as business_name, b.address as business_address, b.email as business_email, b.phone as business_phone,
            c.name as customer_name, c.phone as customer_phone, c.email as customer_email, c.address as customer_address
     FROM invoices i
     JOIN businesses b ON b.id = i.business_id
     LEFT JOIN customers c ON c.id = i.customer_id
     WHERE i.id = $1 AND i.business_id = $2`,
    [invoiceId, req.businessId]
  )
  
  if (!invoiceResult.rows.length) return res.status(404).json({ error: 'Invoice not found' })
  
  const invoice = invoiceResult.rows[0]
  
// Get invoice items with product details
  const itemsResult = await pool.query(
    `SELECT ii.*, p.name, p.category, p.unit
     FROM invoice_items ii
     JOIN products p ON p.id = ii.product_id
     WHERE ii.invoice_id = $1
     ORDER BY ii.id`,
    [invoiceId]
  )

  const items = itemsResult.rows

  // Generate PDF using PDFKit
  const PDFDocument = (await import('pdfkit')).default
  const doc = new PDFDocument({ margin: 50, size: 'A4' })

  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoiceId}.pdf"`)

  doc.pipe(res)

  // Business header
  doc.fontSize(24).font('Helvetica-Bold').text(invoice.business_name, { align: 'left' })
  doc.fontSize(10).font('Helvetica').text(invoice.business_address || '', { align: 'left' })
  doc.text(`Phone: ${invoice.business_phone || ''}`, { align: 'left' })
  doc.text(`Email: ${invoice.business_email || ''}`, { align: 'left' })
  doc.moveDown()

  // Invoice title
  doc.fontSize(18).font('Helvetica-Bold').text('INVOICE', { align: 'right' })
  doc.moveDown()

  // Invoice details
  doc.fontSize(10).font('Helvetica')
  const invoiceDate = new Date(invoice.created_at).toLocaleDateString('en-IN')
  doc.text(`Invoice #: ${invoice.id}`, { align: 'left', continued: true })
  doc.text(`Date: ${invoiceDate}`, { align: 'right' })
  doc.text(`Status: ${invoice.status.toUpperCase()}`, { align: 'left', continued: true })
  doc.moveDown()

  // Customer details
  if (invoice.customer_name) {
    doc.fontSize(12).font('Helvetica-Bold').text('Bill To:', { align: 'left' })
    doc.fontSize(10).font('Helvetica')
    doc.text(invoice.customer_name, { align: 'left' })
    if (invoice.customer_phone) doc.text(`Phone: ${invoice.customer_phone}`, { align: 'left' })
    if (invoice.customer_email) doc.text(`Email: ${invoice.customer_email}`, { align: 'left' })
    if (invoice.customer_address) doc.text(invoice.customer_address, { align: 'left' })
    doc.moveDown()
  }

  // Items table header
  const colWidths = { sr: 35, name: 160, qty: 45, unit: 45, price: 60, disc: 45, gst: 45, amount: 85 }
  const tableLeft = 50
  let y = doc.y

  doc.fontSize(8).font('Helvetica-Bold')
  doc.rect(tableLeft, y, 520, 20).fill('#f3f4f6')
  doc.fillColor('#1f2937')
  doc.text('Sr', tableLeft + 5, y + 5, { width: colWidths.sr })
  doc.text('Description', tableLeft + colWidths.sr + 5, y + 5, { width: colWidths.name })
  doc.text('Qty', tableLeft + colWidths.sr + colWidths.name + 5, y + 5, { width: colWidths.qty, align: 'center' })
  doc.text('Unit', tableLeft + colWidths.sr + colWidths.name + colWidths.qty + colWidths.unit + 5, y + 5, { width: colWidths.unit, align: 'center' })
  doc.text('Price', tableLeft + colWidths.sr + colWidths.name + colWidths.qty + colWidths.unit + colWidths.price + 5, y + 5, { width: colWidths.price, align: 'right' })
  doc.text('Disc %', tableLeft + colWidths.sr + colWidths.name + colWidths.qty + colWidths.unit + colWidths.price + colWidths.disc + 5, y + 5, { width: colWidths.disc, align: 'center' })
  doc.text('GST %', tableLeft + colWidths.sr + colWidths.name + colWidths.qty + colWidths.unit + colWidths.price + colWidths.disc + 5, y + 5, { width: colWidths.gst, align: 'center' })
  doc.text('Amount', tableLeft + 520 - colWidths.amount, y + 5, { width: colWidths.amount, align: 'right' })
  doc.fillColor('#000000')
  y += 20

  // Items rows
  let subtotal = 0
  let totalDiscount = 0
  let totalGst = 0
  doc.fontSize(8).font('Helvetica')

  items.forEach((item, index) => {
    const qty = Number(item.quantity)
    const price = Number(item.price)
    const gstPercent = Number(item.gst_percent || 0)
    const discountPercent = Number(item.discount_percent || 0)
    const itemTotal = qty * price
    const discountAmount = (itemTotal * discountPercent) / 100
    const taxableAmount = itemTotal - discountAmount
    const gstAmount = (taxableAmount * gstPercent) / 100
    const rowTotal = taxableAmount + gstAmount

    subtotal += itemTotal
    totalDiscount += discountAmount
    totalGst += gstAmount

    if (y > 700) {
      doc.addPage()
      y = 50
    }

    const rowHeight = 20
    if (index % 2 === 0) {
      doc.rect(tableLeft, y, 520, rowHeight).fill('#fafafa')
    }
    doc.fillColor('#1f2937')
    doc.text(String(index + 1), tableLeft + 5, y + 5, { width: colWidths.sr })
    doc.text(item.name, tableLeft + colWidths.sr + 5, y + 5, { width: colWidths.name })
    doc.text(String(qty), tableLeft + colWidths.sr + colWidths.name + 5, y + 5, { width: colWidths.qty, align: 'center' })
    doc.text(item.unit || 'pcs', tableLeft + colWidths.sr + colWidths.name + colWidths.qty + colWidths.unit + 5, y + 5, { width: colWidths.unit, align: 'center' })
    doc.text(`₹${price.toFixed(2)}`, tableLeft + colWidths.sr + colWidths.name + colWidths.qty + colWidths.unit + colWidths.price + 5, y + 5, { width: colWidths.price, align: 'right' })
    doc.text(`${discountPercent}%`, tableLeft + colWidths.sr + colWidths.name + colWidths.qty + colWidths.unit + colWidths.price + colWidths.disc + 5, y + 5, { width: colWidths.disc, align: 'center' })
    doc.text(`${gstPercent}%`, tableLeft + colWidths.sr + colWidths.name + colWidths.qty + colWidths.unit + colWidths.price + colWidths.disc + 5, y + 5, { width: colWidths.gst, align: 'center' })
    doc.text(`₹${rowTotal.toFixed(2)}`, tableLeft + 520 - colWidths.amount, y + 5, { width: colWidths.amount, align: 'right' })
    y += rowHeight
  })

  // Totals
  doc.moveDown(2)
  const grandTotal = subtotal - totalDiscount + totalGst
  const cgst = totalGst / 2
  const sgst = totalGst / 2

  doc.fontSize(10).font('Helvetica')
  doc.text(`Subtotal:`, { align: 'right', continued: true })
  doc.text(`₹${subtotal.toFixed(2)}`, { align: 'right' })
  if (totalDiscount > 0) {
    doc.text(`Discount:`, { align: 'right', continued: true })
    doc.text(`-₹${totalDiscount.toFixed(2)}`, { align: 'right' })
  }
  if (totalGst > 0) {
    doc.text(`CGST (${(totalGst / (subtotal - totalDiscount) * 50).toFixed(1)}%):`, { align: 'right', continued: true })
    doc.text(`₹${cgst.toFixed(2)}`, { align: 'right' })
    doc.text(`SGST (${(totalGst / (subtotal - totalDiscount) * 50).toFixed(1)}%):`, { align: 'right', continued: true })
    doc.text(`₹${sgst.toFixed(2)}`, { align: 'right' })
    doc.text(`Total GST:`, { align: 'right', continued: true })
    doc.text(`₹${totalGst.toFixed(2)}`, { align: 'right' })
  }
  doc.fontSize(12).font('Helvetica-Bold')
  doc.text(`Grand Total:`, { align: 'right', continued: true })
  doc.text(`₹${grandTotal.toFixed(2)}`, { align: 'right' })
  
  // Payment info
  doc.moveDown(2)
  doc.fontSize(10).font('Helvetica')
  doc.text(`Paid: ₹${Number(invoice.paid || 0).toFixed(2)}`, { align: 'left' })
  doc.text(`Balance: ₹${Math.max(Number(invoice.total) - Number(invoice.paid || 0), 0).toFixed(2)}`, { align: 'left' })
  
  // Footer
  doc.moveDown(3)
  doc.fontSize(9).font('Helvetica-Oblique').text('Thank you for your business!', { align: 'center' })
  doc.text('Generated by Bilkaro', { align: 'center' })
  
doc.end()
})

// Team API endpoints
app.get('/api/team', auth, requirePermission('settings.team'), async (req, res) => {
  const result = await pool.query('SELECT id, name, email, role, created_at FROM team_members WHERE business_id = $1 ORDER BY created_at', [req.businessId])
  res.json(result.rows)
})

app.post('/api/team/invite', auth, requirePermission('users.invite'), async (req, res) => {
  const { name, email, password, role } = req.body
  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'Name, email, password, and role are required' })
  }
  const validRoles = ['owner', 'manager', 'staff']
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: 'Invalid role' })
  }
  if (role === 'owner' && req.roleName !== 'owner') {
    return res.status(403).json({ error: 'Only owners can create other owners' })
  }

  const existing = await pool.query('SELECT id FROM team_members WHERE business_id = $1 AND email = $2', [req.businessId, email])
  if (existing.rows.length > 0) {
    return res.status(400).json({ error: 'Team member with this email already exists' })
  }

  const passwordHash = await bcrypt.hash(password, 12)
  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    const result = await client.query('INSERT INTO team_members (business_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, role, created_at', [req.businessId, name, email, passwordHash, role])

    if (await hasNewAuthTables(client)) {
      const normalizedRole = role === 'owner' ? 'owner' : role === 'manager' ? 'manager' : 'staff'
      const userResult = await client.query(
        `INSERT INTO users (email, password_hash, full_name, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, TRUE, NOW(), NOW())
         ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, full_name = EXCLUDED.full_name, updated_at = NOW()
         RETURNING id`,
        [email, passwordHash, name]
      )
        
      const roleResult = await client.query(
        `INSERT INTO roles (business_id, name, description, is_system, created_at)
         VALUES ($1, $2, 'Business role', TRUE, NOW())
         ON CONFLICT (business_id, name) DO UPDATE SET description = EXCLUDED.description
         RETURNING id`,
        [req.businessId, normalizedRole]
      )

      await client.query(
        `INSERT INTO memberships (user_id, business_id, role_id, status, joined_at, created_at)
         VALUES ($1, $2, $3, 'active', NOW(), NOW())
         ON CONFLICT (user_id, business_id) DO UPDATE SET role_id = EXCLUDED.role_id, status = 'active', joined_at = NOW()`,
        [userResult.rows[0].id, req.businessId, roleResult.rows[0].id]
      )
    }

    await client.query('COMMIT')
    res.status(201).json(result.rows[0])
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
})

app.delete('/api/team/:id', auth, requirePermission('users.remove'), async (req, res) => {
  const memberId = req.params.id
  if (req.membershipId && Number(memberId) === req.membershipId) {
    return res.status(400).json({ error: 'Cannot remove yourself' })
  }
  const member = await pool.query('SELECT role, email FROM team_members WHERE id = $1 AND business_id = $2', [memberId, req.businessId])
  if (!member.rows.length) {
    return res.status(404).json({ error: 'Team member not found' })
  }
  if (member.rows[0].role === 'owner' && req.roleName !== 'owner') {
    return res.status(403).json({ error: 'Only owners can remove other owners' })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM team_members WHERE id = $1 AND business_id = $2', [memberId, req.businessId])
    if (await hasNewAuthTables(client)) {
      const userRow = await client.query('SELECT id FROM users WHERE email = $1 LIMIT 1', [member.rows[0].email])
      if (userRow.rows[0]) {
        await client.query('DELETE FROM memberships WHERE user_id = $1 AND business_id = $2', [userRow.rows[0].id, req.businessId])
      }
    }
    await client.query('COMMIT')
    res.status(204).end()
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
})

app.patch('/api/team/:id/role', auth, requirePermission('users.manage_roles'), async (req, res) => {
  const { role } = req.body
  const memberId = req.params.id
  const validRoles = ['owner', 'manager', 'staff']
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: 'Invalid role' })
  }
  if (role === 'owner' && req.roleName !== 'owner') {
    return res.status(403).json({ error: 'Only owners can assign owner role' })
  }
  const member = await pool.query('SELECT role, email FROM team_members WHERE id = $1 AND business_id = $2', [memberId, req.businessId])
  if (!member.rows.length) {
    return res.status(404).json({ error: 'Team member not found' })
  }
  if (member.rows[0].role === 'owner' && req.roleName !== 'owner') {
    return res.status(403).json({ error: 'Only owners can change owner role' })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query('UPDATE team_members SET role = $1 WHERE id = $2 AND business_id = $3 RETURNING id, name, email, role, created_at', [role, memberId, req.businessId])

    if (await hasNewAuthTables(client)) {
      const userRow = await client.query('SELECT id FROM users WHERE email = $1 LIMIT 1', [member.rows[0].email])
      if (userRow.rows[0]) {
        const roleRow = await client.query('SELECT id FROM roles WHERE business_id = $1 AND name = $2 LIMIT 1', [req.businessId, role])
        if (roleRow.rows[0]) {
          await client.query(
            `UPDATE memberships SET role_id = $1, status = 'active', joined_at = COALESCE(joined_at, NOW()) WHERE user_id = $2 AND business_id = $3`,
            [roleRow.rows[0].id, userRow.rows[0].id, req.businessId]
          )
        }
      }
    }

    await client.query('COMMIT')
    res.json(result.rows[0])
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
})

app.post('/api/business/update-type', auth, requirePermission('settings.business_type'), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' })
  const { category } = req.body
  const validCategories = ['retail', 'wholesaler', 'restaurant', 'school', 'services', 'other']
  if (!validCategories.includes(category)) {
    return res.status(400).json({ error: 'Invalid business type' })
  }
  // Get default modules for new business type
  const defaultModulesMap = {
    retail: ["dashboard", "products", "customers", "udhar", "invoices", "expenses", "analytics", "reports", "team"],
    wholesaler: ["dashboard", "products", "customers", "udhar", "invoices", "expenses", "analytics", "reports", "team"],
    restaurant: ["dashboard", "tables", "menu", "kot", "invoices", "expenses", "analytics", "reports", "team"],
    school: ["dashboard", "customers", "udhar", "expenses", "analytics", "reports", "team"],
    services: ["dashboard", "customers", "invoices", "expenses", "analytics", "reports", "team"],
    other: ["dashboard", "products", "customers", "udhar", "invoices", "expenses", "analytics", "reports", "tables", "menu", "kot", "team"]
  }
  const defaultModules = defaultModulesMap[category] || defaultModulesMap.other
  const result = await pool.query('UPDATE businesses SET category=$1, enabled_modules=$2 WHERE id=$3 RETURNING id, name, owner_name, email, phone, category, business_description, is_existing, years_running, address, enabled_modules', [category, JSON.stringify(defaultModules), req.businessId])
  if (!result.rows.length) return res.status(404).json({ error: 'Business not found' })
  const user = result.rows[0]
  res.json({ user: toBusiness(user) })
})

app.post('/api/business/update-modules', auth, requirePermission('settings.modules'), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' })
  const { enabledModules } = req.body
  if (!Array.isArray(enabledModules)) {
    return res.status(400).json({ error: 'enabledModules must be an array' })
  }
  const result = await pool.query('UPDATE businesses SET enabled_modules=$1 WHERE id=$2 RETURNING id, name, owner_name, email, phone, category, business_description, is_existing, years_running, address, enabled_modules', [JSON.stringify(enabledModules), req.businessId])
  if (!result.rows.length) return res.status(404).json({ error: 'Business not found' })
  const user = result.rows[0]
  res.json({ user: toBusiness(user) })
})

app.use((error, _req, res, _next) => { console.error('[API ERROR]', error); res.status(error.status || 500).json({ error: error.message || 'Internal server error' }) })
app.use(express.static('dist'))
app.listen(port, () => {
  console.log(`Bilkaro API running on http://localhost:${port}`)
  console.log(`Database configured: ${Boolean(pool)}`)
})
