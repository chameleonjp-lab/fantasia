# Temporary dragon fireball suspension

The fixed `b0bd9186` private test received a report that the iPhone browser became unresponsive around a dragon fireball impact. The screenshot shows Normal at 21.83 seconds without a pause overlay. Browser controls were also reported unresponsive; audio continuation is unknown. The reported device/browser failure has not been reproduced or attributed to a particular native API.

The user requested a temporary reduced feature set before restoring suspect features individually. This change is containment, **not a proven freeze fix**. It does not replace the existing functional, safety, or physical-device acceptance requirements.

## Temporary behavior

- Dragon fireballs are disabled by the default immutable campaign feature configuration. A fresh run carries its own copied feature settings and matching rules version.
- Dragons do not prepare or announce an attack. The firing commit also rejects disabled dragon attacks, and any remaining fireball is removed before collision/damage handling. Thus no fireball hit/explosion events reach the ordinary visual/audio consumers.
- Dragons remain visible, fly their existing patrol, can take damage, and participate in existing reinforcement rules. Ground troops, magic turrets, player weapons, bombs, and all other attack paths remain enabled.
- The original dragon attack implementation is retained. Explicitly enabled regression fixtures continue to exercise the original direct/splash behavior.
- The home screen identifies the temporary rules. The distinct `fantasia-capture-v1-dragon-fireballs-suspended` rules version is not the original difficulty. Persistent and session-only best-record writes for that variant are ineligible. Existing stored records are neither migrated, overwritten, nor deleted.

The original fireball was already a one-shot projectile: collision removes it in the same tick, direct and blast damage use the larger value rather than being added twice, and residual particles do not apply ongoing damage. Removing a damage-over-time mechanic is therefore not the rationale for this temporary feature switch.

## What this does not claim

Earlier SwiftShader browser checks stopped before dragon fireballs appeared. Their frame/render stops remain separate unresolved observations; disabling dragon attacks is not expected to make every one of those checks pass. No watchdog, render quality, actor count, required-check setting, or release gate is relaxed. `RELEASE_GATE.json` remains unapproved. No main merge, Pages publication, or replacement of the retained private fixed-head preview is part of this code change.

## Verification and restoration

Before adoption, verify no dragon telegraph/fireball/hit/explosion is generated in the default run, existing fireballs are discarded safely, other attacks still act, dragon movement is unchanged at the same ticks, and temporary results cannot write either best-record store. Run the existing unit/build/browser gates on the exact candidate and record every failure or unobserved case. Check the reduced build on the affected physical device before calling it stable.

Restore through a separate reviewed commit, keeping the original fixed preview and this temporary version recoverable. Restore one affected feature at a time with bounded direct-hit, splash, repeated-impact, visual-effect, and audio checks on the affected device. Retain evidence of browser responsiveness and context/error state; a simulation-only or SwiftShader-only pass does not close the physical freeze report. Do not quietly combine temporary-rule records with original-rule records.
