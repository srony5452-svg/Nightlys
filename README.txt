DEMO TRADE — MULTI USER
========================
This project is a simulation only. It uses virtual money and is not connected to any bank, broker, exchange, or payment system.

Run locally:
1. Install Node.js 18+
2. In this folder run: npm install
3. Set ADMIN_PASSWORD and SESSION_SECRET environment variables.
4. Run: npm start
5. Open http://localhost:3000

Admin email defaults to admin@example.com.
If ADMIN_PASSWORD is not set, the demo default is admin123. Change it before any public deployment.

For public hosting, use a server that supports Node.js and persistent SQLite storage, or replace SQLite with a managed database. Use HTTPS and a strong SESSION_SECRET.
