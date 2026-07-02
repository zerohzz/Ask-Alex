# Corpus drafts — awaiting Alex's review (DO NOT ingest as-is)

These articles are restructured from **existing Alex-authored content only**
(`alex-huang.dev/src/data/resume.ts` and `Career-Ops/career-ops/config/profile.yml`
+ `cv.md` — themselves derived from the master resume). No facts were invented.
They exist because real usage of Ask Alex is identity/fit-shaped ("Why hire
Alex?", "is he a good fit for X?", pasted JDs) while the corpus had a single
About doc (2 chunks) carrying all of it.

**Deliberately EXCLUDED from the drafts (public agent — your call to add):**
- Compensation expectations (`profile.yml` has a target range; a public agent
  quoting your salary floor to any visitor seems unwise — negotiation leverage)
- Phone number (email/LinkedIn are already public on the site; phone is not)

**Review checklist for Alex:**
- [ ] Every fact/number is accurate and current (dates, venue counts, 55 releases, 200%/69%, 23→3 min, 180+ components)
- [ ] Nothing here is something you'd rather NOT have the public agent say
- [ ] Move approved files into `corpus/`, then re-ingest (with the kb_chunks backup step)

## Known gaps that block good answers (need content only YOU can write)

Recruiter-shaped questions the KB cannot answer today and these drafts do NOT
paper over (listed per the no-fabrication rule):

1. ~~**Work rights / location flexibility**~~ **FILLED** by `target-roles-location-work-rights.md` (from `profile.yml`: AU citizen, no sponsorship AU/NZ, E-3 eligible; remote Melbourne / hybrid Sydney / relocation for frontier lab; up to 50% travel).
2. **People leadership** — STILL OPEN. Resume/CV say "Technical Leadership" and "Lead Engineer" but never state whether Alex has managed people/direct reports. Fit questions for lead roles hit this gap.
3. **Languages spoken** — STILL OPEN. Not stated in the corpus, site data, or career-ops repo.
4. **Availability / notice period** — STILL OPEN. Not stated anywhere.
5. ~~**AI stack depth beyond this project**~~ **FILLED** by `applied-ai-llm-stack.md` (from `cv.md`: RAG/pgvector, Vertex AI, tool calling, Claude Code + governance policy, multi-LLM evaluation, Playwright+AI, Hugging Face).
6. ~~**What he's looking for, concretely**~~ **MOSTLY FILLED** by `target-roles-location-work-rights.md` (role ladder with why-fit, frontier-lab preference). Still open: team-size preference, industries you'd avoid, hard nos.
