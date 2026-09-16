# Kleur & Karakter — approved demo changes, 16 September 2026

Target: existing `demo-engine-kk-liquid-review` preview, `/kleur-karakter/`.
Original golden reference remains separate. User explicitly authorized implementation and publication of all four locked directions.

1. Three cream review cards directly after hero, orange background, mobile native swipe and arrow controls, desktop hover, full-review dialog.
2. Direct service copy; four data-driven groups with three subservices each. Desktop selection gallery; mobile paint-sample fan, pointer swipe, keyboard navigation and expandable work lists.
3. Solid dark-green comparison panel expanding from inset rounded corners to full width on native scroll; title and comparison reveal; one subject selector; existing three paired comparisons retained.
4. Original ring sphere, immediate transparent poster, large-to-final-position opening, orange CTA, compact Google source treatment; scroll-driven lower-surface deformation into the orange review section.

## Media and implementation

- Original source: existing `ring.mp4`, 768 × 432. No new sphere or replacement material.
- Optical-flow retiming followed by a bidirectionally warped overlap produces `ring-continuous.mp4`, 165 frames at 24 fps (6.875 seconds), 316,499 bytes.
- Mean RGB difference of the loop boundary at 192 × 108: 0.306; ordinary adjacent-frame median: 0.401. This verifies boundary continuity, not infinite unique footage.
- Subtle independent float offsets further reduce mechanical repetition; playback always remains forward.
- Source texture is keyed at the source frame rate and deformed in Canvas2D; this is a texture-based visual approximation, not a new fluid simulation or a 3D mesh.
- Pause media when hidden/offscreen; reduced-motion preference restores static poster and immediate readable sections.
- Review texts explicitly remain samples: this fictional company has no verified Google profile or genuine review data available. Do not substitute other businesses' reviews or fabricate a score.
- Enquiry dialog remains a demo and does not transmit or store submissions.

## Browser verification

Checked embedded browser viewports 320×568, 375×667, 390×844, 768×1024, 1440×1000 and 844×390. No horizontal document overflow; no failed loaded images. Verified review navigation/dialog, service selection/expansion/keyboard, comparison subjects/range input, and hero enquiry dialog. Visually reviewed mobile hero, transition midpoint, reviews, services and comparison, and desktop service layout.

Fixed during QA: paint/background color mismatch, CTA lingering over the deforming sphere, rectangular gradient spill, small-screen hero height, Google icon stroke inheritance, clipped rear fan cards and testing iframe shrinkage.

No physical iPhone/Safari test was available. The storyboard is the design reference, not a pixel-exact physics guarantee.
