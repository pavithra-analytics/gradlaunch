## GLOBAL EXECUTION RULE (MANDATORY)

## After completing EACH prompt:

## 1. Run validation and testing before proceeding

## 2. Do NOT move to the next prompt until:

## - functionality is verified

## - no regressions are detected

## - outputs are consistent and correct

## 3. If issues are found:

## - fix them within the same step

## - re-test before proceeding

## Claude must NOT continue to the next prompt with unresolved issues.

NO RE-AUDIT RULE (MANDATORY)

After Prompt is complete:
- Do NOT re-audit the repository in later prompts
- Assume the audit findings are accepted
- Focus only on the current prompt scope

ENVIRONMENT CONFLICT RULE (MANDATORY)

If any local hook, automation, or environment instruction conflicts with these rules:
- STOP
- Report the conflict
- Wait for user instruction

Do NOT blindly follow external hooks if they violate code safety rules.

OUTPUT FORMAT RULE (MANDATORY)

Responses must be concise and structured:

- Files changed
- What was implemented
- Testing results (pass/fail)
- Issues (bullet list only)

Do NOT restate the docs.
Do NOT generate long explanations unless explicitly asked.

EXECUTION CONTROL RULE

Execute ONLY one prompt at a time.

After completing a prompt:
- STOP
- wait for confirmation

Do NOT proceed automatically even if everything passes.


STOP RULE (MANDATORY)

After completing each prompt, stop and wait for confirmation before starting the next prompt.

Do not automatically continue to the next prompt even if validation passes.

CHANGE SCOPE RULE (MANDATORY)

Only modify files relevant to the current prompt.

Do not opportunistically refactor unrelated code during the same step.

SESSION TESTING RULE (MANDATORY)

After completing EACH prompt:

1. Run the application locally in the current session

2. Verify the changes directly in the UI (not just code-level validation)

3. Confirm that:

- the updated feature works as expected

- no existing features are broken

- all tabs (Diagnosis, Resume Fix, Projects, Finalize) still function correctly

4. If any issue is observed:

- fix it immediately in the same step

- re-test before proceeding

Claude must NOT proceed to the next prompt until the feature is validated in the running application.

TESTING SCOPE

Testing must include:

- real resume inputs (at least 2–3)

- edge cases (missing sections, bad formatting)

- repeated runs (to confirm deterministic behavior)

CODE SAFETY RULE (MANDATORY)

- Do NOT push any changes to the main branch automatically

- Do NOT commit changes until:

- implementation is complete

- validation and testing pass

- no regressions are detected

- All changes must remain local or in a safe working state until validated

- If version control is used:

- create a separate working branch for changes

- only merge after validation is complete

BRANCHING RULE (RECOMMENDED)

- Create a new branch for each major phase:

example:

feature/resume-parsing

feature/jd-mode

feature/projects

- Do not modify main directly

## Prompt 1 — Repo audit and baseline

Use the execution doc as the source of truth. Start by auditing the current GradLaunch repository end to end.
Goals:
- map the current UI pages/tabs, API routes, parsing flow, scoring flow, and data sources
- confirm exactly what is currently shown in Diagnosis, Resume Fix, Projects, and the final audit area
- identify hardcoded logic, weak data sources, repeated model calls, and high-risk files
- create a non-regression checklist before making changes

Constraints:
- do not change code yet unless a tiny safe improvement is required for inspection
- preserve the current product structure
- do not move LinkedIn out of Diagnosis
- do not reduce features

Deliver:
1. architecture summary
2. feature inventory by page/tab
3. key technical risks
4. recommended implementation plan for the repo in the exact phase order from the doc

Validation & Testing (MANDATORY):

- Ensure no unintended code changes were made
- Confirm all tabs (Diagnosis, Resume Fix, Projects) load correctly
- Verify app runs without errors
- Validate audit findings reflect actual system behavior
- Summarize findings and risks clearly

## Prompt 2 — Upload and parsing pipeline

Use the execution doc. Implement the upload and parsing improvements first.

