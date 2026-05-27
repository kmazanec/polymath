# Nerdy, Inc. — Company brief for the Hyperresponsive Mastery UI challenge

## At a glance

Nerdy, Inc. (NYSE: **NRDY**) is a St. Louis–headquartered public-market education company whose flagship brand is **Varsity Tutors**. It operates a "Live + AI™" online learning platform that combines a marketplace of human experts with AI-mediated tutoring, classes, practice and analytics across 3,000+ subjects. PitchBook lists ~650 employees; Q1 2026 disclosed 36,900 Active Members at $374 ARPM, $48.7M Q1 revenue (+2% YoY), 66.2% gross margin, and $1.0M adjusted EBITDA — the third consecutive quarter of EBITDA-margin improvement after a ~20% YoY headcount reduction tied to AI-driven automation. Full-year 2026 guidance is $180–$190M revenue at approximately breakeven non-GAAP adjusted EBITDA. The company has effectively bet itself on the AI-tutoring pivot: founder/CEO Chuck Cohn has personally bought ~$30M+ of stock and now owns ~45% of the company (up from ~15% in 2023). ([Q1 2026 earnings transcript — Motley Fool / Globe & Mail][1]; [Nerdy IR press releases][2]; [PitchBook profile][3]; [STL Today — Cohn personal investment][4]; [Chuck Cohn LinkedIn / bio][5])

## Business model

Nerdy makes money in three streams, in descending order of revenue today:

1. **Consumer Learning Membership (subscription)** — recurring monthly fee giving access to 1:1 tutoring, unlimited live group classes, AI tutor, adaptive practice, study hall, and on-demand content. This is the bulk of revenue: **$38.9M in Q1 2026 (~80% of total, +3% YoY)**. ARPM = $374, +12% YoY. Active Members = 36,900 (-9% YoY, decline narrowing). ([Q1 2026 transcript][1])
2. **Institutional — Varsity Tutors for Schools** — districts and schools buy high-dosage tutoring + AI tools for K-12. Q1 2026 institutional revenue $9.3M (~19%, -1% YoY); VT4S bookings were $1.1M vs. $4M in Q1 2025 — a stress point management is openly addressing with a re-platformed V3 selling motion. ([Q1 2026 transcript][1]; [aiinvest analysis][6])
3. **One-off/legacy a-la-carte tutoring** — minor residual, deliberately deprecated as the company moved to a subscription model. ([STL Today on subscription pivot][4])

**The pivot is the story.** Nerdy started in 2007 as a tutor marketplace. In Feb 2023 it announced ChatGPT-powered products (lesson plan creator, AI chat tutoring). In 2025 it launched **Live + AI™** for schools — combining human tutoring with context-aware AI across the full learning cycle, with 40+ teacher tools claimed to save 7–10+ hours/week. June 2025: signed the **White House "Investing in AI Education" pledge** (4-year commitment). October 2025: full Live + AI product release. March 2026: V3 platform launch with **Maya**, a 24/7 AI concierge embedded in the consumer product that holds full learner-plan context. Q2 2026 roadmap targets an **AI counselor** (college/career), **4,600+ K-8 math skills** mapped to taxonomies, AI language modules, and 350+ on-demand courses. ([Nerdy IR — Feb 2023 release][7]; [Live + AI launch — Apr 2025][8]; [White House pledge — Jun 2025][9]; [Q1 2026 transcript][1])

**Margin/CAC/LTV signals.** Gross margin 66.2% and +820 bps YoY in Q1 2026; sales & marketing -10%, G&A -16% YoY; headcount -20% YoY; cash $40–45M guided at year-end including a $20M term loan. The narrative the CFO and CEO are selling investors: AI is the lever that lets a smaller team carry the same revenue at improving margins. ([Q1 2026 transcript][1])

## Product surface today

The learner sees a portfolio, not a single app. As of mid-2026:

