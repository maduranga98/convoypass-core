# Privacy notes for ConvoyPass

Plain-language facts about the data ConvoyPass stores, for the client to adapt into their own privacy policy and to
check against local law (for Sri Lanka, the Personal Data Protection Act). This is a description of what the software
does, not legal advice. The `/privacy` page in the app is a placeholder that points here: replace its text with your policy.

## Who is who

The **client** (the site operator that runs ConvoyPass) decides why and how long data is kept: it is the data controller.
Each client has its own **tenant**; no tenant can see another's data. Contractors' drivers and supervisors are people the
client's staff or the contractor's supervisor register.

## What is stored

| Data | About whom | Why | Where | Who can see it |
|---|---|---|---|---|
| Name, role, email (office staff) or an optional contact number (drivers and security), account status | every user | sign-in (staff) and showing who did what | Firestore (`users`, `drivers`) and Firebase Authentication | Admin: all users of the tenant. Supervisor: drivers of their own contractor. Everyone: their own record. Drivers' and guards' contact numbers are for contacting them only, never a login. |
| Sign-in credentials: staff passwords | office staff | authentication | Firebase Authentication only (hashed by Google; ConvoyPass never stores or logs them) | nobody can read them |
| **PIN sign-in** (drivers and security): an HMAC-SHA256 of the 8-digit PIN under a secret key (never the PIN itself) | drivers, security | identify who typed the PIN | Firestore (`pinIndex`) | nobody in the app (server only). The PIN is shown once to the admin or supervisor who issued it and is never stored, logged or shown again. |
| **Sign-in throttling**: keyed hashes (HMAC) of the network address and of a random device id, with failure counts and lock times | anyone who tries a PIN | stop PIN guessing | Firestore (`pinAttempts`), deleted by a time-to-live policy about 2 days after use | nobody in the app (server only) |
| **Known devices** (up to 5): a hash of the random device id, first and last seen; last sign-in time | drivers, security | show "Last signed in" and the number of phones; tell admins when a guard signs in on a new phone | Firestore (`users`) | Admin; supervisors for their drivers; the person |
| Driver licence number (optional) | drivers | identify the driver at the gate | Firestore (`drivers`) | Admin, officers and security (tenant), the contractor's supervisor, the driver |
| **Driver photo** (optional) | drivers | the guard compares the face with the person at the gate | Cloud Storage, `tenants/<tenant>/contractors/<contractor>/drivers/<id>.jpg` | Admin, officers, security, the contractor's supervisor, the driver |
| Vehicle plate, type, make and model | vehicles (and so their owners) | the pass | Firestore (`vehicles`, `passes`) | Admin, officers, security, the contractor's supervisor, drivers assigned to the vehicle |
| **Pre-trip evidence photos** (GPS device screen, dashcam, up to two extra) | the driver and anything visible in the photos | proof the vehicle was checked before the trip | Cloud Storage, `tenants/<tenant>/passes/…` | Admin, officers, the contractor's supervisor; the submitting driver |
| Checklist answers and notes | the driver | the pass | Firestore (`passes`) | as the pass |
| **Location (optional)**: latitude, longitude and accuracy at submission | the driver | only if the client turns "require location" on | Firestore (`passes.captureMeta`) | Admin and officers through the pass records; never shown to the driver again |
| Approvals, rejections with reasons, check-in and denial records: who, when, which gate, the reason | staff, guards, drivers | the decision trail | Firestore (`passes`, `gateEvents`) | Admin and officers (all), supervisors (their contractor), drivers (their own passes). Gate denials: admin and officers only |
| **Audit log**: who did what and when (no passwords, PINs, tokens, photos or photo links: this is tested) | staff, guards, drivers | accountability and investigations | Firestore (`auditLog`) | Admin only. Entries are written by the system and cannot be edited or deleted from the app |
| Notifications (title, text, link) | the person notified | in-app alerts | Firestore (`notifications`) | the recipient only |
| Push alert tokens, browser type (first 120 characters), platform, last seen | users who turn on alerts on a device | deliver web push | Firestore (`users/<id>/devices`), and Google's Firebase Cloud Messaging | nobody in the app can read them; only the system sends |
| Crash reports | users when something breaks | fix bugs | Cloud Logging (structured logs) | the operators with Google Cloud access; emails, phone numbers, tokens and URLs are removed before logging |
| Technical logs: which function ran, user id, tenant id, outcome | users | operations and security | Cloud Logging | operators with Google Cloud access |
| Rate-limit counters | users | stop abuse | Firestore (`rateLimits`) | nobody in the app |

The app does not use advertising or analytics trackers and does not sell or share data. Google (Firebase and Google
Cloud) acts as processor; reCAPTCHA (App Check) is used to tell the real app from bots and sends browser signals to Google.

## How long

| Data | Kept |
|---|---|
| Passes, check-ins, denials, approvals and their history | until the client deletes them. There is no automatic expiry. |
| **Pre-trip evidence photos** | forever by default. The admin can set **Evidence retention** (30 to 3650 days): photos older than that are deleted for good every night. The pass record and history stay. |
| Driver photo and licence number | while the driver exists (accounts are disabled, not deleted). Disabled drivers can no longer sign in. |
| Audit log | until the client deletes it. It has no automatic expiry. |
| Notifications | 30 days, then deleted by a Firestore time-to-live policy |
| Rate-limit counters | minutes (deleted by the same policy) |
| PIN throttle counters | about 2 days after the last attempt (deleted by a time-to-live policy) |
| Known devices | until the PIN is reissued (cleared) or replaced by newer devices (at most 5) |
| Push tokens | until the person turns alerts off, signs out, or the token stops working (then it is deleted automatically); at most 5 per person |
| Logs | Google Cloud Logging default (30 days for `_Default`) unless the client changes the bucket retention |
| Backups | daily backups 7 days, weekly backups 14 weeks, point-in-time recovery 7 days. **Deleted data can remain in backups until they expire.** Photos in Cloud Storage are not part of Firestore backups. |

## Choices people have

- Alerts are opt-in per device; they can be switched off in *Settings* at any time.
- Location is only collected when the client enables it; the browser asks first.
- Access and correction: a person asks their supervisor or the client's admin, who can edit their name, phone and licence number.
- Removal: accounts are disabled rather than deleted so past decisions stay explainable; photos can be removed by retention. If the client must erase a person completely, that is a manual operator task (users, drivers, photos in Storage, audit entries mention user ids): agree the procedure with your legal adviser first.

## Points the client should decide

1. The retention period for evidence photos (and whether to keep it forever).
2. Whether to collect location (and tell drivers why).
3. Who counts as an administrator (they see the audit log and all pass history).
4. How long audit records and old passes are kept, since the software does not delete them.
5. A contact for questions and complaints, and how requests to see or erase data are handled.
6. Whether drivers and staff are told about the driver photo, the audit trail and the pre-trip photos at registration.