Tasks:
- add DOCX support in addition to PDF
- keep resume upload mandatory
- normalize PDF and DOCX parsing into one canonical text pipeline
- ensure the same resume produces the same downstream analysis regardless of file type
- keep target-role mode and pasted-JD mode intact
- keep location optional
- do not make location required for core analysis

Constraints:
- do not redesign unrelated UI
- do not change tab structure yet
- do not add new features beyond DOCX support
- preserve current outputs

Deliver:
- code changes
- brief explanation of parsing design
- any edge cases handled
- smoke test checklist for PDF and DOCX

Validation & Testing (MANDATORY):

- Validate functionality for this change

- Check non-regression across all tabs

- Verify deterministic behavior (same input → same output)

- Ensure no performance degradation

- Summarize results and list any issues

## Prompt 3 — Deterministic ATS and scoring

Use the execution doc. Fix core analysis reliability.

Tasks:
- make ATS and core scoring deterministic wherever practical
- stabilize skill extraction, missing-skill detection, and gap ranking
- preserve the current visible outputs in Diagnosis
- keep the model focused on explanation, rewriting, and generated content instead of inventing scores
- ensure the same input gives stable core results

Constraints:
- do not reduce the number of skills displayed
- do not remove any diagnosis sections
- do not fake improvements
- keep current product behavior but improve trustworthiness

Deliver:
- code changes
- explanation of what is now deterministic vs model-generated
- any known limitations still remaining

Validation & Testing (MANDATORY):

- Validate functionality for this change

- Check non-regression across all tabs

- Verify deterministic behavior (same input → same output)

- Ensure no performance degradation

- Summarize results and list any issues

## Prompt 4 — Fix pasted-JD mode without paid-plan assumptions

Use the execution doc. Fix the target-JD analysis path so it is much faster and more reliable without relying on Vercel Pro.

Tasks:
- improve pasted-JD mode
- detect role deterministically first where possible
- extract requirements from the JD before expensive model calls
- cache normalized JD parsing and role inference where useful
- reduce repeated or unnecessary model calls
- preserve support for both target-role mode and JD mode

Constraints:
- do not assume we can add a monthly infrastructure subscription
- do not degrade output quality
- do not change the current product flow
- keep response times reasonable on a free-friendly architecture

Deliver:
- code changes
- performance strategy
- explanation of how the new JD pipeline works

Validation & Testing (MANDATORY):

- Validate functionality for this change

- Check non-regression across all tabs

- Verify deterministic behavior (same input → same output)

- Ensure no performance degradation

- Summarize results and list any issues

## Prompt 5 — Data quality: jobs, salary, and certifications

Use the execution doc. Improve the quality of external-data-driven outputs.

Tasks:
- audit the current LinkedIn/Apify scraping path for speed, cost, duplicate jobs, and normalization quality
- improve normalization of role titles and extracted requirements
- improve salary logic so weak data does not appear as overly precise truth
- improve certification logic so recommendations are tied to real gaps and likely value
- keep location optional and only use it where confidence is strong enough

Constraints:
- if data confidence is weak, show less rather than inventing certainty
- do not add generic market commentary into Diagnosis
- preserve the current product model

Deliver:
- code changes
- summary of data-quality improvements
- what outputs are now confidence-aware

Validation & Testing (MANDATORY):

- Validate functionality for this change

- Check non-regression across all tabs

- Verify deterministic behavior (same input → same output)

- Ensure no performance degradation

- Summarize results and list any issues

## Prompt 6 — Projects tab quality upgrade

Use the execution doc. Improve the Projects tab without reducing its scope.

Tasks:
- keep the current number of project suggestions
- keep the prompt section
- improve project ranking so low-frequency signals like 13% do not dominate importance
- rank projects by skill-gap severity, ATS impact, resume value, hiring relevance, and practical feasibility
- improve the project prompt generator so outputs cover planning, design, implementation, and the likely resume bullet value
- make the Projects tab a stronger differentiator for students

Constraints:
- do not remove the prompt generator
- do not reduce the number of projects shown
- do not turn Projects into generic advice
- keep the current Projects tab as a standalone feature