- **Nerdy AI Tutor / "AI Sidekick"** — homepage hero copy: *"Your AI study sidekick: Nerdy listens, explains, and plans — so you keep up, stress-free, in every class."* On-demand learning coach for explanations, practice drills, flashcard quizzes. Multimodal direction is explicit in product marketing ("text, voice, visual"); the consumer-app pages describe an "AI study assistant" and a **"Tutor Copilot"** that "surfaces the perfect example or exercise exactly when you need it." ([nerdy.com homepage][10])
- **ai.varsitytutors.com — free AI Tools suite** (27 tools, no paid tier here). Teacher tools: Lesson Plan Generator/Checker, Rubric Generator, Quiz Generator, Report Card Comment Generator, IEP Generator, SMART Goal Generator, Parent Communication Drafter, Dynamic Worksheet Builder, Text Leveler, Plagiarism Checker, Essay Reviewer, YouTube Summarizer/Question Generator. Student tools: **Homework Help** (photo or text input), **AI Flashcard Maker**, math games (Number Cards, Crossmath), Periodic Table game + interactive table, **3D Solar System simulation**. Hero copy: *"AI Tools for Learning. Built to Empower Learners & Teachers."* Modalities offered today: text + image upload + YouTube URL. **Voice and live camera are not exposed on this surface.** ([ai.varsitytutors.com][11])
- **Live 1:1 tutoring** — vetted tutors ("top universities including Yale, Princeton, Stanford, and Cornell"), Tutor Satisfaction Guarantee, marketed at all ages elementary→professional. ([varsitytutors.com/online-tutoring][12])
- **All Access Live Classes** (group, included in membership) — K-8, high school, college, adult and language tracks; "StarCourses" with celebrities/astronauts/Olympians. Unlimited enrollment. ([varsitytutors.com/membership/classes][13])
- **Live Learning Platform** (the tutoring "room" itself) — purpose-built, **two-way video**, **collaborative workspace**, **virtual whiteboard**, **document collaboration**, **graphing**, **photo/homework upload**, **subject-specific tools**, 200,000+ practice questions. Generative AI **transcribes, summarizes, and analyzes** sessions ("AI Session Insights & Video Playback"). ([Live Learning Platform for Schools][14]; [Apple App Store listing][15])
- **Varsity Tutors for Schools (V3)** — bundles high-dosage tutoring, AI-powered practice, **predictive analytics dashboards**, **Teacher Copilot**, 40+ AI teacher tools, **AI Session Insights**, MTSS/IEP/state-standards alignment; trusted by 1,000+ districts; "10M+ hours of live instruction" delivered. Named customers include Fairfax County, Loudoun County, Broward County, Polk County Public Schools, Success Academy. ([Oct 2025 Live + AI release][16]; [varsitytutors.com/schools][14])
- **Mobile apps** — iOS and Android Live Tutoring app + Learning Tools app, both publicly listed and updated. ([App Store][15])

**Free vs. paid:** the AI Tools suite at ai.varsitytutors.com is positioned free. Everything inside the Live Learning Platform (1:1, classes, AI tutor with context, AI session insights, study hall) sits inside the Learning Membership subscription or the institutional contract.

## Tech stack (high confidence vs. low confidence)

> **What is *directly stated* in the Gauntlet portal brief itself:** Required languages **Python, JavaScript, TypeScript**; AI/ML frameworks **OpenAI, LangChain, TensorFlow**; dev tools **React, Docker, Git, Node.js**; cloud **AWS, GCP**. This is the most authoritative stack signal for this specific project (`polymath/BRIEF.md` lines 226–230). Treat anything below as triangulating *Nerdy as a whole*, which may differ from what's expected for this submission.

### High-confidence (directly stated in job postings, the official GitHub org, or executive bios)

