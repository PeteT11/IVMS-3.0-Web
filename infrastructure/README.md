# IVMS 3.0 development infrastructure

Prepared for review only. Nothing in this change deploys on push or pull request. AWS bootstrap, IAM setup, DNS, certificate issuance and Entra changes require separate explicit owner approval.

From this directory, using Node.js 22 and npm:

```sh
npm ci --ignore-scripts
npm run validate
npm run audit:security
```

Synthesis is offline and account agnostic: parameters remain unresolved, assets are staged locally, and no AWS credentials or lookups are needed. `cdk.out/`, compiled files and dependencies are ignored. Commit the lockfile. Both stacks target **us-east-1**; the application uses bootstrap qualifier `ivmsdev01`.

The gateway packages the root `index.html` unchanged. It serves only `/` and `/index.html`; it provides no IVMS data API. The existing demo user label and unconfigured Google Maps key remain prototype content. Do not enter real operational or personal data.

Read [architecture](../docs/architecture.md), [Entra federation](../docs/entra-federation.md), [deployment](../docs/deployment.md), [security operations](../docs/security-runbook.md), and [validation evidence](../docs/validation.md) before approving any deployment. The existing Amplify instructions describe a separate hosting path and do not provide this authentication boundary.
