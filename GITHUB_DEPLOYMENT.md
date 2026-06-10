# GitHub & Vercel Deployment Steps

Your code is committed and ready. Follow these steps to deploy.

## Step 1: Create GitHub Repository

1. Go to https://github.com/new
2. Fill in:
   - **Repository name**: `fidelity-checker`
   - **Description**: "AI-powered design fidelity checker - compares Figma designs against shipped implementations"
   - **Public** (to allow Vercel to access)
   - ✓ Add a README (optional - we have one)
   - ✗ Add .gitignore (we have one)
   - ✗ Choose a license (optional)
3. Click **Create repository**
4. You'll see: "Quick setup — if you've done this kind of thing before"

## Step 2: Push Code to GitHub

Copy and paste these commands (your repo is already initialized and committed):

```bash
cd /Users/aditya/Documents/Design\ QA/fidelity-checker

# Add GitHub as remote (replace aditya-learning15 with your username if different)
git remote add origin https://github.com/aditya-learning15/fidelity-checker.git

# Rename branch to main (if needed)
git branch -M main

# Push to GitHub
git push -u origin main
```

### Verification:
After running above commands, go to:
```
https://github.com/aditya-learning15/fidelity-checker
```

You should see:
- ✓ All 70 files committed
- ✓ Commit message with full description
- ✓ `.gitignore` configured
- ✓ `README.md`, `DEPLOYMENT.md`, `SMOKE_TEST.md` visible

---

## Step 3: Deploy to Vercel via Dashboard

1. Go to https://vercel.com
2. Click **Add New Project**
3. Click **Import Git Repository**
4. Authorize GitHub (if prompted)
5. Search for and select: `fidelity-checker`
6. Click **Import**

### Configure Project:

**Framework Preset**
- Select: **Vite**

**Root Directory**
- Change to: `client` (critical!)
- This tells Vercel to build the `client/` folder only

**Build Settings** (should auto-detect)
- Build Command: `npm run build` ✓
- Output Directory: `dist` ✓
- Install Command: `npm install` ✓

**Environment Variables** (optional, but recommended)
- Add: `VITE_API_BASE_URL` = `https://fidelity-checker-api.fly.dev`
  - (Or wait until after Fly.io backend is deployed)

7. Click **Deploy**

### Deployment Progress:

Vercel will:
1. Clone your repo
2. Navigate to `client/`
3. Run `npm install`
4. Run `npm run build`
5. Deploy to CDN
6. Show you the URL: `https://fidelity-checker.vercel.app` (or custom domain)

**Note**: First deploy takes 2-3 minutes. Subsequent deploys are faster.

---

## Step 4: Verify Vercel URL

Once deployment completes:

```bash
# Test homepage loads
curl https://fidelity-checker.vercel.app | grep "title" | head -1
# Expected: <title>Fidelity Checker</title>

# Check for any obvious errors
# Open in browser: https://fidelity-checker.vercel.app
```

---

## Step 5: Backend Health Check (After Fly.io Deploy)

Once you've deployed backend to Fly.io:

```bash
# Verify backend is running
curl https://fidelity-checker-api.fly.dev/api/health

# Expected response:
# {"status":"ok"}
```

---

## Deployment Checklist

### GitHub
- [ ] Repository created at github.com/aditya-learning15/fidelity-checker
- [ ] Code pushed (70 files visible)
- [ ] All branches show (main)

### Vercel
- [ ] Project created and linked to GitHub
- [ ] Root directory set to: `client`
- [ ] Build succeeded (check "Deployments" tab)
- [ ] URL accessible: https://fidelity-checker.vercel.app
- [ ] No build errors in logs

### Backend (after Fly.io deploy)
- [ ] fly deploy completed
- [ ] GEMINI_API_KEY secret set
- [ ] Health check returns {"status":"ok"}

---

## Troubleshooting

### "Build failed" in Vercel
**Check**:
1. Root directory is set to `client` (not project root)
2. Build command is `npm run build`
3. Output directory is `dist`

**View logs**: Vercel Dashboard → Deployments → (latest) → "Logs"

### API not responding
**Check**:
1. vercel.json has correct Fly.io URL
2. Backend is running: `curl https://fidelity-checker-api.fly.dev/api/health`
3. Browser console shows CORS errors (if any)

### Push to GitHub fails
**Try**:
```bash
# Verify remote
git remote -v

# Should show:
# origin  https://github.com/aditya-learning15/fidelity-checker.git (fetch)
# origin  https://github.com/aditya-learning15/fidelity-checker.git (push)

# If wrong, remove and re-add:
git remote remove origin
git remote add origin https://github.com/aditya-learning15/fidelity-checker.git
git push -u origin main
```

---

## After Deployment Complete

Once both are live:
1. Run smoke test checklist (SMOKE_TEST.md)
2. Share URLs:
   - Frontend: https://fidelity-checker.vercel.app
   - Backend: https://fidelity-checker-api.fly.dev
3. Report: All 9 smoke tests pass? Any console errors?

---

## Ready? Run these commands now:

```bash
cd /Users/aditya/Documents/Design\ QA/fidelity-checker

git remote add origin https://github.com/aditya-learning15/fidelity-checker.git
git branch -M main
git push -u origin main
```

Then return with:
1. ✓ GitHub repo created and code pushed
2. ✓ Vercel dashboard URL where you deployed
3. ✓ Any errors during deployment

I'll wait for backend URL from your Fly.io deploy, then we'll run smoke tests.
