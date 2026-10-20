# Revit add-in — device-key licensing (add-in 1.10.0, migration 0375)

Goal: a copied DLL, installer, `settings.json`, `license.json` or API token must NOT give anyone a working add-in on another
computer. We do not try to stop copying — we make the copy useless.

This builds on the 0374 licence (signed leases, hardware fingerprint). It does not replace it.

## 1. What an add-in needs to run (all of these)

| # | Requirement | Where it is enforced |
|---|---|---|
| 1 | active employee, role in `admin|senior|engineer|architect` (read from the DB, not the JWT) | `decideLicense`, `userBlockCode` |
| 2 | the computer holds a **device private key** enrolled for this user (TPM/CNG, non-exportable) | `revit_device_keys`, `gateDevice` |
| 3 | a fresh **challenge signature** (single use, 120 s, bound to user + device + purpose) | `consumeChallenge`, `checkProof` |
| 4 | device status `auto` or `approved` (not `pending`/`blocked`/`revoked`) | `gateDevice` |
| 5 | hardware still matches the employee's attendance work PC (or admin approved) | `decideLicense` |
| 6 | add-in version allowed (`min_version`, `blocked_versions`) and licences not globally disabled | `lib/revitPolicy.ts` |
| 7 | office network / `remote_access_allowed` (when `OFFICE_ACCESS_ENFORCED=1`) | `strictNetworkVerdict` (fail-closed) |
| 8 | server issues a **12 h signed lease** + **30 min session** | `POST /api/revit/license` |
| 9 | add-in verifies the lease against its embedded public key **and its own device key id** (`dk`) | `LicenseLease.Verify` |
| 10 | every API call carries the session token; the server re-checks the device on each request (60 s cache) | `middleware/auth.ts`, `lib/revitSessionCheck.ts` |

Client-side checks (9, and `LicenseGate.Ensure()` in every command) are UX + defence in depth. A patched DLL can skip them, so 1–8 and 10 are
decided on the server.

## 2. Flows

```
first run / after revoke        (needs the password: token must be < 15 min old, no purpose)
  login ─► session(24h) ─► CNG key (TPM, else software) ─► challenge(enroll) ─► sign
        ─► POST /device/enroll {public_key, security_level, hw, proof}
           └► auto (matches attendance work PC, under device limit)  |  pending (admin must approve)
        ─► returns renewal credential (30 d, DPAPI-stored)
        ─► challenge(license) ─► sign ─► POST /license {proof}
           └► lease 12h + session 30min + credential

every hour (timer, 5 min tick)   credential ─► challenge(license) ─► sign ─► POST /license
every ~18 min                    credential ─► challenge(session) ─► sign ─► POST /device/session
every API call                   Authorization: Bearer <session>     (server checks device + policy, 60 s cache)
```

Token classes: `purpose:'revit'` session (30 min, any /api route but checked against the device on every call) and `purpose:'revit-refresh'`
credential (30 d, only `/api/revit/license`, `/device/challenge`, `/device/session` — everything else is 401; it cannot mint anything without a
signature). `/mcp` rejects both. The legacy 365-day `purpose:'mcp'` token is untouched (MCP clients still need it) but is no longer enough
for Revit routes once `revit.legacy_token_policy=deny`.

## 3. API

| Endpoint | Who | Notes |
|---|---|---|
| `POST /api/revit/device/challenge` `{device_id, purpose:'enroll'|'license'|'session', addin_version?}` | staff | 403 `DEVICE_NOT_ENROLLED` for license/session when no key; 429 above 30 open challenges |
| `POST /api/revit/device/enroll` | staff, **fresh password login** | 403 `REAUTH_REQUIRED` otherwise; 409 `DEVICE_KEY_MISMATCH` (key already used / different key on device) |
| `POST /api/revit/device/session` | staff + proof | session + renewed credential |
| `POST /api/revit/license` | staff (+ proof) | lease, session, credential; fail-closed 503 `SECURITY_CHECK_FAILED` |
| `GET /api/revit/license/admin/users/:id/devices` | admin | security level, key short id, enrolled / last proof / last lease |
| `PATCH /api/revit/license/admin/devices/:id {status, reason?}` | admin | `auto|approved|blocked|pending|revoked`; `revoked` deletes the key |
| `GET /api/revit/license/admin/events?user_id=&limit=` | admin | security event log |
| `GET|PUT /api/revit/license/admin/policy` | admin | see below |

