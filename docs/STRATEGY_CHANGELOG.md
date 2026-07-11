# Strategy corpus change record

## `poto-live-1-3-provisional-v4`

Status: **provisional; not solver- or expert-reviewed**.

The default `BALANCED` / `STANDARD` facing-open action matrix is unchanged from
the deployed v3 corpus. Version 4 removes the former global profile/size hand
lists because they could fold a stronger member of a hand family while keeping
a weaker member.

This cleanup changes 955 of 53,235 facing-open hand/configuration cells outside
that default matrix. These changes are an explicit provisional reset, not proof
that either v3 or v4 is optimal:

| Configuration | Changed cells |
| --- | ---: |
| Tight / small | 167 |
| Tight / standard | 167 |
| Tight / large | 153 |
| Balanced / small | 64 |
| Balanced / standard | 0 |
| Balanced / large | 128 |
| Loose / small | 77 |
| Loose / standard | 71 |
| Loose / large | 128 |

Action transitions:

| Previous → v4 | Cells |
| --- | ---: |
| Pure fold → pure call | 675 |
| Pure fold → call/3-bet mix | 40 |
| Pure fold → call/fold mix | 18 |
| Pure fold → 3-bet/fold mix | 10 |
| Call/fold mix → fold-primary mix | 36 |
| Call/fold mix → pure fold | 173 |
| 3-bet/fold mix → pure fold | 3 |

The normalized action manifest is locked by both a runtime FNV fingerprint and
a CI SHA-256 snapshot. Any future action change must update those reviewed
constants and add a new section here. This prevents copy or refactoring work
from silently rewriting poker answers.

Rollback reference: the last deployed v3 strategy source was commit `c3cce91`;
the GitHub `main` merge containing it was `1958301e` at sprint start.
