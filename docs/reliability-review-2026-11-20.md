# Reliability review — 20 November 2026

## Prepared changes
- Restore get_event_v2 and retain compatible get_event. Both exclude trashed events.
- Validate installation and arrival against the selected halls and actual task properties.
- Reject blank names and checks on deleted events.
- Enforce both arrival and installation before hall readiness.
- Add read-only HTTP contract probe using the same public API key as the application.

## Evidence and limits
- The proposed SQL was executed on the actual database inside transactions ending in ROLLBACK.
- Existing backend audit: 21/22 assertions passed with the proposed migration. The remaining failure is concurrent overlapping hall/date acceptance.
- Independent arrival/installation SQL suite passed with the proposed migration.
- New read-contract suite passed: v2/legacy equality, removed hall rejection, incomplete readiness rejection, valid readiness acceptance, duplicate readiness prevention, trash read prevention.
- Fixtures, readiness records and queued messages were rolled back; no Telegram messages were sent.
- Production installation was blocked by automatic approval review. The current database still lacks get_event_v2.
- The new HTTP probe is intended to fail against that state; it must pass after migration installation and before frontend release.
- This is not a claim that the full application or iPhone performance is verified.

## Required release steps
1. Approve and apply the reviewed migration.
2. Repeat read-contract.sql and item-arrival-checks.sql against the installed functions with rollback.
3. Run npm run test:live; verify HTTP 200 from all three real endpoints.
4. Run normal regression and browser suites.
5. Do not mark the remaining hall/date contract defect resolved.

## Performance
Prior read-only sample: get_event execution 4.536ms, get_checks 1.263ms (single server-side measurements).
Network probes from the execution environment include a proxy and are not representative of venue devices.
Eliminating the missing get_event_v2 endpoint removes the failed request before the compatibility fallback.
No change to hosting or framework is included.