Machine-readable deny codes (all with Mongolian messages): `USER_INACTIVE ROLE_NOT_ALLOWED DEVICE_BLOCKED DEVICE_REVOKED DEVICE_PENDING
DEVICE_LIMIT_REACHED DEVICE_NOT_ENROLLED DEVICE_KEY_REQUIRED DEVICE_KEY_MISMATCH DEVICE_KEY_WEAK DEVICE_PROOF_REQUIRED DEVICE_PROOF_INVALID
NOT_WORK_PC NO_WORK_PC_PROFILE NO_HW_PROFILE ADDIN_UPDATE_REQUIRED ADDIN_VERSION_BLOCKED REVIT_LICENSES_DISABLED office_network_required`.

## 4. Policy (`app_settings`, `revit.*`)

```
PUT /api/revit/license/admin/policy        (admin bearer; partial updates)
{ "disabled": true }                       emergency off: no new lease/session; live sessions die within ~60 s
{ "min_version": "1.10.0" }                older add-ins get ADDIN_UPDATE_REQUIRED (also when the client reports no version)
{ "blocked_versions": ["1.9.0","1.9.2"] }  ADDIN_VERSION_BLOCKED
{ "device_key_policy": "required" }        keyless devices get DEVICE_KEY_REQUIRED (default "optional" = migration window)
{ "legacy_token_policy": "log"|"deny" }    365-day mcp token on /api/revit/*, /api/qto/{revit-runs,schedules,view-exports}
{ "require_tpm": true }                    software keys enroll as pending (DEVICE_KEY_WEAK)
{ "max_devices": 2 }                       active keyed devices per employee (admin approve may exceed it)
{ "enroll_approval": "admin" }             no automatic approval at all (recommended after the initial rollout, phase C)
{ "session_scope": "open" }                 emergency only: let `purpose:'revit'` sessions reach any /api route (default "enforce": add-in routes only)
```

## 5. Deployment order (do not reorder)

1. `wrangler secret list` — `REVIT_LICENSE_KEY` must already be set (0374). **No new secret is needed.** (`JWT_SECRET` signs the session/credential.)
2. `cd backend && npx tsc --noEmit` (wrangler deploy does not type-check), `node --test` for the revit tests.
3. `npx wrangler d1 migrations apply mgl-progress-db-v3 --remote --config wrangler.toml` — applies **0375** (3 tables, 2 indexes, no
   parent rebuild, no data change). Note the bookmark printed beforehand (`d1 time-travel info`) in case of rollback.
4. `npx wrangler deploy --config wrangler.toml` (backend first: a 1.10 add-in talking to the old worker gets 404 and shows "server not ready").
5. Frontend: `npm run verify`, then `npx -y wrangler@latest pages deploy dist --project-name mgl-design-system --branch main`.
6. Windows: build + run `revit-mcp/tests/Licensing.Tests` (`dotnet run`), build all four configurations, run `installer\build-installer.ps1 -Build`
   (add `-RequireSigned` once a certificate exists). Do **not** distribute 1.10.0 before this passes.

Rollback: the migration only adds tables; the worker can be rolled back without touching D1 (old code ignores the tables). Rolling the worker back
while 1.10 add-ins are in the field makes them fall back to "server not ready" (they keep the last lease ≤ 12 h).

## 6. Rollout phases

| Phase | Server | Add-ins | Outcome |
|---|---|---|---|
| A | deploy 0375 + worker, policy defaults (`optional`, `allow`) | 1.9.x keep working (`sec:'legacy'`, now 12 h leases) | nothing breaks; admin sees legacy devices |
| B | same | roll out 1.10.0; each employee re-logs in once → key enrolled | keyed devices appear (`auto`/`pending`) |
| C | `legacy_token_policy=log`, watch `legacy_token_used` events; then `device_key_policy=required` | stragglers get `DEVICE_KEY_REQUIRED` | only enrolled devices license |
| D | `min_version=1.10.0` + `legacy_token_policy=deny` | 1.9.x get `ADDIN_UPDATE_REQUIRED` | legacy mode closed for good |

## 7. Operations

* **New PC / Windows reinstall / TPM cleared** — the old key is gone. Admin: revoke the old row (or leave it), set the new one to `pending` → the employee
  logs in once → new key enrolls (auto if it matches the attendance work PC, otherwise admin approves). Keys are never migrated between machines.
* **Same PC, revoked then re-allowed** — revoke tombstones the key, so it can never enroll again.  Admin sets the row back to `pending`; on the next
  password login the add-in gets 409 `DEVICE_KEY_MISMATCH`, deletes its local key ONCE, creates a fresh one and enrolls it (`LicenseGate.SignInAsync`).
  A 403 `DEVICE_REVOKED` (row still revoked) never triggers rotation.
