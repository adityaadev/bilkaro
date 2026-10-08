import jwt from 'jsonwebtoken';
import { pool } from '../db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'bilkaro-local-secret';
const JWT_ACCESS_EXPIRY = process.env.JWT_ACCESS_EXPIRY || '15m';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'bilkaro-refresh-secret';
const JWT_REFRESH_EXPIRY = process.env.JWT_REFRESH_EXPIRY || '7d';

// Permission cache for performance
const permissionCache = new Map();

async function getUserPermissions(roleId) {
  if (!roleId) return [];
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

export function getPermissionsForRole(roleName, fallback = []) {
  if (!roleName) return fallback;
  const normalized = String(roleName).toLowerCase();
  return ROLE_PERMISSIONS_LEGACY[normalized] || fallback || ROLE_PERMISSIONS_LEGACY.staff;
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
    console.log('[Auth] Decoded token:', JSON.stringify(decoded));
    
    // New format (full): { userId, businessId, roleId, permissions? }
    if (decoded.userId && decoded.businessId && decoded.roleId) {
      let permissions = Array.isArray(decoded.permissions) ? decoded.permissions : [];
      if (!permissions.length) {
        permissions = getPermissionsForRole(decoded.roleName, []);
      }
      if (!permissions.length) {
        try {
          permissions = await getUserPermissions(decoded.roleId);
        } catch (dbError) {
          console.warn('[Auth] Failed to load permissions from DB, falling back to role defaults:', dbError.message);
          permissions = getPermissionsForRole(decoded.roleName, []);
        }
      }
      
      let membershipResult;
      try {
        membershipResult = await pool.query(`
          SELECT m.*, r.name as role_name 
          FROM memberships m
          JOIN roles r ON r.id = m.role_id
          WHERE m.user_id = $1 AND m.business_id = $2 AND m.role_id = $3 AND m.status = 'active'
        `, [decoded.userId, decoded.businessId, decoded.roleId]);
      } catch (dbError) {
        console.error('[Auth] Membership lookup failed:', dbError.message);
        return res.status(503).json({ error: 'Authentication service unavailable' });
      }
      
      if (membershipResult.rows.length === 0) {
        return res.status(401).json({ error: 'Membership not found or inactive' });
      }
      
      const membership = membershipResult.rows[0];
      req.userId = decoded.userId;
      req.businessId = decoded.businessId;
      req.roleId = decoded.roleId;
      req.roleName = membership.role_name;
      req.permissions = permissions;
      req.membership = membership;
      req.email = membership.email || null; // For legacy compatibility
      req.membershipId = membership.id;
      return next();
    }
    
    // Transitional format: { userId, businessId } - roleId is null (pre-migration)
    // userId here is the team_member id
    if (decoded.userId && decoded.businessId && !decoded.roleId) {
      // Look up team_members directly
      let membershipResult;
      try {
        membershipResult = await pool.query(`
          SELECT tm.id as membership_id, tm.business_id, tm.email, tm.name, tm.role as role_name
          FROM team_members tm
          WHERE tm.id = $1 AND tm.business_id = $2
        `, [decoded.userId, decoded.businessId]);
      } catch (dbError) {
        console.error('[Auth] Transitional membership lookup failed:', dbError.message);
        return res.status(503).json({ error: 'Authentication service unavailable' });
      }
      
      console.log('[Auth] Transitional token, membershipResult:', membershipResult.rows.length);
      
      if (membershipResult.rows.length === 0) {
        return res.status(401).json({ error: 'Membership not found or inactive' });
      }
      
      const membership = membershipResult.rows[0];
      const permissions = ROLE_PERMISSIONS_LEGACY[membership.role_name] || ROLE_PERMISSIONS_LEGACY.staff;
      
      req.userId = decoded.userId;
      req.businessId = decoded.businessId;
      req.roleId = null;
      req.roleName = membership.role_name;
      req.permissions = permissions;
      req.membership = membership;
      req.email = membership.email;
      req.membershipId = membership.membership_id;
      req.legacyToken = true;
      return next();
    }
    
// Legacy format (old JWT): { businessId, email, role, userType, teamMemberId? }
    // Also supports: { id, email, category } where id = business_id
    if ((decoded.businessId || decoded.id) && decoded.email) {
      const businessId = decoded.businessId || decoded.id;
      
      // Try new schema first (memberships -> users)
      let membershipResult;
      try {
        membershipResult = await pool.query(`
          SELECT m.*, u.id as user_id, u.email, r.name as role_name
          FROM memberships m
          JOIN users u ON u.email = $1
          JOIN roles r ON r.id = m.role_id
          WHERE m.business_id = $2 AND m.user_id = u.id AND m.status = 'active'
        `, [decoded.email, businessId]);
      } catch (dbError) {
        console.error('[Auth] Legacy membership lookup failed:', dbError.message);
        return res.status(503).json({ error: 'Authentication service unavailable' });
      }
      
      // Fallback: legacy team_members table
      if (membershipResult.rows.length === 0) {
        try {
          membershipResult = await pool.query(`
            SELECT tm.id as membership_id, tm.id as user_id, tm.business_id, tm.email, tm.name, tm.role as role_name
            FROM team_members tm
            WHERE tm.business_id = $1 AND tm.email = $2
          `, [businessId, decoded.email]);
        } catch (dbError) {
          console.error('[Auth] Legacy team member fallback lookup failed:', dbError.message);
          return res.status(503).json({ error: 'Authentication service unavailable' });
        }
      }
      
      if (membershipResult.rows.length === 0) {
        return res.status(401).json({ error: 'No active membership for this business' });
      }
      
      const membership = membershipResult.rows[0];
      let permissions;
      
      // If using new schema, get permissions from role_permissions
      if (membership.role_id) {
        permissions = await getUserPermissions(membership.role_id);
      } else {
        // Legacy: map role string to hardcoded permissions
        const role = membership.role_name || decoded.role || 'owner';
        permissions = ROLE_PERMISSIONS_LEGACY[role] || ROLE_PERMISSIONS_LEGACY.staff;
      }
      
      req.userId = membership.user_id || membership.membership_id;
      req.businessId = membership.business_id;
      req.roleId = membership.role_id || null;
      req.roleName = membership.role_name;
      req.permissions = permissions;
      req.membership = membership;
      req.email = membership.email;
      req.membershipId = membership.membership_id || membership.id;
      req.legacyToken = true; // Flag for token refresh
      return next();
    }
    
    return res.status(401).json({ error: 'Invalid token format' });
  } catch (e) {
    console.error('[Auth] Error:', e.message, e.stack);
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

// Legacy permission map for backward compatibility
const ROLE_PERMISSIONS_LEGACY = {
  owner: [
    'dashboard.view', 'products.read', 'products.create', 'products.update', 'products.delete',
    'customers.read', 'customers.create', 'customers.update', 'customers.delete',
    'invoices.read', 'invoices.create', 'invoices.update', 'invoices.delete', 'invoices.export',
    'expenses.read', 'expenses.create', 'expenses.update', 'expenses.delete',
    'analytics.view', 'analytics.export',
    'reports.view', 'reports.export',
    'payments.create', 'payments.read',
    'restaurant.view', 'restaurant.manage_tables', 'restaurant.manage_orders', 'restaurant.kot',
    'settings.business_type', 'settings.restaurant', 'settings.modules', 'settings.team',
    'users.invite', 'users.manage_roles', 'users.remove'
  ],
  manager: [
    'dashboard.view', 'products.read', 'products.create', 'products.update', 'products.delete',
    'customers.read', 'customers.create', 'customers.update', 'customers.delete',
    'invoices.read', 'invoices.create', 'invoices.update', 'invoices.delete', 'invoices.export',
    'expenses.read', 'expenses.create', 'expenses.update', 'expenses.delete',
    'analytics.view', 'analytics.export',
    'reports.view', 'reports.export',
    'payments.create', 'payments.read',
    'restaurant.view', 'restaurant.manage_tables', 'restaurant.manage_orders', 'restaurant.kot',
    'settings.business_type', 'settings.restaurant', 'settings.modules'
  ],
  staff: [
    'dashboard.view', 'products.read', 'customers.read', 'invoices.create', 'invoices.read'
  ]
};

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