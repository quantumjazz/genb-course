# Instructions for Working on This Course

> **IMPORTANT — Read this file at the start of every new session or thread before doing any work.**

## What This Is

This folder contains materials for **GENB070 "Общество, икономика и бизнес"** (Society, Economics and Business) — a 2nd-year bachelor course for an entrepreneurship and business program at a Bulgarian university. The slides are in **Quarto/Reveal.js** format (`.qmd` files).

## Before You Start Any Work

Every time you begin a new session, new thread, or new task related to this course, you **must** do the following — in this order:

1. **Read this file** (`INSTRUCTIONS.md`) in full.
2. **Read the course improvement plan** (`course-improvement-plan.md`) — it contains the 6-module × 3-session architecture, the module plan, design principles, and the slide production plan.
3. **Read the syllabus** (`syllabus.docx`) to understand the official course description.
4. **Check which lectures already exist** by listing the module folders (e.g., `01-защо-съществуват-фирмите/`, `02-договори-рационалност-и-техните-граници/`). Read the `.qmd` files of the most recent 1–2 completed lectures to match their **style, tone, structure, and formatting conventions**.
5. **Consult the primary textbook** in `literature/milgrom_roberts.txt` — find and read the relevant chapter(s) for whatever lecture you are building. The improvement plan specifies which M&R chapters map to which lectures. **Do not rely on general knowledge; always ground the content in the actual textbook.**
6. **Optionally consult the secondary textbook** in `literature/creps_microeconomics.txt` (David Kreps, *A Course in Microeconomic Theory*, 1990) for supplementary examples and exposition. See the "Secondary Textbook Guide" section below for which Kreps chapters are useful and which to avoid.

## Style and Quality Standards

The completed Module 1 slides (Lectures 1–2) are the **quality benchmark**. All new slides must follow these conventions:

- **Language**: Bulgarian, with English technical terms in parentheses where appropriate
- **YAML header**: `title`, `subtitle`, `author`, `format: revealjs` with `incremental: true`, `smaller: true`, `scrollable: true`, `css: style.css`
- **Narrative structure**: Divide each lecture into named parts (`# Част I: ...`, `# Част II: ...`, etc.)
- **Slide separators**: `---` between slides
- **Incremental reveals**: Use `. . .` for fragment reveals within a slide
- **Bold key terms** on first introduction
- **Comparison tables** for structured contrasts (not for formulas)
- **Blockquotes** (`>`) for key insights and memorable quotes
- **Opening**: Recap of previous lecture + bridge question to today's topic
- **Closing sections** (in this order): Обобщение → Ключови идеи → Какво следва? → Големи автори → Препоръчителна литература → Въпроси за размисъл
- **Slide count**: 30–40 slides per lecture
- **Level**: Intuition-first, case-driven. No graduate-level math. Simple algebra, payoff tables, and verbal/graphical reasoning are fine. The audience is 2nd-year entrepreneurship students, not economics PhD candidates.

## Secondary Textbook Guide: Kreps (1990)

`literature/creps_microeconomics.txt` — David Kreps, *A Course in Microeconomic Theory* (Princeton UP, 1990).

This is a **graduate-level** microeconomics textbook. The math is too advanced for direct use in this course, but Kreps is an exceptional expositor and several chapters offer clearer intuitions, sharper examples, or useful conceptual framings that complement M&R. **Use selectively as a reference — never as a primary source for slide content.**

### What to use (accessible, conceptual sections)

| Kreps Chapter | Useful for | How to use |
|---------------|-----------|------------|
| Ch. 16 — Moral Hazard (sections 16.1–16.2 only) | Module 3 (Lectures 5–6) | Opening examples (fire insurance, salesman) are pedagogically excellent. Stop before the Lagrangian optimization in 16.3+. |
| Ch. 17 — Adverse Selection (section 17.1 only) | Module 2 (Lecture 4, Seminar 2) | Lemons model presentation is clean and concrete. Good supplement to M&R Ch. 5 second half. |
| Ch. 19 — Theories of the Firm (entire chapter) | Modules 1–2, 5 | Largely narrative and conceptual. Critiques of naive profit maximization, managerial theories, shareholder conflicts, takeover analysis. Accessible and directly enriches the course. Could be assigned as optional reading for strong students. |
| Ch. 20 — Transaction Cost Economics (sections 20.1–20.2) | Modules 1–2, 5 | Clear verbal presentation of Williamson's framework (bounded rationality, opportunism, asset specificity). No heavy math. Excellent companion to Lecture 3 material. |

