**GradLaunch**

*Final Build Brief for Claude Code*

  -----------------------------------------------------------------------
  **Primary goal\         **Non-negotiables\      **Approved UI change\
  **Help students get     **Do not reduce current **Add a left navigation
  interview-ready by      functionality, do not   panel and a new
  improving resume        reduce number of        Finalize tab. Move the
  quality, ATS readiness, displayed skills or     card below the resume
  projects, LinkedIn, and project suggestions,    section into Finalize,
  application assets      and do not move         alongside cover letter
  inside one product.     existing diagnosis      generation.
                          content across tabs     
                          except the final audit  
                          card.                   
  ----------------------- ----------------------- -----------------------

  -----------------------------------------------------------------------

# 1. How Claude should work on this project

-   **Use these installed skills:** \`frontend-design\`,
    \`react-expert\`, \`nextjs-developer\`, \`architecture-designer\`,
    \`vercel-react-best-practices\`. Use them intentionally in both
    design and implementation decisions.

-   **Do not do everything in one pass:** Work phase by phase. Each
    phase should be small enough to complete, review, and stabilize
    before the next phase.

-   **Do not redesign the product from scratch:** Keep the current
    product model and tabs. Improve quality, speed, trust, and polish.

-   **Priority order:** correctness → trustworthiness of numbers → speed
    → maintainability → visual quality.

# 2. Locked product structure

This section is the source of truth for UI structure. Claude must not
invent a different flow.

-   **Current structure to preserve:** Diagnosis, Resume Fix, Projects,
    and the existing final audit area.

-   **New structure to implement:** Add a persistent left panel for
    navigation and add a new Finalize tab.

-   **Only approved structural movement:** Move the final card currently
    shown below the resume section into the new Finalize tab.

-   **Do not move LinkedIn out of Diagnosis:** LinkedIn remains in the
    Diagnosis tab because that is how the current product is structured.

-   **Do not reduce Diagnosis content:** Keep the current sections in
    Diagnosis. Improve clarity and grouping, but do not remove content.

-   **Do not collapse Projects into another tab:** Projects remains a
    standalone tab and remains a key feature.

-   **Do not reduce the number of skills shown or project suggestions
    shown:** Improve quality and ranking without shrinking scope.

## Final sidebar structure

  -----------------------------------------------------------------------
  Tab                                 Contents
  ----------------------------------- -----------------------------------
  Diagnosis                           Existing diagnosis experience,
                                      including ATS / match analysis,
                                      skills, gaps, fixes,
                                      certifications, LinkedIn content,
                                      and other current diagnosis
                                      outputs. Improve quality only.

  Resume Fix                          Existing resume editing and
                                      comparison experience. Improve
                                      editing UX, adopt flow, comparison
                                      clarity, and download path.

  Projects                            Existing project suggestions and
                                      prompt generator. Improve ranking,
                                      practical usefulness,
                                      planning/design/implementation
                                      output quality, and resume-bullet
                                      usefulness.

  Finalize (new)                      Cover letter generation, cover
                                      letter edit/download, final audit
                                      board, before/after metrics, and
                                      remaining blockers.
  -----------------------------------------------------------------------

# 3. Problem statement by area

## A. Diagnosis quality and trust

-   Some outputs feel smart but not dependable.

-   Numbers such as ATS improvement, salary, and cert relevance can feel
    weakly grounded.

-   LinkedIn copy feels generic and AI-written.

-   JD-based analysis is slow and sometimes unreliable.

-   The product goal is to help students improve enough to get
    interviews, so all visible outputs must support that goal clearly.

## B. Resume Fix workflow

-   The current resume area can become long and hard to manage with
    two-page resumes.

-   The adopt/change workflow needs to be clearer and more controllable.

-   The final card below the resume section is in the wrong place and
    should be moved into Finalize.

## C. Projects tab

-   Projects are a key feature and must remain first-class.

-   Low-frequency signals such as 13% should not drive project
    importance.

-   Project prompts need to be much stronger in planning, design, and
    implementation so users can build faster and actually use the
    output.

-   Projects should clearly help ATS, resume strength, and interview
    readiness.

## D. Data quality

-   LinkedIn/Apify scraping quality may be weak, noisy, or too slow.

-   Salary and certification quality is not good enough if values are
    hardcoded or based on weak scraped data.

-   Location should remain optional and should not be required for core
    analysis if the data is not strong enough.

## E. New application-stage workflow

-   A new Finalize tab is needed.

-   It should contain cover letter generation plus the moved final audit
    card.

-   Cover letters should be based on the improved resume, target role or
    pasted JD, and company context if available.

# 4. Detailed build requirements

## Diagnosis tab requirements

-   Retain the current diagnosis sections and content model.

-   Keep LinkedIn inside Diagnosis.

-   Do not add generic market commentary or broad career advice that is
    not directly tied to the user's resume and target role/JD.

-   Improve scannability with better grouping, section headers, cards,
    and internal anchors if useful.

-   Improve the quality of ATS, skill, gap, fix, LinkedIn, and
    certification outputs.

-   Make wording more human and more recruiter-readable.

## Resume Fix tab requirements

-   Retain the current full resume editing concept.

-   Support long resumes better through stronger layout, section
    navigation, controlled scroll behavior, and clearer before/after
    comparison.

-   Keep adopt/rewrite/change actions, but make them more reliable and
    more understandable.

-   Allow users to download the improved resume cleanly.

-   Remove the final audit card from this page and place it in Finalize.

## Projects tab requirements

-   Retain the current project suggestions count and the prompt section.

-   Do not remove or reduce the prompt-generator idea.

-   Improve project ranking using meaningful factors such as skill-gap
    severity, ATS impact, resume value, hiring relevance, and practical
    feasibility.

-   Do not push low-value projects simply because a weak scraped
    percentage exists.

-   Each project should help the user understand why it matters, how to
    plan it, how to design it, how to implement it, and what resume
    bullet it can create.

## Finalize tab requirements

-   Create a new Finalize tab in the left panel.

-   Move the final audit card that currently appears below the resume
    section into this tab.

-   Add cover letter generation here.

-   Cover letter flow should support generate → edit → download.

-   Show before/after score movement honestly and only when grounded.

-   If the user still is not close to interview readiness, show
    remaining blockers instead of pretending they are done.

## Upload and input requirements

-   Resume upload remains mandatory.

-   Support both PDF and DOCX uploads.

-   User can analyze against either a target role or a pasted job
    description.

-   Location remains optional.

-   Do not make location a dependency for core scoring.

## JD mode requirements

-   Fix the pasted-JD analysis path so it is much faster and more
    reliable.

-   Do not require a Vercel Pro plan to solve this.

-   Use deterministic role detection and requirement extraction first;
    only use the model where it adds clear value.

-   Cache normalized JD parsing and role inference when possible.

-   Reduce unnecessary repeated model calls.

# 5. Data and scoring rules

-   **ATS and scoring:** Make ATS and core scoring deterministic
    wherever possible. The model should explain and rewrite, not invent
    core scores.

-   **ATS improvement target:** The product goal is to help users move
    meaningfully toward roughly 75--80% ATS readiness. If the final
    state is still weak, the UI must say so honestly.

-   **Numbers shown to users:** Do not display fake precision or
    low-confidence values as facts.

-   **Salary data:** Improve source quality and confidence handling. Use
    ranges when needed. If confidence is weak, say less.

-   **Certification recommendations:** Tie certs to real skill gaps and
    likely return on effort. Avoid generic lists.

-   **Project recommendations:** Do not make low-frequency percentages a
    key reason to recommend a project.

-   **LinkedIn content:** Use actual resume evidence and target context.
    Avoid generic AI phrases.

-   **Scraped job data:** Audit LinkedIn/Apify quality for cost, speed,
    duplicates, and normalization. Improve the pipeline before trusting
    its outputs.

# 6. Step-by-step implementation order

## Phase 1 --- Audit and baseline

Map the existing repo, current pages, API routes, data sources, and
outputs. Create a non-regression checklist before changing anything.

## Phase 2 --- Upload, parsing, and input pipeline

Add DOCX support, normalize all resume text into one canonical pipeline,
and preserve current behavior.

## Phase 3 --- Deterministic core analysis

Stabilize ATS, skill extraction, gap detection, and job/role matching so
the same input produces stable output.

## Phase 4 --- JD mode performance and reliability

Fix pasted-JD analysis with deterministic role detection, requirement
extraction, caching, and fewer model calls.

## Phase 5 --- Data quality improvements

Audit and improve LinkedIn/Apify job scraping, salary logic, and
certification quality. Reduce weak or fake precision.

## Phase 6 --- Projects tab quality

Fix ranking logic, improve project usefulness, retain prompt section,
and upgrade planning/design/implementation guidance.

## Phase 7 --- Diagnosis content quality

Improve LinkedIn output quality, diagnosis scannability, and
trustworthiness while preserving current content structure.

## Phase 8 --- Resume Fix improvements

Improve before/after UX, adopt actions, long-resume handling, and
download quality.

## Phase 9 --- Finalize tab

Add the left navigation panel, create the Finalize tab, move the final
audit card there, and add cover letter generation/edit/download.

## Phase 10 --- Final UI polish and QA

Apply world-class design standards, optimize performance, test
regressions, and ensure the product feels cohesive.

SECTION: SYSTEM RULES (STRICT)

\- Deterministic logic handles:

ATS scoring, skill extraction, role detection, gap detection

\- AI must NOT generate scores or rankings

\- AI only generates:

explanations, rewrites, LinkedIn, cover letters, project plans

\- Same input must produce same output

AI must NOT influence ranking, scoring, or prioritization decisions.

SECTION: CONFIDENCE RULES

\- High confidence → show

\- Medium → qualify

\- Low → reduce output

\- No fake precision

If confidence is low, suppress the metric instead of displaying a weak
estimate.

SECTION: PROJECT SYSTEM (ENHANCED)

Each project must include:

\- Why it matters

\- Skill gaps fixed

\- MVP (3--5 days)

\- Implementation steps

\- Tech stack

\- Deliverables

\- GitHub structure

\- Demo idea

\- Resume bullet

Each project must explicitly state which ATS keywords it will introduce
into the resume.

SECTION: JD MODE GUARANTEE

\- No LLM for role detection

\- Rule-based parsing first

\- Cache JD results

\- Reduce LLM calls

\- Target latency \<3--5 seconds

Cache should be based on normalized JD hash to avoid duplicate
processing.

SECTION: FINALIZE TAB RULES

\- Move audit card

\- Add cover letter (generate/edit/download)

\- Show before/after honestly

\- Show remaining gaps

\- Do NOT fake readiness

SECTION: TESTING RULES

After EACH phase:

\- Test with 2--3 resumes

\- Test edge cases

\- Check non-regression

\- Check performance

\- Validate outputs

\- Report changes + issues

Validate that outputs remain consistent across repeated runs with the
same input.