| Layer | What | Source |
|---|---|---|
| **Cloud** | **AWS** is primary. RDS, Lambda, EC2, **CodeDeploy** named in current job postings. AWS-specific OSS in their GitHub org (`api-gateway-aws`, `lua-resty-aws-auth`, `gawsc`). | [Senior SDE (AI-Native) — careers.nerdy.com][17]; [github.com/varsitytutors][18] |
| **Languages** | **JavaScript + TypeScript** required for current AI-Native SDE roles. Core OOP language proficiency requested in **Java, C++, or C#**. Historical/marketplace Ruby presence confirmed by the `minitest-reporters-json_reporter` gem and Rails-ecosystem `makara` shard-aware DB proxy on the official org. **Go** also present (`gostatsd`, `gawsc`). **Python** universal in their AI/ML job listings and in this brief. | [Senior SDE (AI-Native)][17]; [github.com/varsitytutors][18]; [Snagajob — Senior SDE Full Stack listing summary][19] |
| **Frontend** | **React + TypeScript**. The current LATAM Senior SDE and historical Full-Stack postings name React and TypeScript explicitly. | [Senior SDE (AI-Native)][17]; [Snagajob][19] |
| **Edge / proxy** | **OpenResty / NGINX with Lua**. Three actively-maintained Lua repos: `lua-resty-aws-auth` (sign AWS v4), `lua-resty-cache` (Redis-backed HTTP cache), `lua-resty-openidc` (OAuth/OIDC RP at the edge), and `api-gateway-aws` (AWS SDK for NGINX/Lua). Strong signal of a Lua-on-NGINX gateway layer fronting their services. | [github.com/varsitytutors][18] |
| **CI/CD** | **GitHub Actions + AWS CodeDeploy**. Internal `last-successful-build-action` (TypeScript) is GitHub-Actions-native and updated in 2026. | [Senior SDE (AI-Native)][17]; [github.com/varsitytutors][18] |
| **Observability** | **StatsD-tags via `gostatsd`** (Etsy-style metrics with tags) — their fork is on the official GitHub org. | [github.com/varsitytutors][18] |
| **Service architecture** | **Services-oriented architecture** in AWS with a "complete CI/CD software lifecycle" — language is consistent across their public postings. | [Senior SDE (AI-Native)][17] |
| **Engineering posture toward AI** | The phrase **"AI-Native at every level"** is the headline of their engineering org messaging. Every current engineering listing is tagged "(AI-Native)". Job posts explicitly require fluency with **Cursor, Make.com, Supabase, Netlify, Claude Code, n8n, Firecrawl, ChatGPT, Grok, Bolt, Vercel**. These are productivity/automation tools — *not* necessarily production runtime — but the signal is unmistakable: they want builders who ship with AI in the loop, fast. | [Senior SDE (AI-Native)][17]; [careers.nerdy.com/engineering][20] |
| **Mobile** | Native iOS app (App Store id 1050814379) + Android app (Play Store `com.varsitytutors.tutoringtools`) + a separate Learning Tools app (`com.varsitytutors.learningtools`). Not confirmed React Native — could be native or hybrid. Treat the framework as **low-confidence**. | [App Store][15]; [Play Store search results][21] |
| **Realtime / video** | The Live Learning Platform explicitly offers two-way video, collaborative workspace, whiteboard, doc collaboration. **The specific SFU/WebRTC vendor is not disclosed publicly** — could be Twilio Video, Daily, Agora, LiveKit, or in-house. Mark as low-confidence. | [Live Learning Platform for Schools][14]; [App Store][15] |
| **AI/ML** | **OpenAI/ChatGPT** is explicitly the foundation of the AI products (Feb 2023 release names ChatGPT). Beyond that, no specific orchestration framework (LangChain, LlamaIndex, custom) is publicly named. Hugging Face org `NerdyInc` exists but shows no public model uploads. | [Nerdy AI products press release Feb 2023][7]; [Hugging Face NerdyInc][22] |

### Low-confidence (single source or strongly implied)

