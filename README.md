# 🩸 BloodConnect — Instant Blood Emergency Network

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-crimson.svg?style=for-the-badge)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-Zero-blue.svg?style=for-the-badge)](package.json)

**BloodConnect** is a real-time emergency blood donation and donor-matching platform designed to bridge the gap between critical blood requirements in hospitals and willing volunteer donors nearby.

---

## 🌟 Key Features

- 🚨 **Emergency Blood Broadcast**: Quickly submit urgent blood requests specifying blood group, units, hospital name, location, and urgency status.
- 🩸 **Automated Blood Compatibility Matching**: Built-in matrix calculating universal donors (`O-`), universal recipients (`AB+`), and cross-type compatibility (`A+`, `A-`, `B+`, `B-`, `AB-`).
- ⚡ **Real-time Live Sync (SSE)**: Uses Server-Sent Events (SSE) to push instant notifications to donors and requesters without manual page refreshes.
- 👤 **Role-based Authentication**:
  - **Donors**: Track donation stats, manage live availability toggle, receive emergency broadcasts, and respond with ETA.
  - **Requesters / Hospitals**: Create emergency broadcasts, monitor responses, and connect directly with responding donors.
- 🔍 **Interactive Donor Directory**: Filter and search verified donors by city, blood type, and availability.
- 🚀 **Zero External Dependencies**: Pure native Node.js backend using standard `http`, `fs`, and `path` modules with zero npm package overhead.

---

## 🛠️ Tech Stack

- **Frontend**: HTML5, Modern Vanilla CSS (CSS variables, glassmorphism, responsive grid & flexbox), Vanilla JavaScript (ES6+).
- **Backend**: Pure Node.js HTTP server (`serve.js`), REST API, Server-Sent Events (`/api/stream`).
- **Database**: Local JSON persistence (`data.json`) with safe atomic disk writes.

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18.0.0 or later)

### Installation & Running Locally

1. **Clone the repository:**
   ```bash
   git clone https://github.com/dharunkumar1630-ai/bloodconnect.git
   cd bloodconnect
   ```

2. **Start the server:**
   ```bash
   npm start
   ```
   *Alternatively, run directly with Node:*
   ```bash
   node serve.js
   ```

3. **Open the web application:**
   Open your browser and navigate to:
   ```
   http://localhost:3000
   ```

---

## ☁️ Deploy to Vercel

This project is fully configured for zero-configuration 1-click deployment on **Vercel** with integrated serverless functions (`api/index.js`) and static frontend asset delivery (`vercel.json`).

### Deploy via Vercel Dashboard:
1. Go to [vercel.com/new](https://vercel.com/new).
2. Select and import the repository `dharunkumar1630-ai/bloodconnect`.
3. Keep default settings (Framework Preset: **Other**, Root Directory: `./`).
4. Click **Deploy**.

### Deploy via Vercel CLI:
```bash
npm i -g vercel
vercel
```

---

## 📡 API Overview

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/status` | Health check and server statistics |
| `GET` | `/api/donors` | Retrieve list of verified donors |
| `GET` | `/api/requests` | List current blood requests & status |
| `POST` | `/api/requests` | Broadcast a new emergency blood request |
| `POST` | `/api/requests/:id/respond`| Donor response with estimated arrival time (ETA) |
| `POST` | `/api/auth/register` | Register a new donor or requester account |
| `POST` | `/api/auth/login` | Authenticate user |
| `POST` | `/api/donor/availability` | Toggle donor's active availability |
| `GET` | `/api/stream` | Server-Sent Events (SSE) live push stream |

---

## 🤝 Blood Compatibility Reference

| Recipient Type | Compatible Donor Blood Groups |
| :--- | :--- |
| **O-** | O- |
| **O+** | O+, O- |
| **A-** | A-, O- |
| **A+** | A+, A-, O+, O- |
| **B-** | B-, O- |
| **B+** | B+, B-, O+, O- |
| **AB-**| AB-, A-, B-, O- |
| **AB+**| *Universal Recipient* (All blood groups) |

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
