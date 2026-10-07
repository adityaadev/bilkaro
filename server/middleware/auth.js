import jwt from 'jsonwebtoken';
import pg from 'pg';

const JWT_SECRET = process.env.JWT_SECRET || 'bilkaro-local-secret';
const JWT_ACCESS_EXPIRY = process.env.JWT_ACCESS_EXPIRY || '15m';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'bilkaro-refresh-secret';
const JWT_REFRESH_EXPIRY = process.env.JWT_REFRESH_EXPIRY || '7d';

const pool = new pg.Pool({ 
  connectionString: process.env.DATABASE_URL, 
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false 
});

// Permission cache for performance
const permissionCache = new Map();

async function getUserPermissions(roleId) {
  if (permissionCache.has(roleId)) {
    return permissionCache.get(roleId);
  }
  
  const result = await pool.query(`
    SELECT p.key FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = $1
  `, [roleId]);
  
  const permissions = result.rows.map(r => r.key);
  permissionCache.set(roleId, permissions);
  return permissions;
}

function clearPermissionCache(roleId) {
  permissionCache.delete(roleId);
}

function generateAccessToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_ACCESS_EXPIRY });
}

function generateRefreshToken(payload) {
  return jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: JWT_REFRESH_EXPIRY });
}

function verifyAccessToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function verifyRefreshToken(token) {
  return jwt.verify(token, JWT_REFRESH_SECRET);
}

// New auth middleware - loads membership, role, permissions
export async function auth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  const token = authHeader.replace('Bearer ', '');
  
  try {
    // Try new token format first
    const decoded = verifyAccessToken(token);
    
    // New format: { userId, businessId, roleId, permissions? }
    if (decoded.userId && decoded.businessId && decoded.roleId) {
      // Permissions might be in token (for performance) or we fetch them
      let permissions = decoded.permissions;
      if (!permissions) {
        permissions = await getUserPermissions(decoded.roleId);
      }
      
      // Verify membership is still active
      const membershipResult = await pool.query(`
        SELECT m.*, r.name as role_name 
        FROM memberships m
        JOIN roles r ON r.id = m.role_id
        WHERE m.user_id = $1 AND m.business_id = $2 AND m.role_id = $3 AND m.status = 'active'
      `, [decoded.userId, decoded.businessId, decoded.roleId]);
      
      if (membershipResult.rows.length === 0) {
        return res.status(401).json({ error: 'Membership not found or inactive' });
      }
      
      req.userId = decoded.userId;
      req.businessId = decoded.businessId;
      req.roleId = decoded.roleId;
      req.roleName = membershipResult.rows[0].role_name;
      req.permissions = permissions;
      req.membership = membershipResult.rows[0];
      return next();
    }
    
    // Legacy format: { id, email, category } where id = business_id
    if (decoded.id && decoded.email) {
      // For backward compatibility during transition
      // We need to find the user's membership for this business
      const membershipResult = await pool.query(`
        SELECT m.*, u.id as user_id, r.name as role_name
        FROM memberships m
        JOIN users u ON u.email = $1
        JOIN roles r ON r.id = m.role_id
        WHERE m.business_id = $2 AND m.user_id = u.id AND m.status = 'active'
      `, [decoded.email, decoded.id]);
      
      if (membershipResult.rows.length === 0) {
        return res.status(401).json({ error: 'No active membership for this business' });
      }
      
      const membership = membershipResult.rows[0];
      const permissions = await getUserPermissions(membership.role_id);
      
      req.userId = membership.user_id;
      req.businessId = membership.business_id;
      req.roleId = membership.role_id;
      req.roleName = membership.role_name;
      req.permissions = permissions;
      req.membership = membership;
      req.legacyToken = true; // Flag for token refresh
      return next();
    }
    
    return res.status(401).json({ error: 'Invalid token format' });
  } catch (e) {
    if (e.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    if (e.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    console.error('[Auth Error]', e);
    return res.status(500).json({ error: 'Authentication error' });
  }
}

// Optional auth - doesn't fail if no token
export async function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return next();
  }
  
  try {
    await auth(req, res, next);
  } catch {
    next(); // Continue without auth
  }
}

// Permission middleware factory
export function requirePermission(...permissionKeys) {
  return (req, res, next) => {
    if (!req.permissions) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const hasPermission = permissionKeys.some(key => req.permissions.includes(key));
    if (!hasPermission) {
      return res.status(403).json({ 
        error: `Permission required: ${permissionKeys.join(' or ')}` 
      });
    }
    next();
  };
}

// Role middleware factory
export function requireRole(...roleNames) {
  return (req, res, next) => {
    if (!req.roleName || !roleNames.includes(req.roleName)) {
      return res.status(403).json({ 
        error: `Role required: ${roleNames.join(' or ')}` 
      });
    }
    next();
  };
}

// Business ownership check (for owner-only actions)
export function requireBusinessOwnership() {
  return (req, res, next) => {
    if (req.membership?.role_name !== 'owner') {
      return res.status(403).json({ error: 'Business owner access required' });
    }
    next();
  };
}

export { pool, generateAccessToken, generateRefreshToken, verifyAccessToken, verifyRefreshToken, clearPermissionCache };