- **Ruby on Rails** legacy in the consumer/marketplace codebase. Implied by `makara` (Rails DB proxy), `minitest-reporters-json_reporter`, and the engineering team's tenure (the company is from 2007 — Rails-era startup). No 2026 job posting on careers.nerdy.com explicitly mentions Ruby; the older ZipRecruiter/Snagajob mirrors do. **Plausible they're actively migrating away from Rails toward TS/Node services + Lambda.**
- **GCP secondary to AWS.** The Gauntlet brief lists both. AWS dominance is unambiguous in their job posts and GitHub. GCP usage may be limited to specific data/ML workloads (Vertex AI? BigQuery?) but is **not publicly verified**.
- **Redis** for caching at the edge (`lua-resty-cache` writes to Redis).
- **Identity** via OIDC at the edge (`lua-resty-openidc`).
- **Data warehouse** — not publicly disclosed. With a Q1 emphasis on "predictive analytics dashboards" and "intelligent tutor-student pairing," a modern OLAP stack (Snowflake/Redshift/BigQuery + dbt) is highly likely but unconfirmed.

## Founders & technical leadership

**Chuck Cohn — Founder, Chairman & CEO.** Founded the company in 2007 as a Washington University undergrad after a frustrating calculus tutor search. Net Q2 2025 quote on the AI bet: *"Q2 proved that our Live+AI™ strategy is a growth engine."* In a recent letter framing he described the relationship as *"a learner and an expert that's now supported by the best technology available."* Has personally bought $30M+ of NRDY stock and moved his ownership from ~15% (2023) to ~45% (2026) — a CEO who is voting with his own balance sheet. ([Chuck Cohn LinkedIn][5]; [Q1 2026 transcript][1]; [STL Today][4]; [InvestorPlace][23])

**John Paszterko — Chief Operating Officer.** Joined 2025 from Amazon (director-level); now leads consumer sales, marketplace ops, and member services. ([EdTech Innovation Hub][24])

**Atul Bagga — Chief Financial Officer.** Appointed effective April 6, 2026. ([Nerdy IR — CFO appointment][2])

**Abhay Dalmia — VP, Engineering.** *This is the single most important name to know for a technical defense.* Joined Nerdy from **Amazon (6 years, fulfillment software, ~50-engineer org)**; before that **Google**, where he worked on **Google Cloud Filestore** (petabyte-scale NAS). **Georgia Tech CS.** Based in Seattle. Leads engineering across Consumer, Institutional, and Infrastructure. His public Nerdy bio explicitly frames his role around **"AI-powered product strategy and execution," "ownership and craftsmanship,"** and **"aligning engineering execution with company strategy."** What he likely respects in a design defense: scalability story, clear ownership of failure modes, AI-native delivery velocity, and a measured argument for build-vs-buy on infra. He's an FAANG-trained ICs-into-management leader — he'll smell hand-wavy architecture diagrams immediately. ([nerdy.com/abhay-dalmia-bio][25]; [LinkedIn][26])

**Mike Hunigan — VP, AI.** Six years at **Capacity** (SVP Product, AI / VP Product), AI-driven customer-support automation; before that VP Product & Design at **Answers**. Based in St. Louis. Owns Nerdy's "AI-first initiatives" portfolio. Product-leaning AI executive, not a research scientist — he'll value AI products that demonstrably move learning outcomes, not benchmark scores. ([nerdy.com/mike-hunigan-bio][27])

**No publicly listed CTO and no publicly listed CPO as of May 2026.** Heidi Robinson, the prior CPO, **departed in March 2023**; no public successor has been announced. This is meaningful: product and AI are effectively split across **Hunigan (VP, AI)** and the CEO, with **Dalmia (VP, Eng)** owning execution. Plan to defend the prototype to Cohn, Dalmia, and Hunigan as the realistic technical-evaluation triangle. ([MarketScreener — Robinson departure][28]; [nerdy.com/who-we-are leadership listing][29])

**Other named leaders worth knowing:** Rian Schilligo (Chief People Officer), Chris Swenson (Chief Legal), Courtney Menges (VP, Privacy), Mark DeFranco (VP, Institutional Sales), Andy Ketter (VP, Performance & Growth Marketing), Jason Botel (Head of Government Relations). Privacy/policy weight on this team is non-trivial given the K-12 schools business — see FERPA notes below. ([nerdy.com/who-we-are][29])

