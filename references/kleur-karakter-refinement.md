# Kleur & Karakter refinement, 2026-09-13

User authorized implementation of the audit findings and three additional requirements: remove the slanted orange bar; three matched before/after comparisons with changing copy and subtle navigation; fit hero identity/services/reviews/CTA into the first viewport with no visual overlap. Hero animation redesign is explicitly deferred.

Original live HTML and CSS preserved in `references/kleur-karakter-original/`. The current main Worker does not contain this live reference route; do not deploy the old Worker over the live runtime without reconciling the difference. Certified painter_v1 is unchanged.

Implementation is `public/kleur-karakter/`. Six Higgsfield stills are generated, visually inspected, and regenerated as optimized WebP from checksum-verified original URLs using `python3 scripts/prepare-kk-assets.py`. See asset manifest and Supabase asset registry for provenance. Comparisons are illustrative, not company projects. Review positions and form are explicitly demo-only; no data is submitted or stored.

QA: four canonical viewports, first-viewport hero bounds, document overflow, project centering and controls, before/after image geometry and switching, keyboard input, portrait visibility, mobile menu, form behavior, reduced motion, JS errors and all image loading. GitHub Actions saves screenshots and report. This is reference refinement QA, not certification of a new reusable master template.
