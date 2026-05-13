// Helpers around the `model_rules_followed` field on a trade.
//
// A trade stores rule strings it followed at the time of saving; the
// owning model can change later (rules renamed / removed) so a saved
// trade may carry strings that no longer exist in any group of the
// current model. We surface those "orphans" in the trade UI so the user
// can still see and clear them.

export interface ModelRuleGroupLike {
  rules: string[]
}

/**
 * Returns the rule strings in `followed` that are not present in any
 * group of `groups`. Order follows the iteration order of `followed`.
 */
export function computeOrphanRules(
  groups: ReadonlyArray<ModelRuleGroupLike>,
  followed: Iterable<string>,
): string[] {
  const inModel = new Set<string>()
  for (const g of groups) {
    for (const r of g.rules) inModel.add(r)
  }
  const out: string[] = []
  for (const r of followed) {
    if (!inModel.has(r)) out.push(r)
  }
  return out
}
