# Security and acceptance runbook

All live checks below are pending an approved development deployment. They must not be reported as passed from synthesis. Use test users and synthetic data only.

| Check | Required outcome |
| --- | --- |
| Anonymous GET/HEAD to viewer custom domain | Redirects into Cognito/Entra; never returns dashboard HTML |
| HTTP viewer request | Rejected; no dashboard content |
| Assigned development user | MFA/device policy enforced; callback returns authenticated dashboard |
| Unassigned user, unauthorized guest, other tenant | Cannot obtain dashboard |
| Disabled/unassigned user's new session | Denied; document measured existing-session lifetime |
| Expired/malformed/missing/tampered ALB session cookie | Reauthentication or denial; never serves cached content |
| OAuth callback with missing/wrong state or replayed code | Rejected by managed authentication |
| Two separate browser profiles | No cookie, response or identity leakage between users |
| Direct ALB DNS/origin access from internet | Connection blocked by prefix-list ingress |
| Other CloudFront distribution targeting origin without secret | 403 even if viewer Host is spoofed |
| Origin with invalid header or wrong Host | 403; no forwarding |
| CloudFront default distribution hostname | 403; use approved custom viewer domain |
| Authenticated unknown path or traversal | 404, no SPA fallback; no filesystem access |
| Viewer POST/PUT/DELETE | Rejected by CloudFront; gateway denies mutation methods |
| Browser response inspection | HTTPS, no-store, HSTS, CSP, frame blocking and secure ALB cookie attributes |
| Google Maps and inline UI | Functions under CSP using browser-restricted approved development key |
| Rate threshold and WAF rules | Block test traffic without breaking SAML/OAuth callbacks |
| Logs and alarms | Expected delivery, private/encrypted buckets, no app event/token logging; alarm notification verified |
| OIDC wrong repo/environment/audience | STS denies assumption; unapproved branch cannot enter deployment environment |
| Development role privilege boundary | Cannot deploy production, alter trust, or directly invoke application Lambda |

Test direct-origin controls through an approved second test distribution/network, without revealing the origin secret. Do not add a temporary world-open ingress rule. No public health endpoint is needed because Lambda target health checks are not enabled.

For authentication failures, inspect CloudFront/ALB status codes, CloudFormation events and Cognito/Entra sign-in logs. Check exact viewer/origin DNS, certificate SANs, metadata tenant/app ID, SAML Entity ID/ACS, OAuth callback, forwarded Host/cookies/query strings, shared secret convergence and WAF rule metrics. Do not dump authentication headers, SAML assertions or cookies into logs, PRs or chat. Avoid enabling WAF sampling on authentication endpoints. Logs may contain OAuth codes and IPs; tightly limit access and preserve only redacted evidence.

For suspected unauthorized access, stop admission at WAF or disable the distribution through the authorized incident process, revoke the development deployment role/session paths if CI is affected, and preserve audit evidence. Removing Entra assignment alone does not immediately invalidate ALB cookies. Review CloudTrail for IAM/CloudFront/ALB/Secrets Manager changes and Entra sign-in history. Account-level CloudTrail, alert routing and organization guardrails are prerequisites owned by the platform team; this stack does not install them.

The origin secret can be read by privileged configuration readers, so treat a disclosure as a security event and rotate using the deployment runbook. The application Lambda has no public URL; restrict identity policies that could grant direct invocation or mutate its code. No service token, credential or live IVMS data should be added to the static dashboard.

Before production consideration, separately design per-resource/API authorization, complete login/logout and incident session controls, private-origin options, encryption/key requirements, WAF tuning/logging redaction, capacity/load testing, vulnerability management, resilience, account governance and operational alert ownership. None of these is implicitly approved by this development PR.
