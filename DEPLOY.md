# GradLaunch — Deployment Guide
## From zero to live URL in 15 minutes

---

## WHAT YOU HAVE
Four files in your gradlaunch folder:
```
gradlaunch/
├── index.html          ← The complete app (frontend)
├── api/
│   └── analyze.js      ← The AI engine (serverless function)
├── vercel.json         ← Vercel configuration
└── package.json        ← Node.js config
```

---

## STEP 1 — Get your Anthropic API key (5 min)

1. Go to **console.anthropic.com**
2. Click **Sign Up** — use your email
3. Once logged in, click **"API Keys"** in the left sidebar
4. Click **"Create Key"**
5. Give it a name: "gradlaunch"
6. Copy the key — it starts with **sk-ant-...**
7. ⚠️ SAVE IT SOMEWHERE — you only see it once

**Note:** You start with $5 free credit. No credit card needed to start.

---

## STEP 2 — Create a GitHub account (2 min)

1. Go to **github.com**
2. Click **Sign Up**
3. Enter your email, create a password, choose a username
4. Verify your email

---

## STEP 3 — Upload your code to GitHub (3 min)

1. Once logged into GitHub, click the **"+"** button (top right)
2. Click **"New repository"**
3. Repository name: **gradlaunch**
4. Keep it **Public**
5. Click **"Create repository"**
6. On the next page, click **"uploading an existing file"**
7. You need to upload files in the right structure:
   - Upload **index.html** — drag and drop it
   - Click **"Commit changes"**
8. Now click **"Create new file"**
9. In the filename box type: **api/analyze.js**
   (typing the slash creates the folder automatically)
10. Open your analyze.js file in any text editor (Notepad, TextEdit)
11. Select all, copy, paste into the GitHub editor
12. Click **"Commit new file"**
13. Repeat step 8–12 for **vercel.json** and **package.json**
    (these go in the root, not in api/)

Your repo should look like:
```
gradlaunch/
├── index.html
├── vercel.json
├── package.json
└── api/
    └── analyze.js
```

---

## STEP 4 — Create a Vercel account (2 min)

1. Go to **vercel.com**
2. Click **"Sign Up"**
3. Click **"Continue with GitHub"** — this connects your accounts automatically

---

## STEP 5 — Deploy to Vercel (3 min)

1. Once logged into Vercel, click **"Add New Project"**
2. You'll see your GitHub repos — click **"Import"** next to **gradlaunch**
3. Leave all settings as default
4. Click **"Deploy"**
5. Wait 60 seconds — Vercel builds your app
6. You'll see a **"Congratulations"** screen with a URL like:
   **gradlaunch-abc123.vercel.app**

---

## STEP 6 — Add your API key (2 min)

⚠️ The app won't work until you do this step.

1. In your Vercel project dashboard, click **"Settings"** (top menu)
2. Click **"Environment Variables"** (left sidebar)
3. Click **"Add New"**
4. In the **Name** field type exactly: **ANTHROPIC_API_KEY**
5. In the **Value** field paste your key: **sk-ant-...**
6. Click **"Save"**
7. Go back to your project overview
8. Click **"Deployments"** → click the three dots next to your deployment → click **"Redeploy"**
9. Wait 30 seconds

---

## STEP 7 — Test your app

1. Click your live URL (gradlaunch-abc123.vercel.app)
2. Paste a resume (use your own or any sample)
3. Type a target role: **Data Analyst**
4. Click **Launch my career analysis**
5. Wait 20–30 seconds for the analysis
6. You should see your full results

If it works — you're live! 🎉

---

## STEP 8 — Get a custom domain name (optional, free)

Your default URL is gradlaunch-abc123.vercel.app — functional but not memorable.

**Option A — Custom Vercel subdomain (free, instant):**
1. In Vercel → Settings → Domains
2. Click "Edit" on your default domain
3. Change it to: **gradlaunch.vercel.app**
   (if that's taken try: gradlaunch-app.vercel.app or mygrad-launch.vercel.app)

**Option B — Buy a real domain ($10–15/year):**
1. Go to **namecheap.com** or **porkbun.com**
2. Search for: gradlaunch.com or gradlaunch.io
3. Buy it (~$10/year)
4. In Vercel → Settings → Domains → Add
5. Type your domain name
6. Vercel gives you DNS instructions — follow them in Namecheap/Porkbun
7. Takes 5–30 minutes to go live

---

## STEP 9 — Post on LinkedIn

Once you have your URL, post something like:

---
*"I built a free career roadmap tool for new grads — upload your resume, get a match score, action plan, and certifications personalized to your target role.*

*No sign-up. No cost. Takes 60 seconds.*

*Try it: [your-url]*

*\#GradLaunch \#NewGrads \#CareerAdvice \#OpenToWork"*

---

---

## TROUBLESHOOTING

**"API key not configured" error:**
→ You forgot Step 6, or you need to redeploy after adding the key

**Analysis fails / no results:**
→ Check your API key is correct in Vercel env vars
→ Make sure you pasted the full key including "sk-ant-..."

**"Too many requests" error:**
→ The app allows 3 analyses per IP per hour — this is intentional to protect your credits

**Resume not being read:**
→ For PDF/DOCX files, the app works best when you paste the text directly
→ Use the "Paste text" tab for most reliable results
→ For PDF: open in browser → Ctrl+A → Ctrl+C → paste

**App loads but looks broken:**
→ Hard refresh: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)

---

## MONITORING YOUR USAGE

**Check API costs:**
1. Go to console.anthropic.com
2. Click "Usage" in the left sidebar
3. You'll see total tokens used and estimated cost

**Typical cost:** ~$0.001 per analysis
**$5 free credit covers:** ~5,000 analyses

You won't need to add payment details for a very long time with typical traffic.

---

## UPDATING THE APP

When you want to make changes later:
1. Edit the files on your computer
2. Go to your GitHub repo
3. Click the file you want to update
4. Click the pencil ✏️ icon to edit
5. Paste your new content
6. Click "Commit changes"
7. Vercel automatically redeploys in ~30 seconds

---

## FILE SUMMARY

| File | Purpose |
|------|---------|
| index.html | Complete frontend app — all pages, styling, and browser logic |
| api/analyze.js | Serverless function — calls Claude AI, returns analysis JSON |
| vercel.json | Tells Vercel how to route requests |
| package.json | Node.js version configuration |

---

## NEED HELP?

- Vercel docs: vercel.com/docs
- Anthropic API docs: docs.anthropic.com
- GitHub help: docs.github.com

Good luck — let's go! 🚀
