-- Add gst_percent column to invoice_items if not exists
ALTER TABLE invoice_items 
ADD COLUMN IF NOT EXISTS gst_percent NUMERIC(5,2) NOT NULL DEFAULT 0;

-- Add discount columns to invoice_items
ALTER TABLE invoice_items 
ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0;