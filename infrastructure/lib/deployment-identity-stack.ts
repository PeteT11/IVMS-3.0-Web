import { CfnOutput, CfnParameter, DefaultStackSynthesizer, Duration, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';

export class DeploymentIdentityStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, { ...props, synthesizer: new DefaultStackSynthesizer({ qualifier: 'ivmsdev01' }) });
    const subject = new CfnParameter(this, 'GitHubOidcSubject', {
      description: 'Exact verified GitHub environment subject; no wildcard. See docs/deployment.md.',
      allowedPattern: '^repo:[A-Za-z0-9_./:-]+:environment:development$',
    });
    const provider = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(this, 'ExistingGitHubProvider',
      `arn:aws:iam::${this.account}:oidc-provider/token.actions.githubusercontent.com`);
    const role = new iam.Role(this, 'DeploymentRole', {
      roleName: 'ivms-development-github',
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          'token.actions.githubusercontent.com:sub': subject.valueAsString,
        },
      }),
    });
    // No direct service access; the separately reviewed bootstrap roles control provisioning.
    role.addToPolicy(new iam.PolicyStatement({
      actions: ['sts:AssumeRole'],
      resources: ['deploy', 'file-publishing', 'image-publishing', 'lookup'].map(kind =>
        `arn:aws:iam::${this.account}:role/cdk-ivmsdev01-${kind}-role-${this.account}-us-east-1`),
    }));
    new CfnOutput(this, 'DeploymentRoleArn', { value: role.roleArn });
  }
}
