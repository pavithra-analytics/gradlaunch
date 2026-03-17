# GradLaunch — AI-Powered Career Roadmap Tool

> Upload your resume → get a personalized US job market roadmap in under 20 seconds.
> Free. No sign-up. Your data never leaves your browser.

🔗 **Live app:** [gradlaunch-weld.vercel.app](https://gradlaunch-weld.vercel.app)

---

## What It Does

GradLaunch analyzes your resume against real-time job market data and generates a fully personalized career roadmap. Built for international students, new grads, and professionals navigating the US job market with full visa-awareness for F-1 OPT, STEM OPT, and H-1B holders.

### Four tabs of output:

| Tab | What you get |
|---|---|
| **Your Profile** | Match score, skill gaps with priority ranking, trending skills, top companies hiring right now |
| **Your Roadmap** | Week-by-week 30-day action plan with specific steps and URLs. Certifications ranked by gap relevance. |
| **Your Market** | BLS-verified salary ranges by experience level. Live H-1B sponsor data for visa users. |
| **Resources** | ATS-optimized resume bullets. LinkedIn headline generated from your resume. Visa timeline with deadlines. Interview prep links. |

---

## Why It's Different From a Chatbot

A chatbot gives the same generic answer to everyone. GradLaunch:

- Reads **your specific resume** using PDF.js and Mammoth.js in the browser
- Pulls **live job market data** via Tavily web search — not training data, not cached
- Uses **US government verified salary data** from BLS.gov
- Adapts **every output** to your target role, location, and visa status

**Cost per full analysis: ~$0.01**

---

## Tech Stack

```
Frontend:       Vanilla HTML/CSS/JS — single file, no framework
Resume parsing: PDF.js (PDF) + Mammoth.js (DOCX) — fully client-side
AI analysis:    Claude Haiku (Anthropic) — structured JSON via prompt engineering
Live search:    Tavily API — real-time hiring signals and company data
Salary data:    Bureau of Labor Statistics (BLS.gov) — hardcoded lookup table
Visa data:      USCIS H-1B filings — hardcoded sponsor guidance
Deployment:     Vercel serverless functions
```

---

## Architecture

```
User uploads resume
       ↓
Browser parses file (PDF.js / Mammoth.js)
Text extracted client-side — never sent to a database
       ↓
POST /api/analyze
       ↓
Tavily search (cached 24hr in-memory)
"Companies hiring [role] in [location] right now"
       ↓
Claude Haiku analyzes resume + live data
Returns structured JSON (match score, gaps, plan, sponsors, etc.)
       ↓
normalize() fills any missing fields with hardcoded defaults
Salary injected from BLS lookup table
Certifications matched from internal DB
OPT/H-1B timeline hardcoded by visa type
       ↓
Frontend renders 4 tabs
```

### Key engineering decisions:

**LLM generates reasoning only** — not salary, not cert details, not OPT steps. These are hardcoded from authoritative sources and injected after the LLM call. This reduces output tokens by ~60%, cuts cost to ~$0.01, and prevents hallucination on factual data.

**Prefill `{` approach** — the assistant message is pre-filled with `{` forcing Haiku to return valid JSON continuation. Combined with a 3-layer repair function that handles trailing commas, truncation, and markdown fences.

**In-memory web search cache** — Tavily results cached by `role|location|visa` key with 24hr TTL. Repeat queries skip the search call entirely, saving ~2 seconds and reducing API costs.

**Client-side resume parsing** — PDF.js and Mammoth.js run entirely in the browser. The resume text is extracted before it ever leaves the user's device. No resume data is stored anywhere.

---

## File Structure

```
gradlaunch/
├── index.html          # Complete frontend — single file, all CSS/JS inline
├── api/
│   └── analyze.js      # Serverless function — Tavily + Claude Haiku
├── vercel.json         # { "version": 2 }
└── package.json        # { "node": "20.x" }
```

---

## Environment Variables

Set in Vercel dashboard (Settings → Environment Variables):

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key from console.anthropic.com |
| `TAVILY_API_KEY` | Tavily API key from app.tavily.com (free tier: 1,000/month) |

---

## Running Locally

```bash
# Install Vercel CLI
npm install -g vercel

# Clone and run
git clone https://github.com/your-username/gradlaunch.git
cd gradlaunch
vercel dev
```

Add a `.env` file at the root:
```
ANTHROPIC_API_KEY=sk-ant-...
TAVILY_API_KEY=tvly-...
```

---

## Cost Breakdown

| Component | Cost |
|---|---|
| Tavily search | $0.000 (free tier: 1,000/month) |
| Claude Haiku input (~1,700 tokens) | ~$0.0014 |
| Claude Haiku output (~2,000 tokens) | ~$0.0080 |
| **Total per analysis** | **~$0.01** |

---

## Supported Resume Formats

| Format | How |
|---|---|
| PDF | PDF.js — text-based PDFs only (not scanned) |
| DOCX | Mammoth.js — full text extraction |
| TXT | Native FileReader API |

Files are validated for minimum 200 meaningful characters before submission. Unsupported formats (.doc, images) are rejected with a clear error message.

---

## Visa Support

| Status | What you get |
|---|---|
| F-1 OPT | H-1B sponsor companies, OPT timeline with deadlines |
| STEM OPT | STEM extension steps, E-Verify guidance |
| H-1B | PERM green card timeline, renewal guidance |
| Permanent Resident / Citizen | Standard analysis, no visa sections |

---

## What's Next

- [ ] Job description match score (paste any JD for exact requirement breakdown)
- [ ] More cities and international markets
- [ ] Vercel KV for persistent cross-instance search cache
- [ ] User feedback collection

---

## Feedback

Built this to solve a real problem. If you use it — open an issue or reach out directly. What worked, what was wrong, what's missing.

---

## License

MIT
