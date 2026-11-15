# Validation evidence

Validated locally on 15 November 2026. No AWS account was contacted, no resources deployed and no Entra settings changed. These are source/template checks, not live penetration tests or proof of successful federation.

| Check | Result |
| --- | --- |
| Locked install, `npm ci --ignore-scripts` | Passed |
| TypeScript compilation and static asset packaging, `npm run build` | Passed |
| `cdk synth --quiet` (both stacks) | Passed without AWS credentials/lookups |
| Security assertions and gateway tests, `npm test` | 9 passed, 0 failed |
| `npm audit --audit-level=high` | Exit 0; 0 high/critical; **2 moderate findings remain** |
| Workflow YAML parsing | Both workflows parsed successfully |
| `git diff --check` | Passed |
| AWS deployment, parameterized account diff, DNS/TLS, SAML sign-in, OIDC assumption, live bypass tests | Not run; require explicit approval and prerequisites |

Local runtime: Node.js 24.22.1, npm 11.9.0, TypeScript 5.9.3, CDK CLI 2.1148.1 and aws-cdk-lib 2.277.0. CI is configured for Node.js 22, matching the application Lambda runtime. GitHub CI results are separate from these local results.

The nine tests inspect every CloudFront behavior and origin, disabled caching and viewer forwarding, TLS, WAF association, origin header/host enforcement, authentication-before-forwarding, security-group ingress, Entra-only OAuth configuration, retained encrypted logs, scoped Lambda permission/no function URL, exact OIDC audience/subject and bootstrap role scope, static gateway rejection behavior, response headers and manual/environment/branch workflow guards.

During validation, the stock CDK `LambdaTarget` was found to grant the ELB service principal unscoped Lambda invocation. This implementation replaces it with a permission requiring the current account and the named `ivms-development-static` target group. Only AWS's generated group-ID suffix is wildcarded to allow permission installation before target registration without a CloudFormation circular dependency. A regression assertion checks the scope.

## Remaining findings and limits

`npm audit` reports [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), a moderate denial-of-service issue in `minimatch` 10.2.6 bundled inside aws-cdk-lib, plus the dependent aws-cdk-lib finding (two package findings from one advisory). These are synthesis/build dependencies and are not packaged in the static Lambda asset. Avoid processing untrusted glob patterns through privileged infrastructure tooling. The high/critical CI threshold is explicit; passing it does not mean a clean audit. Review and resolve the moderate findings before approving deployment according to organizational policy.

The registry's current CDK release still bundles this version. An npm override does not replace CDK's bundled copy. The audit's automatic proposed fix downgrades CDK to 2.239.0; that broad rollback was not applied silently. Upgrade to a release with a patched bundled dependency, or separately review and validate a tooling change. Do not claim this issue has been fixed by an ineffective override.

Synthesis reports 82 unconfigured CDK feature flags. The security-relevant default security-group restriction and IAM policy minimization are explicitly enabled. Review new flags during future CDK upgrades; do not enable all flags without evaluating template changes. No synthesis errors were suppressed.

Workflow parsing and source assertions do not prove GitHub environment protection is installed. Required reviewers, no self-review, branch restrictions, exact subject-format verification, dedicated account/permissions boundary, bootstrap and notification setup remain administrator prerequisites. This PR does not modify repository administration settings.

The prototype still has the original demo identity label and Google Maps key placeholder. No logout UI, live IVMS API, per-record authorization or production rollout is included. Complete the live acceptance matrix in [security-runbook.md](security-runbook.md) before granting development access.
