# Setup and run checklist

Run these in order. Each step says how to confirm it worked.

## 1. Environment
- [ ] Node.js 18 or newer installed (`node -v`)
- [ ] npm can reach the registry (`npm view express version` prints a version)

## 2. Install
- [ ] `cd server && npm install`
- [ ] `cd client && npm install`

## 3. Configuration (`server/.env`)
- [ ] Copy `server/.env.example` to `server/.env`
- [ ] `MONGODB_URI` set (local `mongodb://127.0.0.1:27017/nexus` or Atlas string)
- [ ] `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` set to two different random strings
- [ ] `CLIENT_ORIGIN=http://localhost:5173`
- [ ] Optional: `SMTP_URL` for real email (without it, invite and reset links print to the server console)

## 4. Database
- [ ] MongoDB is running and reachable at the host and port in `MONGODB_URI`

## 5. Preflight
- [ ] `cd server && npm run preflight` prints no FAIL lines

## 6. Run
- [ ] Terminal 1: `cd server && npm run dev` shows `API running on http://localhost:5000`
- [ ] Terminal 2: `cd client && npm run dev` shows a local URL (http://localhost:5173)
- [ ] Open http://localhost:5173 and register an account

## 7. End-to-end test
- [ ] `cd server && npm run test:e2e` reports "All checks passed"
- [ ] For the invite checks, copy the invite token from the server console and run `INVITE_TOKEN=<token> npm run test:e2e`

## 8. Manual checks
- [ ] Log out and log back in
- [ ] Turn on 2FA in Settings, scan the QR code, then log in with a code
- [ ] Request a password reset, open the link from the console, set a new password
- [ ] Create a doc and a whiteboard and reload the page to confirm they saved
- [ ] Invite a member, accept on a second account, and change their role