### What to avoid (too advanced for this course)

| Kreps Chapter | Why to skip |
|---------------|-------------|
| Ch. 16 (sections 16.3+) | Constrained optimization with Lagrangians, formal principal-agent models |
| Ch. 17 (sections 17.2+) | Formal signaling models, equilibrium analysis |
| Ch. 18 — Revelation Principle | Pure graduate mechanism design: implicit differentiation, formal expected utility |
| Parts I–III (Chapters 2–15) | Standard graduate micro (consumer theory, general equilibrium, game theory). Not relevant unless pointing a strong student to game theory background. |

### Rule of thumb

If a Kreps section uses utility functions, optimization, or Lagrange multipliers, **do not put that math on the slides**. Instead, extract the intuition, the verbal reasoning, or the real-world example — and present it at the level of M&R's informal treatment.

---

## What NOT To Do

- Do **not** invent examples or cases from general knowledge without first checking what the textbook offers. M&R has excellent examples — use them.
- Do **not** include formal optimization, first-order conditions, or incentive compatibility constraints in mathematical form. Translate these into intuitive explanations.
- Do **not** skip the textbook reading step, even if you think you know the material. The specific examples, numerical illustrations, and cases in M&R are what the students will encounter in their readings.
- Do **not** put content from the second half of a chapter into a lecture that covers the first half (and vice versa). The improvement plan specifies the chapter splits.

## Folder Structure

```
.
├── INSTRUCTIONS.md              ← You are here
├── course-improvement-plan.md   ← Master plan (read every session)
├── syllabus.docx                ← Official syllabus
├── README.md                    ← Overview with links to published slides
├── literature/
│   ├── milgrom_roberts.txt      ← PRIMARY textbook (M&R 1992)
│   └── creps_microeconomics.txt ← SECONDARY reference (Kreps 1990) — see guide above
├── 01-защо-съществуват-фирмите/        ← Module 1 (DONE)
│   ├── lecture-01.qmd
│   ├── lecture-02.qmd
│   ├── matching-lecture.qmd            ← Seminar: Hospital matching (NIMP)
│   ├── seminar-01-materials.docx
│   ├── seminar-01-student-handout.docx
│   └── style.css
├── 02-договори-рационалност-и-техните-граници/  ← Module 2 (IN PROGRESS)
│   ├── lecture-03.qmd           ← Covers M&R Ch. 5 first half
│   └── style.css
├── ограничена-рационалност-и-информация/  ← OLD slides (reference only)
├── Скрита-информация-и-неблагоприятна-селекция/  ← OLD slides (reference only)
└── Скрито-действие/                       ← OLD slides (reference only)
```

## Progress Tracker

| Module | Lecture | Status | Notes |
|--------|---------|--------|-------|
| 1 | Lecture 1: Има ли значение организацията? | ✅ Done | Quality benchmark |
| 1 | Lecture 2: Фирми, пазари и ефикасност | ✅ Done | Quality benchmark |
| 1 | Seminar 1 | ✅ Done | Materials + student handout |
| 2 | Lecture 3: Перфектни и несъвършени договори | ✅ Done | M&R Ch. 5 first half |
| 2 | Lecture 4: Когато информацията е частна | ⬜ To do | M&R Ch. 5 second half |
| 2 | Seminar 2: Играта „Пазар на лимони" | ⬜ To do | |
| 3 | Lecture 5: Проблемът на скритите действия | ⬜ To do | M&R Ch. 6 |
| 3 | Lecture 6: Дизайн на стимули | ⬜ To do | M&R Ch. 7 |
| 3 | Seminar 3: Предизвикателство за стимули | ⬜ To do | |
| 4 | Lecture 7: Собственост и права | ⬜ To do | M&R Ch. 9 |
| 4 | Lecture 8: Ефикасни заплати и репутация | ⬜ To do | M&R Ch. 8 |
| 4 | Seminar 4: Симулация + българска приватизация | ⬜ To do | |
| 5 | Lecture 9: Вертикални граници | ⬜ To do | M&R Ch. 16 |
| 5 | Lecture 10: Хоризонтален обхват и мрежи | ⬜ To do | M&R Ch. 16-17 |
| 5 | Seminar 5: Организационен дизайн | ⬜ To do | |
| 6 | Lecture 11: Заетост и компенсация | ⬜ To do | M&R Ch. 10-12 |
| 6 | Lecture 12: Еволюция на организациите | ⬜ To do | M&R Ch. 17 |
| 6 | Seminar 6: Capstone презентации | ⬜ To do | |
