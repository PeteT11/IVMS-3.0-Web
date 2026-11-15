# Deployment runbook — development only

The current authorization covers code, local validation, a branch and a pull request. It does **not** authorize AWS deployment/bootstrap, Entra edits, production changes or merging to `main`. Do not dispatch the deployment workflow until the owner explicitly approves the target account and reviewed commit.

## Prerequisites after explicit approval

1. Select a dedicated nonproduction AWS account and us-east-1. Record the account ID, owner, cost budget and approved commit. Enforce production separation through AWS organization/account policies; the template cannot determine whether an arbitrary account ID is production.
2. Approve two distinct development DNS names: `ViewerDomain` and `OriginDomain`. Provide an existing issued ACM certificate in us-east-1 with SANs covering **both**. CloudFront forwards the viewer Host to ALB, so the listener certificate must cover the viewer as well as the origin hostname. The stack does not create certificates, hosted zones or DNS records.
3. Verify the regional AWS managed prefix list ID for `com.amazonaws.global.cloudfront.origin-facing`, security group quota, Lambda concurrency quota, ALB availability and DNS ownership. Supply the prefix list ID as `CloudFrontPrefixListId`; no synthesis lookup is performed.
4. Follow the Entra runbook with a development-only app. Approve the metadata URL; no secret or certificate private key belongs in repository variables.
5. A platform administrator reviews and creates/imports the account-level GitHub OIDC provider (`https://token.actions.githubusercontent.com`, audience `sts.amazonaws.com`). Do not create a duplicate provider. Review the CDK bootstrap trust and a dedicated least-privilege CloudFormation execution policy for this stack. Do not bootstrap with AdministratorAccess by default. Bootstrap qualifier is **ivmsdev01**, in the dedicated account/us-east-1 only. Provisioning IAM roles gives the execution role material privilege; enforce a permissions boundary and deny production scope. Bootstrap and the initial identity stack installation are separate, approved administrator operations; the workflow performs neither.
6. Before installing `IvmsDevelopmentIdentity`, verify GitHub's actual OIDC subject format for this repository and the `development` environment, including immutable repository/owner IDs if enabled. Pass the exact value to `GitHubOidcSubject`; do not guess or use a wildcard. The legacy format is `repo:PeteT11/IVMS-3.0-Web:environment:development`. Trust pins both that exact parameter and audience. The role can only assume four exact `cdk-ivmsdev01-*` bootstrap role ARNs; review their downstream policies as the effective deployment privilege boundary. Do not grant this role access to identity-stack administration or production accounts.
7. Create GitHub environment **development** with required reviewers including the owner, prevent self-review, disable protection bypass if supported, and restrict deployments to `dev/zero-trust-aws`. Confirm the repository plan supports these protections. Do not enable deployments if the protection rules cannot be enforced. Grant repository/workflow modification rights only to trusted maintainers and require review for workflow, infrastructure and lockfile edits. Environment existence alone is not approval protection.

Set these nonsecret **development environment variables** only after review:

| Variable | Required value |
| --- | --- |
| `DEV_ACCOUNT_ID` | Approved dedicated development account, 12 digits |
| `VIEWER_DOMAIN` | Approved development custom hostname |
| `ORIGIN_DOMAIN` | Separate development origin hostname |
| `CERTIFICATE_ARN` | Issued us-east-1 ACM certificate ARN in that account |
| `ENTRA_METADATA_URL` | Verified tenant/app-specific metadata URL |
| `CLOUDFRONT_PREFIX_LIST_ID` | Verified us-east-1 AWS CloudFront origin-facing list |

Do not add AWS access keys. The workflow assumes `arn:aws:iam::DEV_ACCOUNT_ID:role/ivms-development-github` using GitHub OIDC, validates the returned account and deploys only `IvmsDevelopment`. The identity stack is deliberately excluded. Parameters have no deployable defaults.

## Reviewed deployment

GitHub normally exposes `workflow_dispatch` only once the workflow exists on the default branch. This PR does not change that branch. Making the workflow available there requires a separately approved merge; do not merge just to run it. Then select the dedicated development branch at dispatch. The workflow refuses other refs. If branch naming changes later, update and review the workflow, environment branch restriction and documentation together.

At the approved commit, run `npm ci --ignore-scripts`, `npm run validate`, and `npm run audit:security` in `infrastructure/`. An authorized operator must review a parameterized `cdk diff IvmsDevelopment` against the approved account before dispatch; a diff may use read-only AWS APIs/change-set permissions and is not part of the offline checks. Confirm no production resource, IAM privilege expansion or unrelated stack change.

Only after explicit approval, dispatch **Deploy development infrastructure (manual approval)** on `dev/zero-trust-aws` with the exact phrase `DEPLOY IVMS DEVELOPMENT`; the environment reviewer must approve the selected commit. `--require-approval never` is used only after that external approval gate. The workflow never deploys on push, PR, schedule or merge.

After successful creation, point the origin DNS name to `OriginDnsTarget` and the viewer DNS name to `CloudFrontDomain` using the approved DNS process. Finish Entra Entity ID/ACS configuration from outputs. Run the acceptance checks before sharing access. Wire the two CloudWatch alarms to an approved notification destination; alarms have no actions by default. Verify access logs arrive and budget alerts are configured.

## Rollback and retirement

For an update failure, let CloudFormation roll back and inspect redacted stack events. Revert the development branch to the last approved commit through review, rerun validation/diff, and obtain approval for redeployment. Do not change `main` or redeploy production as a recovery step. A fresh Cognito pool has a different SAML Entity ID: review Entra changes separately.

For origin-header rotation, pause access if needed, generate a new secret version under approval, and force both ALB listener-rule and CloudFront origin properties to refresh in one reviewed change. Dynamic references do not automatically reread rotated values. Confirm both resources have converged before retiring the previous value; never expose either value in CI output.

Retirement is destructive and needs explicit approval. Disable access, preserve required audit records, then review the removal of ALB and Cognito deletion protection before deleting the stack. Cognito, log bucket and log groups are retained and incur costs until separately approved deletion. Secrets Manager deletion has its own recovery window. Remove DNS, development Entra assignments/app and deployment trust separately with owner approval. Never use blanket account cleanup.

Reference: [GitHub OIDC with AWS and environment subjects](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws).
