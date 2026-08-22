---
name: magic-ui
description: Design and implement distinctive React, Next.js, TypeScript, Tailwind, shadcn/ui, and Motion interfaces using Magic UI patterns without falling into generic template aesthetics. Use when the user mentions Magic UI, asks for animated UI components, wants a polished landing page or product shell, or asks to research beautiful UI references and adapt them to an existing product.
---

# Magic UI design and implementation

Use Magic UI as a pattern library and visual vocabulary, not as a reason to repaint every surface with gradients. The goal is a product-specific interface with one memorable visual idea, a clear content hierarchy, and motion that explains state.

## Workflow

### 1. Inspect the existing frontend first

- Identify the framework, styling system, routing, and animation runtime before choosing components.
- Use Magic UI source components directly only when the project is already React-compatible or the user explicitly approves a migration.
- For vanilla HTML/CSS/JS, keep the existing stack and recreate the chosen interaction with CSS, SVG, or GSAP. Record that it is a visual adaptation, not a direct Magic UI import.
- Preserve existing product behavior, data flow, and backend boundaries while changing the presentation layer.

### 2. Write a visual thesis before selecting components

Capture these decisions in a short note or in the implementation plan:

- **Feeling:** what should the first five seconds feel like?
- **Material:** paper, glass, ink, terminal, fabric, metal, light, or another coherent metaphor.
- **Anchor:** one object or interaction that makes the product recognizable.
- **Contrast:** where should the eye rest, and where should motion appear?
- **Quiet zone:** which areas must remain calm for reading, composing, or privacy?

Reject a component when it does not support one of these decisions. Do not start from a catalog of effects and search for somewhere to put them.

### 3. Research references deliberately

When the user asks for something beautiful, current, or distinctive:

1. Browse the official Magic UI catalog and relevant component pages.
2. Browse two or three independent product galleries or live products for layout and typography references.
3. Save three concrete observations: composition, interaction, and content treatment.
4. Combine observations into a new direction; do not copy a page, brand, or illustration.
5. Prefer references with a similar product purpose and reading density over visually loud showcase pages.

Use `references/design-research.md` for the research checklist and starting links.

### 4. Select a small component set

Choose one anchor effect and at most two supporting effects for a first pass. Use `references/component-map.md` to map product needs to Magic UI patterns.

Good defaults:

- `Magic Card` or `Glare Hover` for a single important card that rewards attention.
- `Blur Fade`, `Text Reveal`, or `Typing Animation` for a meaningful message, not every heading.
- `Border Beam` or `Shine Border` for an active, syncing, or selected state.
- `Animated List` for live events, messages, or an evolving archive.
- `Dock` for compact persistent navigation when the product benefits from a spatial toolbar.
- `Particles`, `Noise Texture`, or `Dot Pattern` only as low-contrast atmosphere behind content.
- `Marquee` only for content that is genuinely continuous; never use it to fill an empty page.

### 5. Implement with the project's real constraints

For a React/Tailwind project, follow Magic UI's copy-in component model and keep the added source in the repository. The official installation path is equivalent to shadcn/ui; add only the components used by the page.

For non-React projects, implement the same idea with the existing tools. Use transform and opacity animation, keep pointer interactions local, and expose a no-motion fallback. Do not add a large runtime just to reproduce a one-line hover effect.

### 6. Verify the result as a product

- Render the page at mobile, desktop, and narrow-window sizes.
- Test keyboard focus, touch targets, text contrast, and `prefers-reduced-motion`.
- Check that animated layers never cover primary copy or interfere with input.
- Test a slow device or throttled CPU when using particles, canvas, blur, or pointer-following effects.
- Compare the implementation to the visual thesis, not just to the reference screenshot.

## Anti-template rules

- Do not combine a giant gradient hero, three identical cards, floating blobs, and a generic CTA unless the product actually calls for that language.
- Do not make every card interactive. A calm card can create more hierarchy than another glow.
- Do not use rainbow, neon, or glass effects in a private, reflective product without a narrative reason.
- Do not hide product identity behind a component showcase. Names, states, remembered details, and meaningful copy should lead the design.
- Do not replace a working frontend architecture solely to access a component. Migrate only when direct Magic UI source reuse materially improves the result.

## Accessibility and performance

- Respect `prefers-reduced-motion`; reduce or remove decorative loops and pointer-following effects.
- Prefer transforms and opacity over layout properties.
- Keep decorative effects `pointer-events: none` unless interaction is the point.
- Use a single animation owner per element; clean up listeners, animation frames, and observers on unmount.
- Lazy-load heavy visual effects below the fold.
- Keep the content readable with effects disabled.

## Official implementation references

- Installation and shadcn-compatible workflow: https://magicui.design/docs/installation
- Component catalog: https://magicui.design/docs/components
- Magic Card: https://magicui.design/docs/components/magic-card
- Particles: https://magicui.design/docs/components/particles
- Marquee: https://magicui.design/docs/components/marquee

Read the linked reference files only when the task needs research or component selection detail.