**Harrison Glenn and Tom Bauer — brief contacts.** The brief lists `harrison.glenn@varsitytutors.com` and `tom.bauer@varsitytutors.com` as points of contact. **Neither surfaces with high confidence on public LinkedIn, the Nerdy leadership pages, Crunchbase, or ZoomInfo profile mirrors for Nerdy.** That, combined with `@varsitytutors.com` (not `@nerdy.com`) email addresses, suggests they are **individual contributor or manager-level employees inside Varsity Tutors product/engineering** — likely Senior PM, EM, or Staff IC running this Gauntlet partnership — not C-level. **Treat as low-confidence; verify before the defense via LinkedIn directly logged-in or by asking the recruiter.** The signal this sends: this is being evaluated by builders, not finance/strategy. Make the prototype convincing to a working PM/EM, not a CTO presentation deck.

## Brand & voice (design contract)

**Color palette.** The primary brand color is a **bright/medium royal blue** used for CTAs, headings, and navigation. Background is **near-white**. Secondary palette is **muted neutral grays** for body and dividers. Accent uses **gradient blues** (light → mid-blue) on hero sections of nerdy.com. I could not confirm exact hex codes without inspecting CSS directly — *plan to pull these from the live site in DevTools before final design lock*; treat the palette as **bright royal blue + warm white + neutral gray + gradient blue accent** at high confidence on family, low confidence on exact values. ([varsitytutors.com][30]; [nerdy.com][10])

**Typography.** Sans-serif, modern, bold-weight display for headings; lighter weight for body. The system reads as a **default modern sans stack** (likely Inter / SF / system) rather than a heavily-branded custom typeface — common for AI-native consumer EdTech that prioritizes legibility over personality. ([varsitytutors.com visual analysis][30])

**Visual aesthetic.** **Airy, lifestyle-photography-led, not textbook-dense.** Hero sections use real-feel photography of students and tutoring sessions (professionally shot, authentic-feeling, not stock-banner-AI-generated). Cards have rounded corners, soft shadows, and generous whitespace. Statistics presented in roomy callout grids ("40,000+ experts," "332,000 questions answered weekly," "10M+ hours of live instruction"). Iconography is line/illustrative for the AI Tools page; data-vis appears on the school-side dashboards. **Gradient-heavy** on AI surfaces (nerdy.com homepage), more **flat-and-white** on conversion pages (varsitytutors.com). ([nerdy.com homepage extract][10]; [ai.varsitytutors.com extract][11])

**Motion.** Marketing sites are mostly static with light scroll reveals. Inside-product motion is unconfirmed without an active session — but the V3 platform's "Maya AI Concierge" suggests conversational micro-interactions are now part of their UX language. Treat heavy motion as **off-brand**; subtle, purposeful state transitions are **on-brand**.

**Copy voice.** **Warm, achievement-oriented, parent-and-student-aspirational, mildly informal.** Reads as a confident peer/coach, not as a clinical assessment platform. Three representative pulls:

- *"Your AI study sidekick: Nerdy listens, explains, and plans — so you keep up, stress-free, in every class."* ([nerdy.com][10])
- *"Better grades & higher scores start today!"* ([varsitytutors.com][30])
- *"AI Tools for Learning. Built to Empower Learners & Teachers."* ([ai.varsitytutors.com][11])

Notice the verbs: *listens, explains, plans, empower, support, elevate.* Notice what's absent: jargon, benchmark talk, hype, technical depth. Even an executive Cohn quote stays plain: *"combining live tutors, AI-driven practice, and predictive analytics in one seamless platform."* This is **plain-English EdTech with quiet confidence** — no exclamation marks beyond CTAs, no AI maximalism.

**Synthesized design contract for "Polymath."** A Nerdy-native screen should feel like: a *clean white canvas* with a *single dominant action* in *royal blue*, *bold sans-serif* heading, *one piece of student-real imagery or one purposeful visual scaffold* (not three competing widgets), *generous whitespace*, *warm peer-coach copy* in second person, *micro-interactions that confirm the learner's progress without performing*. When the UI morphs (the entire premise of the brief), morphs should feel like a tutor turning a page — confident, brief, contextual — not like an AI showing off. The hyperresponsive surface should **earn** every change with an explicit reason the learner can read in one sentence.

