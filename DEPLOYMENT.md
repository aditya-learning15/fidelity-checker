# Deployment Guide

## Status: Ready for Frontend Deployment

**What's been completed:**
- ✅ Backend code ready (Fly.io fly.toml configured)
- ✅ Frontend production build verified
- ✅ All 3 post-deployment hardening fixes applied:
  - FIX 1: Feedback suppression threshold raised from 2 to 3 flags
  - FIX 2: Delta ceiling filters added (spacing >50px, radius >30px)
  - FIX 3: Per-frame element picker skip preference added
- ✅ vercel.json configured pointing to Fly.io backend
- ✅ .gitignore configured for all sensitive files

## Next Steps: Frontend Deployment to Vercel

### OPTION A: GitHub + Vercel Dashboard (Recommended)

#### Step 1: Prepare GitHub
```bash
cd /Users/aditya/Documents/Design\ QA/fidelity-checker

# Initialize git (already done)
# git init (already completed)

# Add all files
git add .

# Commit
git commit -m "Initial deployment: full fidelity checker implementation

- Backend: API analysis, feedback loop, element matching
- Frontend: report viewer, history, PDF export, share links
- Post-deployment fixes: suppression threshold, delta filters, picker preference

Co-Authored-By: Claude <noreply@anthropic.com>"

# Create GitHub repo (via GitHub.com)
# Then add remote and push:
git remote add origin https://github.com/YOUR_USERNAME/fidelity-checker.git
git branch -M main
git push -u origin main
```

#### Step 2: Deploy to Vercel
1. Go to https://vercel.com
2. Click "Add New Project"
3. Select your GitHub repo
4. Configure:
   - Framework: Vite
   - Root directory: `client`
   - Build command: `npm run build` (default)
   - Output directory: `dist` (default)
5. Click Deploy
6. Note the Vercel URL (e.g., https://fidelity-checker.vercel.app)

### OPTION B: Vercel CLI

```bash
cd /Users/aditya/Documents/Design\ QA/fidelity-checker/client

# Login to Vercel (first time only)
npx vercel login

# Deploy to production
npx vercel --prod

# When prompted:
#   - Link to existing project? No, create new
#   - Project name: fidelity-checker
#   - Root directory: ./
#   - Framework: Vite
#   - Build: npm run build (default)
#   - Output: dist (default)
#
# Note the Vercel URL from output
```

## After Deployment

### 1. Verify Health Check
```bash
# Backend health
curl https://fidelity-checker-api.fly.dev/api/health
# Expected: {"status":"ok"}

# Frontend loads
curl https://fidelity-checker.vercel.app | grep "Fidelity Checker"
```

### 2. Run Smoke Tests
See `SMOKE_TEST.md` for full checklist. Quick version:
```
□ Page loads
□ Analysis submission works
□ Report displays correctly
□ Share link functions
□ PDF export works
□ History page works
□ Feedback page works
□ Mobile nudge appears
□ No console errors
```

### 3. Monitor Logs

**Backend logs:**
```bash
fly logs -a fidelity-checker-api
```

**Frontend errors:**
- Vercel dashboard → Analytics → Web Vitals
- Browser console during testing

## Environment Variables

Already configured:
- **Backend (Fly.io secrets):**
  - `GEMINI_API_KEY` - Set via `fly secrets set`
  - `FIGMA_ACCESS_TOKEN` - Set via `fly secrets set`
  - `PORT=3001`
  - `NODE_ENV=production`

- **Frontend (client/.env.production):**
  - `VITE_API_BASE_URL=https://fidelity-checker-api.fly.dev`

## Deployment Checklist

```
Backend (Fly.io):
□ fly launch completed
□ GEMINI_API_KEY secret set
□ FIGMA_ACCESS_TOKEN secret set (optional)
□ fly deploy succeeded
□ Health check returns {"status":"ok"}
□ API endpoint accessible from frontend

Frontend (Vercel):
□ Repository pushed to GitHub
□ Vercel project created
□ Root directory set to: client
□ Framework: Vite
□ Build succeeds without errors
□ Production URL noted
□ vercel.json has correct Fly.io URL

Testing:
□ Smoke test checklist completed (SMOKE_TEST.md)
□ All 9 tests pass
□ No console errors
□ Share links work
□ PDF exports work
□ History persists
□ Mobile view works
```

## Rollback Plan

If issues occur:

1. **Vercel**: 
   - Vercel dashboard → Deployments → Previous working version → "Promote to Production"

2. **Fly.io**: 
   - `fly releases -a fidelity-checker-api` (list releases)
   - `fly releases rollback -a fidelity-checker-api` (rollback to previous)

## Support

For issues:
- **Frontend errors**: Check Vercel deployment logs + browser console
- **Backend errors**: `fly logs -a fidelity-checker-api`
- **API connectivity**: Verify CORS in vercel.json matches Fly.io URL
- **Feedback not appearing**: Check feedback.json is not in git (security)

## Questions for User

Before proceeding, I need:

1. **GitHub username/organization** - where should code be pushed?
   - Or: will you create the repo and push yourself?

2. **Deployment preference**:
   - Option A: I prepare code, you push to GitHub and deploy via Vercel dashboard
   - Option B: I use Vercel CLI with a token you provide

3. **Custom domain** (optional)?
   - Default: fidelity-checker.vercel.app
   - Custom: your-domain.com

Ready when you confirm these details!
