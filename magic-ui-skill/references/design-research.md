# Design research checklist

Use this file as a starting map, then browse the live pages before making a current recommendation. The links are references, not visual instructions to copy.

## Research pass

For each candidate reference, record:

1. **Structure:** what is the first visual anchor, and how does the page establish hierarchy?
2. **Type:** what is the body font, display font, scale, line length, and text density?
3. **Material:** what gives the page its surface quality—texture, border, shadow, image, or whitespace?
4. **Motion:** which movement communicates state, and which movement is only decoration?
5. **Voice:** what copy, labels, names, or small details make it belong to that product?
6. **Transfer:** what can be adapted without copying the brand or artwork?

## Starting points

- Magic UI components and examples: https://magicui.design/docs/components
- Magic UI templates overview: https://magicui.design/docs/installation
- shadcn/ui component primitives: https://ui.shadcn.com/docs/components
- Pinterest, for moodboards and art-direction references: https://www.pinterest.com/
- Land-book, for product landing-page composition: https://land-book.com/
- Godly, for contemporary web interaction references: https://godly.website/
- Mobbin, for mobile product flows and patterns: https://mobbin.com/

## Pinterest-specific method

Treat Pinterest as a moodboard, not a component catalog. Search by the product's atmosphere and material rather than by framework words, for example: `editorial diary interface`, `paper texture web design`, `quiet personal dashboard`, `soft brutalist journal`, or `scrapbook digital room`.

Do not copy one pin. Build a small board of 6–12 references, then extract a style system:

- one dominant material and one secondary texture;
- a restrained palette with one memorable accent;
- a display/body type pairing and a line-length rule;
- a composition rule (asymmetry, collage, ruled page, index rail, or modular grid);
- one signature interaction and a clear no-motion state.

Pinterest images often show polished static compositions without real interaction or responsive behavior. Verify any implementation idea against a live page or the project's actual content before adopting it.

## Motifs worth translating (not copying)

Recent scrapbook and diary references repeatedly use a small vocabulary of physical-looking elements:

- **Layering:** one primary sheet over a quieter base, with a single offset shadow rather than a stack of floating cards.
- **Tape and labels:** masking-tape strips, date stamps, ticket-like labels, and small marginal notes to make metadata feel kept instead of administrative.
- **Ephemera:** one Polaroid, sticker, doodle, or patterned scrap can act as an anchor; several competing anchors turn the page into noise.
- **Hand / machine contrast:** handwritten or serif display copy for memory, paired with compact monospace or sans-serif labels for navigation and state.
- **Freeform memory surface:** a collage canvas can be looser than a dashboard, but actions still need a stable edge, predictable focus order, and a readable no-decoration state.

For `此间 · Amid`, the first two translated experiments are intentionally distinct:

- **Scrapbook:** milky paper, dashed rules, washi tape, sticker marks, and Amid's dusty-rose accent. The interface should feel kept and assembled over time without leaving the product palette.
- **Poster:** deep mauve ink, soft pink, hard borders, and oversized type. The interface should feel like an art-book cover with a strong reading order while remaining recognizably Amid.

Both directions keep the same content and API behavior. This makes visual comparison meaningful: only composition, material, type, and ornament change.

## Selection rule

Use at least one reference for composition and one for interaction, then design the product's own content treatment. If all references are from animated showcase libraries, the result will usually inherit showcase-library habits instead of developing a product voice.

## Amid-specific questions

When researching `此间 · Amid`, ask:

- Does this look like a room someone returns to, or a dashboard someone operates?
- Where is Claude's presence expressed through a kept detail rather than a model badge?
- What can change slowly with the day, season, or memory without becoming a notification feed?
- Which surface should feel handwritten, and which surface should remain precise and quiet?
- Can the user understand the page without waiting for the animation to finish?
