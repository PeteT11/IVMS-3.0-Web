# Microsoft Entra ID federation runbook

Documentation only: no enterprise application, user, group, policy or certificate has been changed. Obtain explicit approval for the development tenant/application and test users before any step below. Use a distinct development enterprise application; never repurpose a production one.

1. An authorized Entra administrator creates a non-gallery enterprise application for IVMS development with **SAML** single sign-on. Set **Assignment required = Yes**, and assign only the approved development group. Disable unsolicited/IdP-initiated use where supported; use the CloudFront viewer URL to start sign-in.
2. Apply the organization's Conditional Access policy requiring MFA and the approved device/access posture. Test allowed, denied, unassigned and guest users. A user pool MFA setting would not enforce MFA at the federated IdP.
3. Obtain the app-specific federation metadata URL. The CDK parameter requires `https://login.microsoftonline.com/TENANT_UUID/federationmetadata/2007-06/federationmetadata.xml?appid=APPLICATION_UUID`. Verify the tenant and enterprise app IDs independently; the URL is configuration, not a secret. The Cognito provider is named `EntraDevelopment`.
4. After the separately approved initial AWS deployment, read the stack outputs. Set the Entra SAML **Identifier / Entity ID** to `SamlEntityId` (`urn:amazon:cognito:sp:USER_POOL_ID`) and **Reply URL / ACS** to `SamlAcsUrl` (`https://COGNITO_DOMAIN/saml2/idpresponse`). Set the sign-on URL to the approved CloudFront custom viewer URL. These are different from the OAuth ALB callback, which is `https://VIEWER_DOMAIN/oauth2/idpresponse` and is set on the Cognito client.
5. Use a stable, unique SAML NameID. Send the email claim as `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress`; the stack maps it to Cognito email. Do not use email as a permanent authorization key. Avoid sending group lists or operational data that the static dashboard does not need.
6. Require signed SAML assertions with the current Entra signing certificate and secure algorithms. Confirm tenant-specific issuer, audience, destination and assertion validity through Cognito; never disable assertion validation to make sign-in work. Track certificate expiration, rollover dates and metadata refresh. Test rollover in development before expiration. Consider assertion encryption if organizational policy requires it; this template does not configure it.
7. Complete the acceptance tests in the security runbook using clean browser sessions. Keep SAML assertions, cookies, authorization codes and tokens out of tickets and logs. Record test outcomes and timestamps, not token contents.

There is a deliberate two-stage setup: metadata is needed for AWS creation; Cognito outputs are then needed to finish Entra configuration. Until both sides and DNS are configured, login is expected to fail closed. There is no local-user fallback.

Removal of Entra assignment affects new sign-in, but an existing ALB session may continue until its 15-minute timeout and browser/IdP sessions can cause automatic reauthentication. For emergency containment, block the viewer at WAF or disable the distribution using the approved incident process. This prototype has no logout UI or per-user immediate ALB session revocation; do not admit sensitive workloads until the required session lifecycle is implemented and tested.

References:

- [AWS: configure a third-party SAML provider](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-integrating-3rd-party-saml-providers.html)
- [AWS: SAML session initiation](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-SAML-session-initiation.html)
- [Microsoft: enterprise application SAML setup](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/add-application-portal-setup-sso)
- [Microsoft: require assignment to an enterprise application](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/assign-user-or-group-access-portal)