## Domain notes for stretch features

Five concrete directions, each grounded in something Nerdy actually does or sells:

1. **Mastery telemetry that maps to "double growth in core subjects."** Nerdy publicly cites *"students who receive consistent, AI-enabled high-dosage tutoring double their growth in core subjects compared to standard interventions"* ([varsitytutors.com/schools][14]). Build a small dashboard view in the prototype that emits the exact telemetry shape — pre/post diagnostic, time-on-task, transfer-task success — that would slot into this claim. The eval narrative becomes: *"my mastery signal is the kind of evidence Nerdy already publishes."*
2. **Handoff-to-human-tutor moment.** Nerdy's entire competitive moat is the **40,000+ vetted experts** marketplace plus the Live Learning Platform "room." A polished moment where the AI-driven UI says *"I'm escalating you to a live tutor — here is the workspace state I'm handing them"* directly demonstrates respect for their business model rather than threatening it. Bonus: render the handoff in a Live Learning Platform–style two-pane (whiteboard preserved + chat) so the comparison is unmissable.
3. **Teacher-side artifact = Teacher Copilot–style output.** They ship 40+ teacher tools (Lesson Plan Generator, Rubric Generator, IEP Generator, Report Card Comment Generator). If the prototype, after a learning session, can generate **one defensible artifact** — a rubric-scored mastery report or a parent-facing summary — it lands directly in their VT4S surface area. ([ai.varsitytutors.com][11])
4. **FERPA / accessibility posture stated upfront.** They sell into 1,000+ districts and have a VP, Data Privacy on the leadership page. A 200-word *"Compliance & Accessibility Stance"* section in the decision log (no PII, deletion-on-close, WCAG 2.1 AA-targeted contrast, keyboard-first nav, no facial-affect storage unless opted-in even if the brief allows it) signals you've actually thought about their institutional sales motion. Camera-based affect detection is *especially* a place to be cautious and explicit — defaults off, on-device, ephemeral, no minor-data retention. ([varsitytutors.com/schools — FERPA mention][14]; [nerdy.com leadership][29])
5. **Subject choice: SAT/ACT prep or AP STEM.** Varsity Tutors' historical anchor is **test prep (SAT, ACT, AP)** and STEM tutoring — see the All Access Live Classes line-up (SAT 4-Week Prep, ACT 4-Week Prep, AP Calculus Guided Study Hall, Python Academy) ([varsitytutors.com/membership/classes][13]). A *"tightly scoped goal"* in any of these domains — say, a single AP Calculus concept (related rates) or an SAT-reading inference subtype — feels native rather than chosen at random. Math also lets you justify camera-handwriting-capture and direct-manipulation diagrams in a way that matches their public "K-8 math skills aligned to academic taxonomies" Q2 roadmap ([Q1 2026 transcript][1]).

## Sources

**Official / SEC / IR**

- [Nerdy Q1 2026 Earnings Call Transcript — The Motley Fool (May 8, 2026)][1]
- [Nerdy Inc. — IR press releases (CFO Bagga, COO Paszterko, Live+AI launches)][2]
- [Nerdy Inc. — Varsity Tutors Introduces Live+AI Tools — Oct 1, 2025][16]
- [Nerdy Inc. — Varsity Tutors Launches Live + AI Platform for Schools — Apr 2025][8]
- [Nerdy Inc. — New AI-Enabled Products incl. ChatGPT integration — Feb 3, 2023][7]
- [Nerdy Inc. — Varsity Tutors Signs White House AI Education Pledge — Jun 30, 2025][9]

**Product**