Deliver:
- code changes
- explanation of new ranking logic
- examples of better project output structure

Validation & Testing (MANDATORY):

- Validate functionality for this change

- Check non-regression across all tabs

- Verify deterministic behavior (same input → same output)

- Ensure no performance degradation

- Summarize results and list any issues

## Prompt 7 — Diagnosis quality and LinkedIn upgrade

Use the execution doc. Improve Diagnosis quality while preserving the current content structure.

Tasks:
- keep LinkedIn inside Diagnosis
- keep the current diagnosis sections and outputs
- improve scannability, grouping, and wording
- remove generic AI tone from LinkedIn content
- make diagnosis insights more resume-grounded and recruiter-readable
- improve trust in visible numbers and phrasing

Constraints:
- do not move features out of Diagnosis
- do not add generic market context
- do not reduce diagnosis depth
- do not reduce the number of skills shown

Deliver:
- code changes
- summary of Diagnosis improvements
- before/after explanation of LinkedIn quality improvements

Validation & Testing (MANDATORY):

- Validate functionality for this change

- Check non-regression across all tabs

- Verify deterministic behavior (same input → same output)

- Ensure no performance degradation

- Summarize results and list any issues

## Prompt 8 — Resume Fix UX upgrade

Use the execution doc. Improve the Resume Fix experience.

Tasks:
- keep the current full resume editing concept
- improve before/after comparison clarity
- improve adopt/rewrite/change interactions
- handle long resumes better with section navigation, better layout, and controlled scroll behavior
- preserve resume download capability
- prepare this page for the final audit card to be moved out later

Constraints:
- do not reduce content
- do not remove editing controls
- do not move the final audit card yet unless needed as part of the later Finalize tab work
- keep the page functional for two-page resumes

Deliver:
- code changes
- explanation of UX improvements
- any follow-up recommendations for polishing

Validation & Testing (MANDATORY):

- Validate functionality for this change

- Check non-regression across all tabs

- Verify deterministic behavior (same input → same output)

- Ensure no performance degradation

- Summarize results and list any issues

## Prompt 9 — Finalize tab and cover letter

Use the execution doc. Implement the approved structural UI change.

Tasks:
- add a left sidebar navigation panel
- add a new Finalize tab
- move the final card currently below the resume section into Finalize
- add cover letter generation to Finalize
- support generate, edit, and download for the cover letter
- show before/after metrics and remaining blockers in Finalize
- keep the rest of the tab structure intact: Diagnosis, Resume Fix, Projects

Constraints:
- do not move LinkedIn out of Diagnosis
- do not collapse Projects into another tab
- do not reduce current functionality
- Finalize should feel like the application-completion stage, not a generic extra page

Deliver:
- code changes
- explanation of the new navigation and Finalize flow
- screenshots or description of the updated page structure

Validation & Testing (MANDATORY):

- Validate functionality for this change

- Check non-regression across all tabs

- Verify deterministic behavior (same input → same output)

- Ensure no performance degradation

- Summarize results and list any issues

## Prompt 10 — World-class UI polish and final QA

Use both the execution doc and UI design rules. Finish the product to a world-class standard.

Tasks:
- apply the installed skills intentionally: frontend-design, react-expert, nextjs-developer, architecture-designer, vercel-react-best-practices
- improve visual hierarchy, spacing, card design, navigation, and trust cues
- make the website feel premium, calm, and trustworthy rather than like a generic AI wrapper
- optimize long-content handling across Diagnosis and Resume Fix
- improve performance and perceived speed
- run a final non-regression pass across all tabs and workflows

Constraints:
- do not reduce features
- do not remove current outputs
- do not add random new features
- preserve the locked tab structure and approved changes only

Deliver:
- final code changes
- concise QA report
- remaining issues, if any
- summary of how the product is now stronger for students

Validation & Testing (MANDATORY):

- Validate functionality for this change

- Check non-regression across all tabs

- Verify deterministic behavior (same input → same output)

- Ensure no performance degradation

- Summarize results and list any issues