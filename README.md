# Nexus Work

Full-stack starter: React (Vite) frontend, Node.js/Express API, MongoDB.

## Structure

```
nexus-work/
  client/   React + Vite + React Router
  server/   Express + Mongoose + JWT auth
```

## Run locally

Requirements: Node 20+, MongoDB (local or Atlas).

1. Start MongoDB (e.g. `docker run -d -p 27017:27017 mongo:7`).
2. API:
   ```bash
   cd server
   cp .env.example .env     # set JWT secrets
   npm install
   npm run dev              # http://localhost:5000
   ```
3. Client:
   ```bash
   cd client
   npm install
   npm run dev              # http://localhost:5173 (proxies /api to :5000)
   ```

## API

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | /api/auth/register | no | Create account + workspace |
| POST | /api/auth/login | no | Log in, returns access token, sets refresh cookie |
| POST | /api/auth/refresh | cookie | New access token |
| POST | /api/auth/logout | no | Clears refresh cookie |
| GET | /api/auth/me | yes | Current user |
| POST | /api/auth/forgot-password | no | Always returns the same message (email sending not wired yet) |
| GET | /api/tasks?page&limit&status | yes | Paginated tasks |
| POST | /api/tasks | yes | Create task |
| PATCH | /api/tasks/:id | yes | Update task |
| DELETE | /api/tasks/:id | yes | Delete task |
| GET | /api/items?kind=doc&page&limit | yes | List items for a section (doc, dashboard, form, goal, time, message, notification, ...) |
| POST | /api/items | yes | Create item `{ kind, name, data }` |
| PATCH | /api/items/:id | yes | Update item name/data/archived |
| DELETE | /api/items/:id | yes | Delete item |
| PATCH | /api/auth/me | yes | Update name and workspace name |

The frontend sidebar sections are defined in `client/src/sections.js`. Add a section there and a matching `kind` in `server/src/models/Item.js`.

## Notes

- Access token lives in memory; the refresh token is an httpOnly cookie.
- Passwords are hashed with bcrypt. Tokens use separate secrets.
- Validation runs on the server with Zod; the client repeats it for quick feedback.
- Forgot-password does not send email yet. Add a provider (Resend, SendGrid, SES) and a reset-token model before production.

## Not verified

The code was written without running it (package installation is off in this environment). Run `npm install` in each folder and test the flow before relying on it.


> Auto-deploy: pushes to `main` are deployed to Vercel from GitHub.