- [nerdy.com — homepage / "AI Sidekick"][10]
- [ai.varsitytutors.com — free AI Tools suite (27 tools)][11]
- [varsitytutors.com — consumer homepage][30]
- [varsitytutors.com/online-tutoring][12]
- [varsitytutors.com/membership/classes — All Access Live Classes][13]
- [varsitytutors.com/schools — VT4S Live + AI platform][14]
- [Apple App Store — Varsity Tutors Live Tutoring app][15]
- [Mobile app coverage / Play Store presence][21]

**Engineering & jobs**

- [careers.nerdy.com — Engineering & Technology page][20]
- [careers.nerdy.com — Senior SDE (AI-Native) Full Time Contractor — full job description][17]
- [careers.nerdy.com — Senior Director, Product Engineering (AI-Native)][31]
- [github.com/varsitytutors — official GitHub organization (Lua/OpenResty, Ruby gem, Go, TS)][18]
- [Snagajob — Varsity Tutors Senior Software Engineer (Full Stack) listing summary][19]
- [Hugging Face — NerdyInc org (currently no public model uploads)][22]

**Press, analyst, profile**

- [PitchBook — Nerdy profile (employee count ~650)][3]
- [aiinvest analysis — strategic turnaround & AI-driven efficiency][6]
- [STL Today — Cohn personal investment and revenue-strategy bet][4]
- [InvestorPlace — Cohn buying Nerdy stock][23]
- [EdTech Innovation Hub — Paszterko COO appointment][24]
- [Glassdoor — Varsity Tutors company reviews][32]

**Leadership profiles**

- [Chuck Cohn LinkedIn][5]
- [nerdy.com/abhay-dalmia-bio][25]
- [Abhay Dalmia LinkedIn][26]
- [nerdy.com/mike-hunigan-bio][27]
- [nerdy.com/who-we-are — leadership listing][29]
- [MarketScreener — Heidi Robinson CPO departure (Mar 2023)][28]

[1]: https://www.fool.com/earnings/call-transcripts/2026/05/08/nerdy-nrdy-q1-2026-earnings-call-transcript/
[2]: https://investors.nerdy.com/news/news-details/2026/Nerdy-Inc--Appoints-Atul-Bagga-as-Chief-Financial-Officer/default.aspx
[3]: https://pitchbook.com/profiles/company/103248-37
[4]: https://www.stltoday.com/business/columns/david-nicklaus/nicklaus-nerdy-ceo-bets-his-own-money-on-firm-s-new-revenue-strategy/article_7b3cdc0b-21c0-5eda-ac7d-7232844e6449.html
[5]: https://www.linkedin.com/in/charlescohn
[6]: https://www.ainvest.com/news/nerdy-strategic-turnaround-operational-overhaul-ai-driven-efficiency-catalyze-2026-profitability-2511/
[7]: https://www.businesswire.com/news/home/20230203005313/en/Nerdy-Announces-New-AI-Enabled-Products-Including-an-AI-Generated-Lesson-Plan-Creator-and-AI-Enabled-Chat-Tutoring
[8]: https://www.businesswire.com/news/home/20250429401366/en/Varsity-Tutors-Launches-Live-AI-Platform-for-Schools-Delivering-NextGeneration-Tutoring-Teacher-Support-System
[9]: https://investors.nerdy.com/news/news-details/2025/Varsity-Tutors-Signs-White-House-Pledge-to-Advance-AI-Education-for-Americas-Youth/default.aspx
[10]: https://nerdy.com/
[11]: https://ai.varsitytutors.com/
[12]: https://www.varsitytutors.com/online-tutoring
[13]: https://www.varsitytutors.com/membership/classes
[14]: https://www.varsitytutors.com/schools
[15]: https://apps.apple.com/us/app/varsity-tutors-live-tutoring/id1050814379
[16]: https://investors.nerdy.com/news/news-details/2025/Varsity-Tutors-Introduces-New-LiveAI-Tools-and-Capabilities-That-Teachers-and-School-Administrators-Can-Use-to-Support-Student-Learning/default.aspx
[17]: https://careers.nerdy.com/job-posts/sde
[18]: https://github.com/varsitytutors
[19]: https://www.snagajob.com/jobs/666133496
[20]: https://careers.nerdy.com/engineering
[21]: https://play.google.com/store/apps/details/Varsity_Tutors_Live_Tutoring?id=com.varsitytutors.tutoringtools
[22]: https://huggingface.co/organizations/NerdyInc/activity/all
[23]: https://investorplace.com/2022/08/ceo-charles-cohn-just-bet-big-on-nerdy-nrdy-stock/
[24]: https://www.edtechinnovationhub.com/news/nerdy-inc-names-john-paszterko-as-its-new-chief-operating-officer-leading-consumer-sales-marketplace-operations-and-member-services
[25]: https://nerdy.com/abhay-dalmia-bio
[26]: https://www.linkedin.com/in/abhaydalmia/
[27]: https://nerdy.com/mike-hunigan-bio
[28]: https://www.marketscreener.com/quote/stock/NERDY-INC-115884906/news/Nerdy-Inc-Announces-Heidi-Robinson-Departs-as-Chief-Product-Officer-43218801/
[29]: https://nerdy.com/who-we-are
[30]: https://www.varsitytutors.com/
[31]: https://careers.nerdy.com/job-posts/senior-director-product-engineering-ai-native
[32]: https://www.glassdoor.com/Overview/Working-at-Varsity-Tutors-EI_IE431872.11,25.htm

