/**
 * Records the plan of a workspace, which decides the monthly visitor pass cap.
 *
 *   npm run tenant:plan -- --env staging --tenant ten_a1b2c3d4e5 --plan starter
 *   npm run tenant:plan -- --env prod --confirm-prod --tenant ten_a1b2c3d4e5 --plan growth
 */
import { FieldValue } from 'firebase-admin/firestore'
import { connect, main } from './lib/env.ts'
import { runTenantPlan } from './tenantPlanCli.ts'

const HELP = `
Set the plan of a workspace (tenants.plan). Starter caps new visitor passes at 20 a month; growth and compliance are
unlimited; "none" removes the plan (not capped, like workspaces that predate plans).

  npm run tenant:plan -- --env <env> --tenant <ten_…> --plan <starter|growth|compliance|none>

  --env <emulator|staging|prod>   required; prod also needs --confirm-prod and the project id typed back
                                  (or --confirm-project <id> in CI)
  --help                          this text

An audit entry (workspace.planChanged) is written to platformAuditLog.
`

main({
  name: 'tenant:plan',
  help: HELP,
  action: () => 'change the plan of a workspace (visitor pass cap)',
  run: (argv, target) => {
    const { db } = connect(target)
    return runTenantPlan(argv, {
      env: target.env,
      out: (l) => console.log(l),
      store: {
        getPlan: async (tenantId) => {
          const snap = await db.doc(`tenants/${tenantId}`).get()
          if (!snap.exists) return undefined
          const plan = (snap.data() as { plan?: unknown }).plan
          return typeof plan === 'string' ? plan : null
        },
        setPlan: async (tenantId, plan, audit) => {
          const batch = db.batch()
          batch.update(db.doc(`tenants/${tenantId}`), { plan: plan === null ? FieldValue.delete() : plan, updatedAt: FieldValue.serverTimestamp() })
          batch.create(db.collection('platformAuditLog').doc(), { ...audit, createdAt: FieldValue.serverTimestamp() })
          await batch.commit()
        },
      },
    })
  },
})
