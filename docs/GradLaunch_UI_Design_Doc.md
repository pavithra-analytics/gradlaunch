---
title: GradLaunch --- UI Design Document (Claude Code)
---

Use the Execution Doc for logic and constraints.

Use the UI Design Doc for layout, UX, and component behavior.

Follow both strictly.

# . World-class UI design rules

-   **Design objective:** The website should feel premium, calm,
    trustworthy, and outcome-driven --- not like a generic AI wrapper.

-   **Use the installed skills intentionally:** \`frontend-design\`
    should drive hierarchy and UX; \`react-expert\` should drive clean
    reusable components; \`nextjs-developer\` should drive
    implementation patterns; \`architecture-designer\` should guide
    page/state structure; \`vercel-react-best-practices\` should guide
    performance-conscious UI decisions.

-   **Left navigation panel:** Use a persistent left panel on desktop
    and a collapsible pattern on smaller screens.

-   **Do not rely on one giant scroll:** Each tab should feel focused
    and navigable.

-   **Improve density without clutter:** Better card design, spacing,
    typography, section grouping, and alignment.

-   **Avoid AI-look UI patterns:** No giant walls of text, no weak empty
    states, no overdone gradients, no noisy dashboards, and no generic
    placeholder copy.

-   **Trust design:** Make numbers understandable. Visually distinguish
    between computed insights and generated content when useful.

-   **Long-content handling:** Use section anchors, sticky
    sub-navigation, collapsible subsections, or section filters where
    appropriate for long resumes and dense diagnosis content.

-   **Action-first interactions:** Buttons and controls should help the
    user act on advice, not just read it.

-   SECTION --- STATE & DATA DISPLAY RULES

-   

-   \- Loading states must be explicit (skeletons, not blank screens)

-   \- Empty states must guide user action (never blank)

-   \- Error states must be visible and actionable

-   

-   For AI-generated vs computed:

-   \- Computed values → visually stable (badges, fixed layout)

-   \- AI-generated content → editable areas (text blocks)

-   Do NOT mix computed and generated outputs without distinction

-   SECTION --- INTERACTION RULES

-   

-   \- Every insight must have an action:

-   (Apply / Edit / Generate / Expand)

-   

-   \- Buttons must map to clear outcomes:

-   \- Apply → updates resume

-   \- Rewrite → generates alternative

-   \- Expand → shows deeper detail

-   

-   \- No dead UI:

-   Every visible suggestion must be actionable

-   

-   \- Avoid multi-step hidden flows

    → actions must be visible inline

-   SECTION --- SCROLL & DENSITY CONTROL

-   

-   \- Avoid infinite scroll blocks

-   \- Use:

-   \- collapsible sections

-   \- sticky headers

-   \- section anchors

-   

-   \- Resume Fix:

-   \- split view must maintain independent scroll

-   

-   \- Diagnosis:

-   \- allow jump-to-section navigation

-   

-   Goal:

-   \- high information density

    \- low cognitive load

-   SECTION --- EDITING EXPERIENCE RULES

-   

-   \- Editing must feel real-time and controllable

-   

-   \- When user clicks \"Adopt\":

-   → change must reflect immediately in editable resume

-   

-   \- When user clicks \"Rewrite\":

-   → show alternative, not overwrite automatically

-   

-   \- Always allow undo or reversal

-   \- Do NOT auto-apply changes without user action

-   SECTION --- PERFORMANCE UX RULES

-   

-   \- Show partial results early (progressive rendering)

-   \- Do not block entire page for one slow component

-   \- Lazy-load heavy sections (Projects, LinkedIn, etc.)

-   

-   \- JD mode:

    → show loading state per section, not whole page freeze

PURPOSE

This document defines ALL UI/UX, layout, and design behavior for
GradLaunch.

It must be used together with the Execution Doc.

Claude MUST follow this document for:

\- layout

\- component structure

\- interaction design

\- visual hierarchy

Claude MUST NOT invent UI patterns outside this document.

\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\--

SECTION 1 --- SKILLS USAGE (CRITICAL)

Claude MUST use these installed skills explicitly:

\- frontend-design → layout, spacing, hierarchy, UX clarity

\- react-expert → component structure, reusable UI patterns

\- nextjs-developer → routing, page structure, performance patterns

\- architecture-designer → page-level structure and state flow

\- vercel-react-best-practices → performance, rendering, optimization

RULE:

\- Do NOT ignore these skills

\- Do NOT default to generic UI patterns

\- Always justify UI decisions using these skills

\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\--

SECTION 2 --- DESIGN OBJECTIVE

The UI must feel:

\- premium

\- calm

\- trustworthy

\- outcome-driven

The UI must NOT feel:

\- like a generic AI tool

\- cluttered

\- overly flashy

\- text-heavy without structure

\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\--

SECTION 3 --- LAYOUT STRUCTURE

GLOBAL LAYOUT:

Left Sidebar + Main Content

Sidebar:

\- persistent on desktop

\- collapsible on smaller screens

Main Content:

\- section-based layout

\- avoid long continuous scroll

\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\--

SECTION 4 --- SIDEBAR DESIGN

Tabs:

\- Diagnosis

\- Resume Fix

\- Projects

\- Finalize

Behavior:

\- highlight active tab

\- allow quick switching

\- show subtle progress indicator

Do NOT:

\- add extra tabs

\- reorder tabs

\- hide tabs dynamically

\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\--

SECTION 5 --- PAGE STRUCTURE RULES

Each page must:

\- have clear section grouping

\- use cards for separation

\- avoid large text blocks

Use:

\- headers

\- subheaders

\- spacing

\- visual grouping

\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\--

SECTION 6 --- DIAGNOSIS PAGE UI

Keep ALL existing content.

Improve:

\- grouping into sections

\- card layout

\- readability

Add:

\- internal anchors (Skills, LinkedIn, Certs, Projects)

Do NOT:

\- remove content

\- collapse sections

\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\--

SECTION 7 --- RESUME FIX PAGE UI

Use split layout:

Left:

\- original resume

Right:

\- improved/editable resume

Features:

\- highlight changes

\- adopt/rewrite buttons

\- clear comparison

Handle long resumes:

\- section navigation

\- controlled scrolling

\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\--

SECTION 8 --- PROJECTS PAGE UI

Display projects as cards.

Each card must show:

\- project title

\- why it matters

\- key outcomes

Expandable:

\- plan

\- implementation

\- resume bullet

Keep prompt generator visible.

\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\--

SECTION 9 --- FINALIZE PAGE UI

Sections:

1\. Cover Letter

\- generate

\- edit

\- download

2\. Final Audit

\- before vs after

\- readiness status

\- remaining gaps

Design:

\- clean, focused

\- completion-oriented

\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\--

SECTION 10 --- COMPONENT RULES

Cards:

\- consistent padding

\- clear hierarchy

Buttons:

\- primary = action (generate, apply)

\- secondary = edit

Typography:

\- strong headings

\- readable body

Spacing:

\- generous but structured

\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\--

SECTION 11 --- TRUST DESIGN

\- clearly separate computed vs generated content

\- avoid misleading visuals

\- no fake metrics emphasis

\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\--

SECTION 12 --- PERFORMANCE UI RULES

\- lazy load heavy sections

\- avoid re-rendering entire pages

\- keep interactions responsive

\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\--

SECTION 13 --- WHAT NOT TO DO

\- do NOT redesign layout beyond this doc

\- do NOT remove content

\- do NOT simplify UI too much

\- do NOT add unnecessary animations

\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\--

END OF UI DOCUMENT
