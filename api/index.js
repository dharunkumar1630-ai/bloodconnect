// BloodConnect Serverless API Handler (Vercel Serverless Function & REST Backend)
const fs = require('fs');
const path = require('path');

// Blood compatibility matrix
const BLOOD_COMPATIBILITY = {
  'O-': ['O-'],
  'O+': ['O+', 'O-'],
  'A-': ['A-', 'O-'],
  'A+': ['A+', 'A-', 'O+', 'O-'],
  'B-': ['B-', 'O-'],
  'B+': ['B+', 'B-', 'O+', 'O-'],
  'AB-': ['AB-', 'A-', 'B-', 'O-'],
  'AB+': ['AB+', 'AB-', 'A+', 'A-', 'B+', 'B-', 'O+', 'O-']
};

const DB_FILE = path.join(__dirname, '..', 'data.json');
const TMP_DB_FILE = path.join('/tmp', 'bloodconnect_data.json');

// In-memory DB cache for serverless environments
let memoryDB = null;

function loadDB() {
  if (memoryDB) return memoryDB;

  // Try reading from /tmp in Vercel lambda containers
  try {
    if (fs.existsSync(TMP_DB_FILE)) {
      const content = fs.readFileSync(TMP_DB_FILE, 'utf-8');
      memoryDB = JSON.parse(content);
      if (!Array.isArray(memoryDB.users)) memoryDB.users = [];
      if (!Array.isArray(memoryDB.requests)) memoryDB.requests = [];
      if (!Array.isArray(memoryDB.notifications)) memoryDB.notifications = [];
      return memoryDB;
    }
  } catch (e) {}

  try {
    if (fs.existsSync(DB_FILE)) {
      const content = fs.readFileSync(DB_FILE, 'utf-8');
      memoryDB = JSON.parse(content);
      if (!Array.isArray(memoryDB.users)) memoryDB.users = [];
      if (!Array.isArray(memoryDB.requests)) memoryDB.requests = [];
      if (!Array.isArray(memoryDB.notifications)) memoryDB.notifications = [];
      return memoryDB;
    }
  } catch (e) {
    console.warn('Error reading data.json, initializing default:', e.message);
  }
  memoryDB = { users: [], requests: [], notifications: [] };
  return memoryDB;
}

function saveDB(db) {
  memoryDB = db;
  // Try persisting to /tmp (writable in AWS Lambda/Vercel serverless functions)
  try {
    fs.writeFileSync(TMP_DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
  } catch (e) {}
  // Also try writing to project root (works locally)
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
  } catch (e) {
    // Read-only filesystem in Vercel lambda is expected
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With'
  });
  res.end(JSON.stringify(payload));
}

