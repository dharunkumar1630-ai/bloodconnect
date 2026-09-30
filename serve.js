// BloodConnect - Production Server & Real-time REST API
// Zero-dependency pure Node.js backend
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'data.json');

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

// Blood compatibility mapping (who can donate to whom)
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

// Initial Seed Database
const INITIAL_DB = {
  users: [],
  requests: [],
  notifications: []
};

// Load or initialize DB
function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Error reading DB, re-initializing:', e);
  }
  saveDB(INITIAL_DB);
  return JSON.parse(JSON.stringify(INITIAL_DB));
}

function saveDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error writing DB:', e);
  }
}

// Helpers
function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(payload));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) { // 1MB limit
        req.destroy();
        reject(new Error('Request entity too large'));
      }
    });
    req.on('end', () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        resolve(parsed);
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// Active Server-Sent Events (SSE) connected clients for instant push notifications
const sseClients = new Set();

function broadcastSSE(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

const server = http.createServer(async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  const [rawUrl, queryString] = req.url.split('?');
  const db = loadDB();

  // --------------------------------------------------------------------------
  // API Routes
  // --------------------------------------------------------------------------

  // GET /api/events - Server-Sent Events stream for instant real-time emergency dispatch
  if (rawUrl === '/api/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write('retry: 2000\n\n');
    res.write(`data: ${JSON.stringify({ type: 'CONNECTED', timestamp: Date.now() })}\n\n`);
    sseClients.add(res);

    req.on('close', () => {
      sseClients.delete(res);
    });
    return;
  }

  // GET /api/data - Full state
  if (rawUrl === '/api/data' && req.method === 'GET') {
    return sendJson(res, 200, {
      success: true,
      users: db.users.map(u => ({ ...u, password: '[PROTECTED]' })),
      requests: db.requests,
      notifications: db.notifications
    });
  }

  // POST /api/auth/login
  if (rawUrl === '/api/auth/login' && req.method === 'POST') {
    try {
      const { email, password, role } = await parseJsonBody(req);
      const cleanEmail = (email || '').trim().toLowerCase();
      const cleanDigits = cleanEmail.replace(/\D/g, '');

      // Find user by email or phone
      let user = db.users.find(u => {
        const uEmail = (u.email || '').toLowerCase().trim();
        const uPhoneDigits = (u.phone || '').replace(/\D/g, '');
        const emailMatches = uEmail && uEmail === cleanEmail;
        const phoneMatches = cleanDigits && uPhoneDigits && (uPhoneDigits.includes(cleanDigits) || cleanDigits.includes(uPhoneDigits));
        return (emailMatches || phoneMatches);
      });

      if (user) {
        if (user.password && password && user.password !== password) {
          return sendJson(res, 401, { success: false, message: 'Incorrect password. Please verify and try again.' });
        }
        const safeUser = { ...user };
        delete safeUser.password;
        return sendJson(res, 200, { success: true, user: safeUser });
      }

      return sendJson(res, 401, { success: false, message: 'Account not found. Please sign up to register your account.' });
    } catch (e) {
      return sendJson(res, 400, { success: false, message: e.message });
    }
  }

  // POST /api/auth/delete-account - Permanently delete an account
  if (rawUrl === '/api/auth/delete-account' && req.method === 'POST') {
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

  // POST /api/auth/clear-all-accounts - Wipe all accounts and database
  if (rawUrl === '/api/auth/clear-all-accounts' && req.method === 'POST') {
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

  // POST /api/auth/register
  if (rawUrl === '/api/auth/register' && req.method === 'POST') {
    try {
      const data = await parseJsonBody(req);
      const newUser = {
        id: `usr-${Date.now()}`,
        name: data.name || 'Anonymous User',
        age: data.age ? parseInt(data.age, 10) : 25,
        email: (data.email || `user${Date.now()}@bloodconnect.org`).toLowerCase(),
        phone: data.phone || '+91 90000 00000',
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

  // GET /api/requests
  if (rawUrl === '/api/requests' && req.method === 'GET') {
    return sendJson(res, 200, { success: true, requests: db.requests });
  }

  // POST /api/requests - Create new blood request
  if (rawUrl === '/api/requests' && req.method === 'POST') {
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

      // Add request to top of list
      db.requests.unshift(newReq);

      // Find compatible donors in database (EXCLUDING the requester themselves!)
      const requesterId = newReq.requesterId;
      const requesterDigits = (newReq.contact || '').replace(/\D/g, '');
      const matchingDonors = db.users.filter(u => 
        u.role === 'donor' && 
        u.id !== requesterId &&
        (!requesterDigits || !u.phone || u.phone.replace(/\D/g, '') !== requesterDigits) &&
        u.availability !== false &&
        compatibleGroups.includes(u.bloodGroup)
      );

      // Create high-priority notification for other donors
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

      // Instant push broadcast to all connected donors via SSE
      broadcastSSE({
        type: 'NEW_EMERGENCY_REQUEST',
        request: newReq,
        notification: newNotif,
        compatibleDonorsCount: matchingDonors.length
      });

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

  // POST /api/requests/respond - Donor responds "I CAN HELP"
  if (rawUrl === '/api/requests/respond' && req.method === 'POST') {
    try {
      const { requestId, donorId, donorName, donorPhone, donorBlood, eta } = await parseJsonBody(req);
      const reqItem = db.requests.find(r => r.id === requestId);

      if (!reqItem) {
        return sendJson(res, 404, { success: false, message: 'Request not found' });
      }

      // User cannot donate blood to their own emergency request
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

      // Update donor's stats if in DB
      const donorUser = db.users.find(u => u.id === donorId || u.name === donorName);
      if (donorUser) {
        donorUser.rapidResponses = (donorUser.rapidResponses || 0) + 1;
      }

      // Add notification for the requester
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

      // Instant push broadcast to requester and other clients via SSE
      broadcastSSE({
        type: 'DONOR_RESPONDED',
        request: reqItem
      });

      return sendJson(res, 200, { success: true, request: reqItem });
    } catch (e) {
      return sendJson(res, 400, { success: false, message: e.message });
    }
  }

  // POST /api/requests/fulfill - Mark blood received
  if (rawUrl === '/api/requests/fulfill' && req.method === 'POST') {
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

      broadcastSSE({
        type: 'REQUEST_FULFILLED',
        request: reqItem
      });

      return sendJson(res, 200, { success: true, request: reqItem });
    } catch (e) {
      return sendJson(res, 400, { success: false, message: e.message });
    }
  }

  // POST /api/requests/cancel
  if (rawUrl === '/api/requests/cancel' && req.method === 'POST') {
    try {
      const { requestId } = await parseJsonBody(req);
      const reqItem = db.requests.find(r => r.id === requestId);
      if (reqItem) {
        reqItem.status = 'cancelled';
        saveDB(db);

        broadcastSSE({
          type: 'REQUEST_CANCELLED',
          requestId: requestId
        });
      }
      return sendJson(res, 200, { success: true });
    } catch (e) {
      return sendJson(res, 400, { success: false, message: e.message });
    }
  }

  // POST /api/donors/availability
  if (rawUrl === '/api/donors/availability' && req.method === 'POST') {
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

  // --------------------------------------------------------------------------
  // Static File Serving
  // --------------------------------------------------------------------------
  let filePath = path.join(__dirname, rawUrl === '/' ? 'index.html' : rawUrl);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500);
        res.end('Server Error: ' + err.code);
      }
    } else {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, () => {
  console.log(`BloodConnect production server running at http://localhost:${PORT}/`);
});
