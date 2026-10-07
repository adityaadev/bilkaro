import pg from 'pg';
const pool = new pg.Pool({ 
  connectionString: 'postgresql://neondb_owner:npg_KHMfLj34waJW@ep-ancient-poetry-a54fdhe3-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require', 
  connectionTimeoutMillis: 5000
});

async function check() {
  try {
    // Check if team_members table exists
    const tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'team_members'");
    console.log('team_members table exists:', tables.rows.length > 0);
    
    if (tables.rows.length > 0) {
      const columns = await pool.query("SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'team_members' ORDER BY ordinal_position");
      console.log('Columns:', JSON.stringify(columns.rows, null, 2));
      
      const constraints = await pool.query("SELECT conname, contype, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'team_members'::regclass");
      console.log('Constraints:', JSON.stringify(constraints.rows, null, 2));
      
      const indexes = await pool.query("SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'team_members'");
      console.log('Indexes:', JSON.stringify(indexes.rows, null, 2));
      
      // Check existing team members
      const members = await pool.query("SELECT id, business_id, name, email, role, created_at FROM team_members");
      console.log('Existing team members:', JSON.stringify(members.rows, null, 2));
    }
  } catch(e) {
    console.error('Error:', e.message);
  } finally {
    pool.end();
  }
}
check();