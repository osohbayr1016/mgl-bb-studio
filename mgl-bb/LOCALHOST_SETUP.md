# Localhost Setup Guide

## Quick Start

Your localhost setup is now fixed! Follow these steps:

### 1. Reset the local database and apply all migrations

```bash
cd backend
npm run db:migrate:all:local
```

This will apply all database migrations in order and set up your admin account.

### 2. Start the backend dev server

```bash
cd backend
npm run dev
```

The backend will start on `http://127.0.0.1:3000` (watch for this exact address in the terminal).

### 3. In a new terminal, start the frontend dev server

```bash
cd frontend
npm run dev
```

The frontend will start on `http://localhost:5173` (or the next available port).

### 4. Login to the app

**URL:** `http://localhost:5173/login` or `http://127.0.0.1:5173/login`

**Credentials:**
- Username: `admin`
- Password: `admin123`

## What was fixed

1. **Cookie security issue** — The login cookie was set with `secure: true`, which requires HTTPS. On localhost (HTTP), the browser won't accept it. This is now **fixed** — the backend detects localhost and allows HTTP cookies.

2. **Database setup** — Added `npm run db:migrate:all:local` to apply all migrations at once. Your local database now has the correct schema with:
   - Users table with `username` column (not `email`)
   - Admin user: `username='admin'`, `password='admin123'`
   - All tables for projects, progress, attendance, etc.

3. **Frontend config** — Your `frontend/.env.local` is already correct with `VITE_API_HOST=http://127.0.0.1:3000`.

## Troubleshooting

**Login still fails?**
- Make sure you used the exact URLs with `127.0.0.1` (not `localhost` for backend)
- Clear browser cookies: Open DevTools → Application → Cookies → Delete the session
- Check that both servers are running and the ports match

**Database still has issues?**
- Delete `.wrangler/state/` folder to start fresh
- Run `npm run db:migrate:all:local` again

**Frontend can't connect to backend?**
- Check `frontend/.env.local` has `VITE_API_HOST=http://127.0.0.1:3000`
- Verify backend terminal shows "listening on 127.0.0.1:3000"

## Available test users

After `npm run db:migrate:all:local`, you have:
- **admin** / admin123 (full access)
- Other users added by seed migrations

## Next: Test a workflow

Once logged in, you can test any feature:
- View projects dashboard
- Check attendance system
- Test approval workflows
- etc.