function parseJsonBody(req) {
  if (req.body) {
    if (typeof req.body === 'object') return Promise.resolve(req.body);
    try {
      return Promise.resolve(JSON.parse(req.body));
    } catch (e) {
      return Promise.resolve({});
    }
  }
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 2e6) { // 2MB limit
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With'
    });
    return res.end();
  }

  // Support direct URL invocation, Vercel catch-all [...path], and Vercel rewrites
  let url = (req.url || '/').split('?')[0];

  // If invoked via Vercel dynamic catch-all route api/[...path].js
  if (req.query && req.query.path) {
    const pathParts = Array.isArray(req.query.path) ? req.query.path.join('/') : req.query.path;
    url = '/api/' + (pathParts.startsWith('/') ? pathParts.slice(1) : pathParts);
  } else if (req.headers && req.headers['x-forwarded-url']) {
    url = req.headers['x-forwarded-url'].split('?')[0];
  } else if (req.headers && req.headers['x-original-url']) {
    url = req.headers['x-original-url'].split('?')[0];
  } else if (req.headers && req.headers['x-matched-path']) {
    const matched = req.headers['x-matched-path'].split('?')[0];
    if (matched && matched !== '/api' && matched !== '/api/') {
      url = matched;
    }
  }

  // If Vercel rewrote to /api, extract sub-route from query parameter if present
  if (url === '/api' || url === '/api/' || url === '/api/index.js' || url === '/index.js') {
    const q = req.query || {};
    let sub = q.__route || q.route;
    if (!sub && req.url && req.url.includes('__route=')) {
      try {
        const parsed = new URL(req.url, 'http://localhost');
        sub = parsed.searchParams.get('__route');
      } catch (e) {}
    }
    if (sub) {
      url = '/api/' + (sub.startsWith('/') ? sub.slice(1) : sub);
    }
  }

  // Normalize trailing slash
  if (url.length > 1 && url.endsWith('/')) {
    url = url.slice(0, -1);
  }

  const db = loadDB();

  // Root API ping/health route
  if ((url === '/api' || url === '/api/index') && req.method === 'GET') {
    return sendJson(res, 200, {
      status: 'online',
      service: 'BloodConnect Emergency Network API',
      version: '2.0.0'
    });
  }

  // Route: GET /api/events (SSE stream connection compatibility)
  if (url === '/api/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write('retry: 3000\n\n');
    res.write(`data: ${JSON.stringify({ type: 'CONNECTED', timestamp: Date.now() })}\n\n`);
    return res.end();
  }

  // Route: GET /api/status or /api/health
  if ((url === '/api/status' || url === '/api/health') && req.method === 'GET') {
    return sendJson(res, 200, {
      status: 'online',
      service: 'BloodConnect Emergency Network API',
      usersCount: db.users.length,
      activeRequests: db.requests.filter(r => r.status === 'searching').length,
      timestamp: new Date().toISOString()
    });
  }

  // Route: GET /api/donors
  if (url === '/api/donors' && req.method === 'GET') {
    const donors = db.users.filter(u => u.role === 'donor').map(u => ({ ...u, password: '[PROTECTED]' }));
    return sendJson(res, 200, { success: true, donors });
  }

  // Route: GET /api/data
  if (url === '/api/data' && req.method === 'GET') {
    return sendJson(res, 200, {
      success: true,
      users: db.users.map(u => ({ ...u, password: '[PROTECTED]' })),
      requests: db.requests,
      notifications: db.notifications
    });
  }

  // Route: POST /api/auth/login
  if (url === '/api/auth/login' && req.method === 'POST') {
    try {
      const { email, password } = await parseJsonBody(req);
      const cleanEmail = (email || '').trim().toLowerCase();
      const cleanDigits = cleanEmail.replace(/\D/g, '');

      const user = db.users.find(u => {
        const uEmail = (u.email || '').toLowerCase().trim();
        const uPhoneDigits = (u.phone || '').replace(/\D/g, '');
        const emailMatches = uEmail && uEmail === cleanEmail;
        const phoneMatches = cleanDigits && uPhoneDigits && (uPhoneDigits.includes(cleanDigits) || cleanDigits.includes(uPhoneDigits));
        const nameMatches = (u.name || '').toLowerCase().trim() === cleanEmail;
        return emailMatches || phoneMatches || nameMatches;
      });

      if (user) {
        if (user.age && parseInt(user.age, 10) < 18) {
          return sendJson(res, 403, { success: false, message: 'Access Restricted: Only individuals aged 18 and above are eligible to access BloodConnect.' });
        }
        if (user.password && password && user.password !== password) {
          return sendJson(res, 401, { success: false, message: 'Incorrect password. Please verify and try again.' });
        }
        const safeUser = { ...user };
        delete safeUser.password;
        return sendJson(res, 200, { success: true, user: safeUser });
      }

      return sendJson(res, 401, { success: false, message: 'Account not found. Please sign up to create a new account.' });
    } catch (e) {
      return sendJson(res, 400, { success: false, message: e.message });
    }
  }

  // Route: POST /api/auth/register
  if (url === '/api/auth/register' && req.method === 'POST') {
    try {
      const data = await parseJsonBody(req);
      const userAge = parseInt(data.age, 10);
      if (isNaN(userAge) || userAge < 18) {
        return sendJson(res, 400, { success: false, message: 'Access Restricted: You must be at least 18 years old to access and register on BloodConnect.' });
      }

      const cleanEmail = (data.email || '').trim().toLowerCase();
      const cleanPhone = (data.phone || '').trim();
      const cleanDigits = cleanPhone.replace(/\D/g, '');

      // Check for duplicate account
      let existing = db.users.find(u => {
        const uEmail = (u.email || '').trim().toLowerCase();
        const uDigits = (u.phone || '').replace(/\D/g, '');
        return (cleanEmail && uEmail === cleanEmail) || (cleanDigits && uDigits && cleanDigits === uDigits);
      });

      if (existing) {
        // Update existing user details
        Object.assign(existing, {
          name: data.name || existing.name,
          age: data.age ? parseInt(data.age, 10) : existing.age,
          address: data.address || existing.address,
          city: data.address || data.city || existing.city,
          bloodGroup: data.bloodGroup || existing.bloodGroup,
          password: data.password || existing.password,
          availability: true
        });
        saveDB(db);
        const safe = { ...existing };
        delete safe.password;
        return sendJson(res, 200, { success: true, user: safe, updated: true });
      }

      const newUser = {
        id: `usr-${Date.now()}`,
        name: data.name || 'Anonymous User',
        age: data.age ? parseInt(data.age, 10) : 25,
        email: cleanEmail || `user${Date.now()}@bloodconnect.org`,
        phone: cleanPhone || '+91 90000 00000',
        address: data.address || '',
        city: data.address || data.city || 'Anna Nagar, Chennai',
        bloodGroup: data.bloodGroup || 'O+',
        role: data.role || 'donor',
        password: data.password || 'password123',
        availability: true,
        emergencyOptIn: data.emergencyOptIn !== false,
        relationship: data.relationship || 'Donor',
        impactLives: 0,
        donationsCount: 0,
        rapidResponses: 0,
        createdAt: new Date().toISOString()
      };

      db.users.push(newUser);
      saveDB(db);

      const safeUser = { ...newUser };
      delete safeUser.password;
      return sendJson(res, 201, { success: true, user: safeUser });
    } catch (e) {
      return sendJson(res, 400, { success: false, message: e.message });
    }
  }

  // Route: POST /api/auth/delete-account
  if (url === '/api/auth/delete-account' && req.method === 'POST') {
    try {
      const { userId } = await parseJsonBody(req);
      db.users = db.users.filter(u => u.id !== userId);
      db.requests = db.requests.filter(r => r.requesterId !== userId);
      saveDB(db);
      return sendJson(res, 200, { success: true, message: 'Account deleted successfully' });
    } catch (e) {
      return sendJson(res, 400, { success: false, message: e.message });
    }
  }

  // Route: POST /api/auth/clear-all-accounts
  if (url === '/api/auth/clear-all-accounts' && req.method === 'POST') {
    try {
      db.users = [];
      db.requests = [];
      db.notifications = [];
      saveDB(db);
      return sendJson(res, 200, { success: true, message: 'All accounts and data have been wiped' });
    } catch (e) {
      return sendJson(res, 400, { success: false, message: e.message });
    }
  }

  // Route: GET /api/requests
  if (url === '/api/requests' && req.method === 'GET') {
    return sendJson(res, 200, { success: true, requests: db.requests });
  }

  // Route: POST /api/requests
  if (url === '/api/requests' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const bloodGroup = body.bloodGroup || 'O+';
      const compatibleGroups = BLOOD_COMPATIBILITY[bloodGroup] || [bloodGroup];

      const newReq = {
        id: `req-${Date.now()}`,
        bloodGroup: bloodGroup,
        hospital: body.hospital || 'Hospital Emergency Desk',
        location: body.location || 'Local Area',
        distance: body.distance || '2.8 km away',
        urgency: body.urgency || 'Emergency',
        units: parseInt(body.units, 10) || 1,
        patientCase: body.patientCase || body.notes || 'Emergency ICU patient',
        contact: body.contact || '+91 98765 43210',
        notes: body.notes || '',
        status: 'searching',
        createdAt: new Date().toISOString(),
        requesterId: body.requesterId || 'usr-requester-1',
        requesterName: body.requesterName || 'Emergency Requester',
        respondedDonor: null
      };

      db.requests.unshift(newReq);

      const requesterId = newReq.requesterId;
      const requesterDigits = (newReq.contact || '').replace(/\D/g, '');
      const matchingDonors = db.users.filter(u =>
        u.role === 'donor' &&
        u.id !== requesterId &&
        (!requesterDigits || !u.phone || u.phone.replace(/\D/g, '') !== requesterDigits) &&
        u.availability !== false &&
        compatibleGroups.includes(u.bloodGroup)
      );

      const newNotif = {
        id: `notif-${Date.now()}`,
        title: `🚨 Urgent ${bloodGroup} Blood Request`,
        message: `${newReq.hospital} urgently needs ${newReq.units} unit(s) of ${bloodGroup} blood. Compatible donors requested immediately.`,
        time: 'Just now',
        type: 'emergency',
        unread: true,
        targetRoles: ['donor'],
        targetBloodGroups: compatibleGroups,
        reqId: newReq.id,
        creatorId: requesterId
      };
      db.notifications.unshift(newNotif);
      saveDB(db);

      return sendJson(res, 201, {
        success: true,
        request: newReq,
        compatibleDonors: matchingDonors.map(d => ({
          id: d.id,
          name: d.name,
          bloodGroup: d.bloodGroup,
          city: d.city,
          distance: d.distance || '2.4 km away',
          phone: d.phone
        })),
        compatibleDonorsCount: matchingDonors.length
      });
    } catch (e) {
      return sendJson(res, 400, { success: false, message: e.message });
    }
  }

  // Route: POST /api/requests/respond
  if (url === '/api/requests/respond' && req.method === 'POST') {
    try {
      const { requestId, donorId, donorName, donorPhone, donorBlood, eta } = await parseJsonBody(req);
      const reqItem = db.requests.find(r => r.id === requestId);

      if (!reqItem) {
        return sendJson(res, 404, { success: false, message: 'Request not found' });
      }

      const donorDigits = (donorPhone || '').replace(/\D/g, '');
      const reqDigits = (reqItem.contact || '').replace(/\D/g, '');
      if (donorId === reqItem.requesterId || (donorDigits && reqDigits && donorDigits === reqDigits)) {
        return sendJson(res, 400, { success: false, message: 'You cannot donate blood to your own request' });
      }

      reqItem.status = 'responded';
      reqItem.respondedDonor = {
        id: donorId || 'usr-donor-1',
        name: donorName || 'Verified Donor',
        phone: donorPhone || '+91 98401 23456',
        blood: donorBlood || reqItem.bloodGroup,
        eta: eta || '18 mins',
        respondedAt: new Date().toISOString()
      };

      const donorUser = db.users.find(u => u.id === donorId || u.name === donorName);
      if (donorUser) {
        donorUser.rapidResponses = (donorUser.rapidResponses || 0) + 1;
      }

      db.notifications.unshift({
        id: `notif-${Date.now()}`,
        title: '❤️ Verified Donor Responded!',
        message: `${reqItem.respondedDonor.name} (${reqItem.respondedDonor.blood}) has accepted your emergency request for ${reqItem.hospital} and is en route! (ETA: ${reqItem.respondedDonor.eta})`,
        time: 'Just now',
        type: 'matches',
        unread: true,
        targetRoles: ['requester'],
        reqId: reqItem.id
      });

      saveDB(db);
      return sendJson(res, 200, { success: true, request: reqItem });
    } catch (e) {
      return sendJson(res, 400, { success: false, message: e.message });
    }
  }

  // Route: POST /api/requests/fulfill
  if (url === '/api/requests/fulfill' && req.method === 'POST') {
    try {
      const { requestId } = await parseJsonBody(req);
      const reqItem = db.requests.find(r => r.id === requestId);
      if (!reqItem) {
        return sendJson(res, 404, { success: false, message: 'Request not found' });
      }

      reqItem.status = 'completed';
      reqItem.completedAt = new Date().toISOString();

      if (reqItem.respondedDonor) {
        const donorUser = db.users.find(u => u.id === reqItem.respondedDonor.id || u.name === reqItem.respondedDonor.name);
        if (donorUser) {
          donorUser.donationsCount = (donorUser.donationsCount || 0) + 1;
          donorUser.impactLives = (donorUser.impactLives || 0) + 3;
        }
      }

      saveDB(db);
      return sendJson(res, 200, { success: true, request: reqItem });
    } catch (e) {
      return sendJson(res, 400, { success: false, message: e.message });
    }
  }

  // Route: POST /api/requests/cancel
  if (url === '/api/requests/cancel' && req.method === 'POST') {
    try {
      const { requestId } = await parseJsonBody(req);
      const reqItem = db.requests.find(r => r.id === requestId);
      if (reqItem) {
        reqItem.status = 'cancelled';
        saveDB(db);
      }
      return sendJson(res, 200, { success: true });
    } catch (e) {
      return sendJson(res, 400, { success: false, message: e.message });
    }
  }

  // Route: POST /api/donors/availability or /api/donor/availability
  if ((url === '/api/donors/availability' || url === '/api/donor/availability') && req.method === 'POST') {
    try {
      const { donorId, availability } = await parseJsonBody(req);
      const donor = db.users.find(u => u.id === donorId || u.role === 'donor');
      if (donor) {
        donor.availability = !!availability;
        saveDB(db);
      }
      return sendJson(res, 200, { success: true, availability: donor ? donor.availability : availability });
    } catch (e) {
      return sendJson(res, 400, { success: false, message: e.message });
    }
  }

  // Unknown route
  return sendJson(res, 404, { success: false, message: `Route ${url} not found` });
};
