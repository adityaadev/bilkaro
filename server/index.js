import 'dotenv/config'
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import pg from 'pg'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
dotenv.config({
  path: [
    path.resolve(__dirname, '.env'),
    path.resolve(__dirname, '.env.local'),
    path.resolve(__dirname, '..', '.env.local'),
  ],
  override: true,
})

const { Pool } = pg
const app = express()
const port = process.env.PORT || 4000
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false }) : null
const allowedOrigins = new Set(['http://localhost:5173', 'http://localhost:5174'])
app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)) }))
app.use(express.json())

const toBusiness = (business) => business && ({ id: business.id, name: business.name, ownerName: business.owner_name, email: business.email, phone: business.phone, category: business.category, businessType: business.category, businessDescription: business.business_description, isExisting: business.is_existing, yearsRunning: business.years_running, address: business.address })
const tokenFor = (user) => jwt.sign({ id: user.id, email: user.email, category: user.category }, process.env.JWT_SECRET || 'bilkaro-local-secret', { expiresIn: '7d' })
const auth = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  try { req.user = jwt.verify(token, process.env.JWT_SECRET || 'bilkaro-local-secret'); next() } catch { res.status(401).json({ error: 'Authentication required' }) }
}
app.get('/api/health', async (_req, res) => res.json({ ok: true, database: Boolean(pool) }))
app.post('/api/auth/signup', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Set DATABASE_URL to enable account creation' })
  const { businessName, ownerName, email, phone, password, category, businessDescription, isExisting, yearsRunning, address } = req.body
  const passwordHash = await bcrypt.hash(password, 12)
  const result = await pool.query('INSERT INTO businesses (name, owner_name, email, phone, password_hash, category, business_description, is_existing, years_running, address) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, name, owner_name, email, phone, category, business_description, is_existing, years_running, address', [businessName, ownerName, email, phone, passwordHash, category, businessDescription, isExisting !== 'new', yearsRunning || null, address])
  const user = result.rows[0]
  res.status(201).json({ token: tokenFor(user), user: toBusiness(user) })
})
app.post('/api/auth/login', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Set DATABASE_URL to enable login' })
  const result = await pool.query('SELECT * FROM businesses WHERE email = $1', [req.body.email])
  const user = result.rows[0]
  if (!user || !(await bcrypt.compare(req.body.password, user.password_hash))) return res.status(401).json({ error: 'Invalid email or password' })
  res.json({ token: tokenFor(user), user: toBusiness(user) })
})
app.get('/api/dashboard', auth, async (req, res) => {
  if (!pool) return res.json({ business: null, salesToday: 0, customers: 0, lowStock: 0, outstandingUdhar: 0 })
  const businessId = req.user.id
  const [business, sales, customers, lowStock, udhar] = await Promise.all([
    pool.query('SELECT id, name, owner_name, email, phone, category, business_description, is_existing, years_running, address FROM businesses WHERE id=$1', [businessId]),
    pool.query('SELECT COALESCE(SUM(total),0) AS value FROM invoices WHERE business_id=$1 AND created_at::date=CURRENT_DATE', [businessId]),
    pool.query('SELECT COUNT(*) AS value FROM customers WHERE business_id=$1', [businessId]),
    pool.query('SELECT COUNT(*) AS value FROM products WHERE business_id=$1 AND current_stock <= low_stock_threshold', [businessId]),
    pool.query('SELECT COALESCE(SUM(balance),0) AS value FROM customers WHERE business_id=$1', [businessId]),
  ])
  res.json({ business: toBusiness(business.rows[0]), salesToday: sales.rows[0].value, customers: customers.rows[0].value, lowStock: lowStock.rows[0].value, outstandingUdhar: udhar.rows[0].value })
})
app.get('/api/products', auth, async (req, res) => {
  const result = await pool.query('SELECT id, name, sku, category, purchase_price, selling_price, current_stock, unit, low_stock_threshold FROM products WHERE business_id=$1 ORDER BY name', [req.user.id])
  res.json(result.rows)
})
app.post('/api/products', auth, async (req, res) => {
  const { name, sku, category, purchasePrice = 0, sellingPrice = 0, currentStock = 0, unit = 'piece', lowStockThreshold = 5 } = req.body
  if (!name) return res.status(400).json({ error: 'Product name is required' })
  const result = await pool.query('INSERT INTO products (business_id, name, sku, category, purchase_price, selling_price, current_stock, unit, low_stock_threshold) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *', [req.user.id, name, sku, category, purchasePrice, sellingPrice, currentStock, unit, lowStockThreshold])
  res.status(201).json(result.rows[0])
})
app.delete('/api/products/:id', auth, async (req, res) => {
  const result = await pool.query('DELETE FROM products WHERE id=$1 AND business_id=$2 RETURNING id', [req.params.id, req.user.id])
  if (!result.rows.length) return res.status(404).json({ error: 'Product not found' })
  res.status(204).end()
})
app.get('/api/customers', auth, async (req, res) => {
  const result = await pool.query('SELECT id, name, phone, email, address, balance FROM customers WHERE business_id=$1 ORDER BY name', [req.user.id])
  res.json(result.rows)
})
app.post('/api/customers', auth, async (req, res) => {
  const { name, phone, email, address } = req.body
  if (!name) return res.status(400).json({ error: 'Customer name is required' })
  const result = await pool.query('INSERT INTO customers (business_id, name, phone, email, address) VALUES ($1,$2,$3,$4,$5) RETURNING *', [req.user.id, name, phone, email, address])
  res.status(201).json(result.rows[0])
})
app.delete('/api/customers/:id', auth, async (req, res) => {
  const result = await pool.query('DELETE FROM customers WHERE id=$1 AND business_id=$2 RETURNING id', [req.params.id, req.user.id])
  if (!result.rows.length) return res.status(404).json({ error: 'Customer not found' })
  res.status(204).end()
})
app.post('/api/invoices', auth, async (req, res) => {
  const { customerId, items = [], total, paid = 0, status } = req.body
  if (!items.length || !total) return res.status(400).json({ error: 'Invoice items and total are required' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const customer = customerId ? await client.query('SELECT id FROM customers WHERE id=$1 AND business_id=$2', [customerId, req.user.id]) : { rows: [{ id: null }] }
    if (!customer.rows.length) throw Object.assign(new Error('Customer does not belong to this business'), { status: 403 })
    for (const item of items) {
      const product = await client.query('SELECT id, current_stock FROM products WHERE id=$1 AND business_id=$2 FOR UPDATE', [item.productId, req.user.id])
      if (!product.rows.length) throw Object.assign(new Error('Product does not belong to this business'), { status: 403 })
      if (Number(product.rows[0].current_stock) < Number(item.quantity)) throw Object.assign(new Error(`Insufficient stock for product ${item.productId}`), { status: 400 })
    }
    const udharEnabledTypes = ['retail', 'wholesaler', 'school', 'other']
    const businessCategory = req.user.category || 'other'
    const hasUdhar = udharEnabledTypes.includes(businessCategory)
    const defaultStatus = !status ? (Number(paid) >= total ? 'paid' : Number(paid) > 0 ? 'partial' : (hasUdhar ? 'udhar' : 'unpaid')) : status
    const invoice = await client.query('INSERT INTO invoices (business_id, customer_id, total, paid, status) VALUES ($1,$2,$3,$4,$5) RETURNING *', [req.user.id, customerId || null, total, paid, defaultStatus])
    for (const item of items) {
      await client.query('INSERT INTO invoice_items (invoice_id, product_id, quantity, price, gst_percent, discount_percent, discount_amount) VALUES ($1,$2,$3,$4,$5,$6,$7)', [invoice.rows[0].id, item.productId, item.quantity, item.price, item.gstPercent || 0, item.discountPercent || 0, item.discountAmount || 0])
      await client.query('UPDATE products SET current_stock=current_stock-$1 WHERE id=$2 AND business_id=$3', [item.quantity, item.productId, req.user.id])
    }
    const due = Math.max(Number(total) - Number(paid), 0)
    if (customerId && due > 0) {
      await client.query('UPDATE customers SET balance=balance+$1 WHERE id=$2 AND business_id=$3', [due, customerId, req.user.id])
      await client.query("INSERT INTO udhar_ledger (customer_id, invoice_id, type, amount, note) VALUES ($1,$2,'credit',$3,'Invoice credit')", [customerId, invoice.rows[0].id, due])
    }
    await client.query('COMMIT')
    res.status(201).json(invoice.rows[0])
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
})
app.get('/api/invoices', auth, async (req, res) => {
  const result = await pool.query('SELECT i.id, i.total, i.paid, i.status, i.created_at, c.name AS customer_name, c.phone AS customer_phone FROM invoices i LEFT JOIN customers c ON c.id=i.customer_id WHERE i.business_id=$1 ORDER BY i.created_at DESC', [req.user.id])
  res.json(result.rows)
})
app.get('/api/expenses', auth, async (req, res) => {
  const result = await pool.query('SELECT * FROM expenses WHERE business_id=$1 ORDER BY expense_date DESC', [req.user.id])
  res.json(result.rows)
})
app.post('/api/expenses', auth, async (req, res) => {
  const { category, amount, note, expense_date, branch_id } = req.body
  if (!category || !amount || !expense_date) return res.status(400).json({ error: 'Category, amount, and date are required' })
  const result = await pool.query(
    'INSERT INTO expenses (business_id, branch_id, category, amount, note, expense_date) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [req.user.id, branch_id || null, category, amount, note, expense_date]
  )
  res.status(201).json(result.rows[0])
})
app.delete('/api/expenses/:id', auth, async (req, res) => {
  const result = await pool.query('DELETE FROM expenses WHERE id=$1 AND business_id=$2 RETURNING id', [req.params.id, req.user.id])
  if (!result.rows.length) return res.status(404).json({ error: 'Expense not found' })
  res.status(204).end()
})

app.get('/api/analytics', auth, async (req, res) => {
  if (!pool) return res.json({ sales: {}, expenses: {}, profit: {}, topProducts: [], outstanding: {} })
  const businessId = req.user.id
  const { period = 'month', startDate, endDate } = req.query

  let dateFilter = ''
  let dateParams = [businessId]
  let paramIndex = 2

  if (startDate && endDate) {
    dateFilter = `AND created_at::date BETWEEN $${paramIndex} AND $${paramIndex + 1}`
    dateParams.push(startDate, endDate)
    paramIndex += 2
  } else {
    switch (period) {
      case 'day':
        dateFilter = "AND created_at::date = CURRENT_DATE"
        break
      case 'week':
        dateFilter = "AND created_at::date >= CURRENT_DATE - INTERVAL '6 days'"
        break
      case 'month':
        dateFilter = "AND created_at::date >= DATE_TRUNC('month', CURRENT_DATE)"
        break
      case 'year':
        dateFilter = "AND created_at::date >= DATE_TRUNC('year', CURRENT_DATE)"
        break
    }
  }

  const expenseDateFilter = dateFilter.replace('created_at', 'expense_date')

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
      pool.query(`SELECT COALESCE(SUM(total),0) as total_sales, COALESCE(SUM(paid),0) as total_paid, COUNT(*) as invoice_count FROM invoices WHERE business_id=$1 ${dateFilter}`, dateParams),
      pool.query(`SELECT created_at::date as date, COALESCE(SUM(total),0) as daily_sales, COUNT(*) as invoice_count FROM invoices WHERE business_id=$1 ${dateFilter} GROUP BY created_at::date ORDER BY date`, dateParams),
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
      pool.query(`SELECT c.name, c.phone, c.balance FROM customers WHERE business_id=$1 AND balance > 0 ORDER BY c.balance DESC LIMIT 20`, [businessId]),
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

app.get('/api/restaurant/settings', auth, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' })
  const result = await pool.query('SELECT total_tables FROM restaurant_settings WHERE business_id=$1', [req.user.id])
  res.json({ totalTables: result.rows[0]?.total_tables || 0 })
})

app.post('/api/restaurant/settings', auth, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' })
  const { totalTables } = req.body
  if (typeof totalTables !== 'number' || totalTables < 0 || totalTables > 100) {
    return res.status(400).json({ error: 'Total tables must be a number between 0 and 100' })
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      'INSERT INTO restaurant_settings (business_id, total_tables, updated_at) VALUES ($1,$2,NOW()) ON CONFLICT (business_id) DO UPDATE SET total_tables=$2, updated_at=NOW()',
      [req.user.id, totalTables]
    )
    if (totalTables > 0) {
      const existing = await client.query('SELECT table_number FROM restaurant_tables WHERE business_id=$1', [req.user.id])
      const existingNumbers = new Set(existing.rows.map(r => r.table_number))
      const toInsert = []
      for (let i = 1; i <= totalTables; i++) {
        if (!existingNumbers.has(i)) toInsert.push(i)
      }
      if (toInsert.length) {
        const values = toInsert.map((_, idx) => `($1, $${idx + 2}, 'vacant', NOW(), NOW())`).join(',')
        await client.query(
          `INSERT INTO restaurant_tables (business_id, table_number, status, created_at, updated_at) VALUES ${values} ON CONFLICT (business_id, table_number) DO NOTHING`,
          [req.user.id, ...toInsert]
        )
      }
      if (totalTables < Math.max(...existingNumbers, 0)) {
        await client.query('DELETE FROM restaurant_tables WHERE business_id=$1 AND table_number > $2', [req.user.id, totalTables])
      }
    } else {
      await client.query('DELETE FROM restaurant_tables WHERE business_id=$1', [req.user.id])
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

app.get('/api/restaurant/tables', auth, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' })
  const result = await pool.query(
    'SELECT id, table_number, status, customer_name, expected_time FROM restaurant_tables WHERE business_id=$1 ORDER BY table_number',
    [req.user.id]
  )
  res.json(result.rows)
})

app.patch('/api/restaurant/tables/:id', auth, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' })
  const { status, customerName, expectedTime } = req.body
  if (!['vacant', 'occupied', 'reserved'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' })
  }
  const result = await pool.query(
    'UPDATE restaurant_tables SET status=$1, customer_name=$2, expected_time=$3, updated_at=NOW() WHERE id=$4 AND business_id=$5 RETURNING *',
    [status, customerName || null, expectedTime || null, req.params.id, req.user.id]
  )
  if (!result.rows.length) return res.status(404).json({ error: 'Table not found' })
  res.json(result.rows[0])
})

// Get or create open order for a table
app.get('/api/restaurant/tables/:tableId/order', auth, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' })
  const tableId = req.params.tableId
  
  // Verify table belongs to business
  const tableCheck = await pool.query('SELECT id FROM restaurant_tables WHERE id=$1 AND business_id=$2', [tableId, req.user.id])
  if (!tableCheck.rows.length) return res.status(404).json({ error: 'Table not found' })
  
  // Get or create open order
  let orderResult = await pool.query(
    'SELECT * FROM table_orders WHERE table_id=$1 AND business_id=$2 AND status IN (\'open\', \'sent_to_kitchen\') ORDER BY created_at DESC LIMIT 1',
    [tableId, req.user.id]
  )
  
  if (!orderResult.rows.length) {
    orderResult = await pool.query(
      'INSERT INTO table_orders (business_id, table_id, status, total_amount) VALUES ($1,$2,\'open\',0) RETURNING *',
      [req.user.id, tableId]
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
app.post('/api/restaurant/tables/:tableId/order/items', auth, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' })
  const tableId = req.params.tableId
  const { items } = req.body // [{ productId, quantity, note }]
  
  if (!items || !items.length) return res.status(400).json({ error: 'Items required' })
  
  // Verify table belongs to business
  const tableCheck = await pool.query('SELECT id FROM restaurant_tables WHERE id=$1 AND business_id=$2', [tableId, req.user.id])
  if (!tableCheck.rows.length) return res.status(404).json({ error: 'Table not found' })
  
  // Get or create open order
  let orderResult = await pool.query(
    'SELECT * FROM table_orders WHERE table_id=$1 AND business_id=$2 AND status IN (\'open\', \'sent_to_kitchen\') ORDER BY created_at DESC LIMIT 1',
    [tableId, req.user.id]
  )
  
  if (!orderResult.rows.length) {
    orderResult = await pool.query(
      'INSERT INTO table_orders (business_id, table_id, status, total_amount) VALUES ($1,$2,\'open\',0) RETURNING *',
      [req.user.id, tableId]
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
        [productId, req.user.id]
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
app.get('/api/restaurant/tables/:tableId/kot', auth, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' })
  const tableId = req.params.tableId
  
  // Verify table belongs to business
  const tableResult = await pool.query(
    'SELECT id, table_number FROM restaurant_tables WHERE id=$1 AND business_id=$2',
    [tableId, req.user.id]
  )
  if (!tableResult.rows.length) return res.status(404).json({ error: 'Table not found' })
  
  const table = tableResult.rows[0]
  
  // Get the latest order for this table
  const orderResult = await pool.query(
    'SELECT * FROM table_orders WHERE table_id=$1 AND business_id=$2 AND status IN (\'open\', \'sent_to_kitchen\') ORDER BY created_at DESC LIMIT 1',
    [tableId, req.user.id]
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
  const businessResult = await pool.query('SELECT name FROM businesses WHERE id=$1', [req.user.id])
  
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
app.post('/api/restaurant/tables/:tableId/order/send-to-kitchen', auth, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' })
  const tableId = req.params.tableId
  
  // Verify table belongs to business
  const tableCheck = await pool.query('SELECT id FROM restaurant_tables WHERE id=$1 AND business_id=$2', [tableId, req.user.id])
  if (!tableCheck.rows.length) return res.status(404).json({ error: 'Table not found' })
  
  // Get the latest order
  const orderResult = await pool.query(
    'SELECT * FROM table_orders WHERE table_id=$1 AND business_id=$2 AND status IN (\'open\', \'sent_to_kitchen\') ORDER BY created_at DESC LIMIT 1',
    [tableId, req.user.id]
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
app.post('/api/restaurant/tables/:tableId/order/generate-bill', auth, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' })
  const tableId = req.params.tableId
  const { customerId, paid = 0 } = req.body
  
  // Verify table belongs to business
  const tableCheck = await pool.query('SELECT id, table_number FROM restaurant_tables WHERE id=$1 AND business_id=$2', [tableId, req.user.id])
  if (!tableCheck.rows.length) return res.status(404).json({ error: 'Table not found' })
  const table = tableCheck.rows[0]
  
  // Get the latest order
  const orderResult = await pool.query(
    'SELECT * FROM table_orders WHERE table_id=$1 AND business_id=$2 AND status IN (\'open\', \'sent_to_kitchen\') ORDER BY created_at DESC LIMIT 1',
    [tableId, req.user.id]
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
    
    const total = Number(order.total_amount)
    const paymentAmount = Number(paid) || 0
    const due = Math.max(total - paymentAmount, 0)
    const udharEnabledTypes = ['retail', 'wholesaler', 'school', 'other']
    const businessCategory = req.user.category || 'other'
    const hasUdhar = udharEnabledTypes.includes(businessCategory)
    const status = paymentAmount >= total ? 'paid' : paymentAmount > 0 ? 'partial' : (hasUdhar ? 'udhar' : 'unpaid')
    
    // Create invoice
    const invoiceResult = await client.query(
      'INSERT INTO invoices (business_id, customer_id, total, paid, status) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [req.user.id, customerId || null, total, paymentAmount, status]
    )
    const invoice = invoiceResult.rows[0]
    
    // Add invoice items with GST (default 5% for restaurant food)
    for (const item of itemsResult.rows) {
      const gstPercent = 5 // Default GST for restaurant food items
      await client.query(
        'INSERT INTO invoice_items (invoice_id, product_id, quantity, price, gst_percent, discount_percent, discount_amount) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [invoice.id, item.product_id, item.quantity, item.price, gstPercent, 0, 0]
      )
    }
    
    // Update customer balance if there's due amount
    if (customerId && due > 0) {
      await client.query('UPDATE customers SET balance=balance+$1 WHERE id=$2 AND business_id=$3', [due, customerId, req.user.id])
      await client.query("INSERT INTO udhar_ledger (customer_id, invoice_id, type, amount, note) VALUES ($1,$2,'credit',$3,'Invoice credit')", [customerId, invoice.id, due])
    }
    
    // Mark table order as closed
    await client.query(
      'UPDATE table_orders SET status=\'closed\', updated_at=NOW() WHERE id=$1',
      [order.id]
    )
    
    // Free up the table
    await client.query(
      'UPDATE restaurant_tables SET status=\'vacant\', customer_name=NULL, expected_time=NULL, updated_at=NOW() WHERE id=$1',
      [tableId]
    )
    
    await client.query('COMMIT')
    
    res.status(201).json({ 
      invoice, 
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
app.get('/api/restaurant/tables/:tableId/order/bill-preview', auth, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' })
  const tableId = req.params.tableId
  
  // Verify table belongs to business
  const tableCheck = await pool.query('SELECT id, table_number FROM restaurant_tables WHERE id=$1 AND business_id=$2', [tableId, req.user.id])
  if (!tableCheck.rows.length) return res.status(404).json({ error: 'Table not found' })
  const table = tableCheck.rows[0]
  
  // Get the latest order
  const orderResult = await pool.query(
    'SELECT * FROM table_orders WHERE table_id=$1 AND business_id=$2 AND status IN (\'open\', \'sent_to_kitchen\') ORDER BY created_at DESC LIMIT 1',
    [tableId, req.user.id]
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
  const businessResult = await pool.query('SELECT name, address FROM businesses WHERE id=$1', [req.user.id])

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

app.post('/api/payments', auth, async (req, res) => {
  const { customerId, amount, note = 'Payment received' } = req.body
  if (!customerId || !amount || Number(amount) <= 0) return res.status(400).json({ error: 'Customer and positive payment amount are required' })
  const result = await pool.query('UPDATE customers SET balance=GREATEST(balance-$1,0) WHERE id=$2 AND business_id=$3 RETURNING *', [amount, customerId, req.user.id])
  if (!result.rows.length) return res.status(404).json({ error: 'Customer not found' })
  await pool.query("INSERT INTO udhar_ledger (customer_id, type, amount, note) VALUES ($1,'payment',$2,$3)", [customerId, amount, note])
  res.status(201).json(result.rows[0])
})

app.post('/api/invoices/:id/pdf', auth, async (req, res) => {
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
    [invoiceId, req.user.id]
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
  doc.text('Unit', tableLeft + colWidths.sr + colWidths.name + colWidths.qty + 5, y + 5, { width: colWidths.unit, align: 'center' })
  doc.text('Price', tableLeft + colWidths.sr + colWidths.name + colWidths.qty + colWidths.unit + 5, y + 5, { width: colWidths.price, align: 'right' })
  doc.text('Disc %', tableLeft + colWidths.sr + colWidths.name + colWidths.qty + colWidths.unit + colWidths.price + 5, y + 5, { width: colWidths.disc, align: 'center' })
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
    doc.text(item.unit || 'pcs', tableLeft + colWidths.sr + colWidths.name + colWidths.qty + 5, y + 5, { width: colWidths.unit, align: 'center' })
    doc.text(`₹${price.toFixed(2)}`, tableLeft + colWidths.sr + colWidths.name + colWidths.qty + colWidths.unit + 5, y + 5, { width: colWidths.price, align: 'right' })
    doc.text(`${discountPercent}%`, tableLeft + colWidths.sr + colWidths.name + colWidths.qty + colWidths.unit + colWidths.price + 5, y + 5, { width: colWidths.disc, align: 'center' })
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

app.post('/api/business/update-type', auth, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' })
  const { category } = req.body
  const validCategories = ['retail', 'wholesaler', 'restaurant', 'school', 'services', 'other']
  if (!validCategories.includes(category)) {
    return res.status(400).json({ error: 'Invalid business type' })
  }
  const result = await pool.query('UPDATE businesses SET category=$1 WHERE id=$2 RETURNING id, name, owner_name, email, phone, category, business_description, is_existing, years_running, address', [category, req.user.id])
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