## Confidence & open questions

**Things to double-check before defending:**

1. **Identities of Harrison Glenn and Tom Bauer.** Could not confirm titles or org placements via public web. **Recommended:** the candidate logs into LinkedIn directly and searches both by name within the "Varsity Tutors, a Nerdy Company" employer filter. The framing of the defense changes meaningfully depending on whether they are ICs, EMs, PMs, or director-level. Until confirmed, treat the audience as *"working PM/EM at Varsity Tutors product org."*
2. **Exact realtime/video vendor for Live Learning Platform.** Two-way video, whiteboard, doc collab confirmed — vendor not disclosed. Could be Twilio, Daily, Agora, LiveKit, or in-house. Don't claim one; if asked, say *"I'd want to confirm whether you're on Twilio Video / Daily / LiveKit / in-house WebRTC before assuming integration shape."*
3. **Mobile framework.** Apps exist on both stores; React Native vs. native is unconfirmed. Don't assume.
4. **Exact AI-orchestration stack.** OpenAI/ChatGPT is on the record (Feb 2023); LangChain, LlamaIndex, custom orchestration, or model-mix (Anthropic, Gemini) — all unconfirmed. The Gauntlet portal brief names *OpenAI + LangChain + TensorFlow* as the expected stack for *this challenge* — that's the directly authoritative source for what the prototype should be built against, regardless of what Nerdy uses in production.
5. **GCP role.** The portal brief lists AWS + GCP; AWS is dominant in public job/repo signal. Whether GCP is for Vertex AI, BigQuery, document AI, or just a small footprint is **unknown**. Don't claim "they use both equally."
6. **Active Ruby/Rails footprint in 2026.** GitHub artifacts show historical Rails presence; current job postings don't ask for Ruby. The candidate should *not* assume Rails-shaped backend APIs in a defense; safest framing is "modern services-oriented architecture on AWS with TypeScript/Node + Python for AI workloads."
7. **Exact brand hex codes and typography family.** Described as bright royal blue + warm white + neutral gray + sans-serif. Inspect varsitytutors.com and nerdy.com in DevTools before final design lock — should take 5 minutes and removes the only remaining design-direction guesswork.
8. **Current CPO identity (if any).** No successor to Heidi Robinson appears in public sources. May genuinely be a gap on the org chart, with product effectively run by Cohn + Hunigan + Dalmia. If a CPO has been quietly hired since, this changes the audience.

**Confidence summary:** Business model, financials, leadership ex-CPO, product surface, brand voice, and engineering posture are all **high confidence**. Exact production stack components (realtime vendor, mobile framework, model orchestration, GCP scope) are **medium-to-low confidence** — the brief itself is the authoritative source for *what the candidate should build with*, and that is sufficient.