* **Keys are per ERP employee, not per Windows profile** — CNG name `MGL-Revit-Device-v1-u<user_id>` (`DeviceKeyStore.ForUser`, user id from the
  token / lease `sub`).  Two employees signing in on one Windows profile each get their own key and cannot disturb each other's enrollment.
* **Employee leaves** — set the user inactive: no new lease/session (`USER_INACTIVE`), and `checkTokenValidity` kills their other tokens; lease on a
  PC that is offline dies within 12 h.
* **Compromised add-in build** — `blocked_versions` / `min_version`; **everything** — `disabled:true`.
* **Rotate the lease signing key** — add the new public key to `LicenseKeys.Production` (new `kid`), ship the add-in, wait, then `wrangler secret put
  REVIT_LICENSE_KEY` with the new key, remove the old public key in the following release. Never the other way round (old add-ins would lock out).
  Never commit the private key (backup lives in `%USERPROFILE%\.mgl-secrets\`).
* **Why can't X use the add-in?** — Users → Devices dialog (last result + event list), or `GET /license/admin/events?user_id=X`.

## 8. Verified here vs. not verified here

Verified (backend, macOS, Node 24): 65 revit tests (43 route/middleware + 5 pure + 17 existing licence tests) (real SQLite from the migration files, real WebCrypto ECDSA) incl. replay, wrong user/device/purpose
challenge, forged key, copied device id without key, downgrade, fail-closed on D1/policy/network errors, version kill switch, `purpose` handling in the real
`authMiddleware`, key-rotation overlap; `tsc` clean for these files.

**NOT verified here: all C#** (no .NET SDK on the authoring machine) — `DeviceKeyStore`, `LicenseGate`, `SettingsStore`, dialogs, installer scripts. A Windows
build and `Licensing.Tests` run (TS→C# vectors, CNG sign/verify, TPM-or-software) are mandatory before shipping. Real TPM behaviour, DPAPI copy tests, and
Revit-in-the-loop checks are manual: see the checklist below.

Manual Windows checklist: (1) enroll on a TPM PC → admin shows `TPM key`; (2) copy `%APPDATA%\RevitMcpAddin` to another PC → login required, `license.json`
→ `WrongDevice`, `device.json` cannot be decrypted; (3) block device in admin → tools stop within the hour and API within ~1 min; (4) go offline → tools work
until the lease expires (≤ 12 h); (5) set `min_version` above the build → `ADDIN_UPDATE_REQUIRED`; (6) batch QTO overnight run still pushes.

## 8b. Findings from the independent review (all fixed, regression-tested)

C1 `/mcp` accepted the 30-day credential as a full MCP token · C2 a stolen 30-min session could mint a permanent 365-day `mcp` token · H1 keyless
downgrade through a fresh `device_id` · H2 re-enrolling overwrote admin decisions · M1 challenge exhaustion / `last_result` poisoning · M3 non-atomic
enroll · M4 revoked keys could re-enroll · M5 role staleness in sessions · M6 unbounded event log. C#: stale session persisted to disk, transient key
failure wiping the licence, silent software-key downgrade, `Ensure()` not waiting for a session, stale tokens held across long operations, sign-out races.
See CLAUDE.md for the one-line summary of each fix.

## 9. Remaining risks

* PCs with an identical GPU/cores/monitor profile plus someone who knows an employee's password can get an automatic `auto` enrollment — use `enroll_approval=admin`
  if that matters. (Needs the password; copying files alone is not enough.)
* A software (non-TPM) key can be used by any process running as that Windows user (not exportable, but usable). `require_tpm` closes it for the whole firm.
* Anyone who can modify the DLL can skip client checks; that is why decisions live on the server. Obfuscation and Authenticode are hooks only (no certificate or
  obfuscator in the repo).
* `security_level` (tpm|software) is declared by the add-in; the server has no TPM attestation, so `require_tpm` is a policy signal, not proof.
* Two MGL accounts sharing one Windows profile share the CNG key name — the second one is rejected (`DEVICE_KEY_MISMATCH`) until an admin intervenes.
* A 401 on the credential clears it (re-login needed); the version policy applies to new leases/sessions only (a live session survives ≤ 30 min).
* Web session tokens (24 h, cookie) are not device-bound and still reach `/api/revit/*`; that is the ordinary ERP threat model.
* `/api/upload` and other generic endpoints used by the add-in keep accepting the legacy `mcp` token (they are shared with the web app).
* Revit-year policy is not implemented (only add-in version).
