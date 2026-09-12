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

const toBusiness = (business) => business && ({ id: business.id, name: business.name, ownerName: business.owner_name, email: business.email, phone: business.phone, category: business.category, businessDescription: business.business_description, isExisting: business.is_existing, yearsRunning: business.years_running, address: business.address })
const tokenFor = (user) => jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET || 'bilkaro-local-secret', { expiresIn: '7d' })
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
  const { customerId, items = [], total, paid = 0, status = 'paid' } = req.body
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
    const invoice = await client.query('INSERT INTO invoices (business_id, customer_id, total, paid, status) VALUES ($1,$2,$3,$4,$5) RETURNING *', [req.user.id, customerId || null, total, paid, status])
    for (const item of items) {
      await client.query('INSERT INTO invoice_items (invoice_id, product_id, quantity, price) VALUES ($1,$2,$3,$4)', [invoice.rows[0].id, item.productId, item.quantity, item.price])
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
app.post('/api/payments', auth, async (req, res) => {
  const { customerId, amount, note = 'Payment received' } = req.body
  if (!customerId || !amount || Number(amount) <= 0) return res.status(400).json({ error: 'Customer and positive payment amount are required' })
  const result = await pool.query('UPDATE customers SET balance=GREATEST(balance-$1,0) WHERE id=$2 AND business_id=$3 RETURNING *', [amount, customerId, req.user.id])
  if (!result.rows.length) return res.status(404).json({ error: 'Customer not found' })
  await pool.query("INSERT INTO udhar_ledger (customer_id, type, amount, note) VALUES ($1,'payment',$2,$3)", [customerId, amount, note])
  res.status(201).json(result.rows[0])
})
app.use((error, _req, res, _next) => { console.error('[API ERROR]', error); res.status(error.status || 500).json({ error: error.message || 'Internal server error' }) })
app.use(express.static('dist'))
app.listen(port, () => {
  console.log(`Bilkaro API running on http://localhost:${port}`)
  console.log('DATABASE_URL:', process.env.DATABASE_URL)
})
