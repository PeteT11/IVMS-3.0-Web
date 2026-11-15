import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { DevelopmentStack } from '../lib/development-stack';
import { DeploymentIdentityStack } from '../lib/deployment-identity-stack';
import { handler } from '../gateway/handler';
import type { ALBEvent } from 'aws-lambda';

const app = new App();
const stack = new DevelopmentStack(app, 'SecurityTest', { env: { region: 'us-east-1' } });
const identityStack = new DeploymentIdentityStack(app, 'IdentityTest', { env: { region: 'us-east-1' } });
const template = Template.fromStack(stack);
const identity = Template.fromStack(identityStack);
const resources = (type: string) => Object.values(template.findResources(type)) as any[];

test('every CloudFront behavior authenticates at the origin without caching; HTTPS throughout', () => {
  const config = resources('AWS::CloudFront::Distribution')[0].Properties.DistributionConfig;
  assert.equal(config.CacheBehaviors, undefined);
  assert.equal(config.DefaultCacheBehavior.ViewerProtocolPolicy, 'https-only');
  assert.equal(config.DefaultCacheBehavior.CachePolicyId, '4135ea2d-6df8-44a3-9df3-4b5a84be39ad');
  assert.equal(config.DefaultCacheBehavior.OriginRequestPolicyId, '216adef6-5c7f-47e4-b989-5492eafa07d3');
  assert.equal(config.Origins.length, 1);
  assert.equal(config.Origins[0].CustomOriginConfig.OriginProtocolPolicy, 'https-only');
  assert.ok(config.WebACLId);
  assert.equal(config.Logging.IncludeCookies, false);
});

test('origin requires BOTH secret and viewer host; authentication precedes forwarding', () => {
  const listeners = resources('AWS::ElasticLoadBalancingV2::Listener');
  assert.equal(listeners.length, 1);
  assert.equal(listeners[0].Properties.Protocol, 'HTTPS');
  assert.equal(listeners[0].Properties.DefaultActions[0].FixedResponseConfig.StatusCode, '403');
  const rules = resources('AWS::ElasticLoadBalancingV2::ListenerRule');
  assert.equal(rules.length, 1);
  const rule = rules[0].Properties;
  assert.deepEqual(rule.Actions.map((a: any) => a.Type), ['authenticate-cognito', 'forward']);
  assert.equal(rule.Actions[0].AuthenticateCognitoConfig.OnUnauthenticatedRequest, 'authenticate');
  assert.equal(rule.Actions[0].AuthenticateCognitoConfig.SessionTimeout, 900);
  assert.equal(rule.Conditions.length, 2);
  assert.equal(rule.Conditions[0].HttpHeaderConfig.HttpHeaderName, 'X-Ivms-Origin');
  const config = resources('AWS::CloudFront::Distribution')[0].Properties.DistributionConfig;
  assert.deepEqual(rule.Conditions[0].HttpHeaderConfig.Values[0], config.Origins[0].OriginCustomHeaders[0].HeaderValue);
  assert.match(JSON.stringify(rule.Conditions[0]), /resolve:secretsmanager:/);
  assert.equal(rule.Conditions[1].Field, 'host-header');
});

test('network ingress only allows the supplied CloudFront prefix list on 443', () => {
  const groups = resources('AWS::EC2::SecurityGroup');
  const ingress = [...groups.flatMap(g => g.Properties.SecurityGroupIngress ?? []), ...resources('AWS::EC2::SecurityGroupIngress').map(r => r.Properties)];
  assert.equal(ingress.length, 1);
  assert.deepEqual(ingress[0].SourcePrefixListId, { Ref: 'CloudFrontPrefixListId' });
  assert.equal(ingress[0].FromPort, 443);
  assert.equal(ingress[0].ToPort, 443);
  assert.equal(resources('AWS::EC2::NatGateway').length, 0);
});

test('Cognito accepts only Entra SAML; no self signup or native auth flows', () => {
  template.hasResourceProperties('AWS::Cognito::UserPool', { AdminCreateUserConfig: { AllowAdminCreateUserOnly: true }, DeletionProtection: 'ACTIVE' });
  const client = resources('AWS::Cognito::UserPoolClient')[0].Properties;
  assert.deepEqual(client.AllowedOAuthFlows, ['code']);
  assert.equal(client.GenerateSecret, true);
  const samlId = Object.keys(template.findResources('AWS::Cognito::UserPoolIdentityProvider'))[0];
  assert.deepEqual(client.SupportedIdentityProviders, [{ Ref: samlId }]);
  template.hasResourceProperties('AWS::Cognito::UserPoolIdentityProvider', { ProviderName: 'EntraDevelopment', ProviderType: 'SAML' });
  assert.ok(!client.ExplicitAuthFlows.some((f: string) => /PASSWORD|SRP|CUSTOM/.test(f)));
  assert.equal(client.CallbackURLs.length, 1);
});

test('private encrypted retained logs, scoped Lambda invocation and no function URL', () => {
  template.hasResourceProperties('AWS::S3::Bucket', {
    PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
    BucketEncryption: Match.anyValue(),
  });
  assert.equal(resources('AWS::S3::Bucket')[0].DeletionPolicy, 'Retain');
  template.hasResourceProperties('AWS::Lambda::Permission', {
    Principal: 'elasticloadbalancing.amazonaws.com', SourceArn: Match.anyValue(), SourceAccount: { Ref: 'AWS::AccountId' }, Action: 'lambda:InvokeFunction',
  });
  assert.equal(resources('AWS::Lambda::Permission').length, 1);
  assert.match(JSON.stringify(resources('AWS::Lambda::Permission')[0].Properties.SourceArn), /targetgroup\/ivms-development-static\/\*/);
  assert.equal(resources('AWS::Lambda::Url').length, 0);
  assert.equal(resources('AWS::CloudWatch::Alarm').length, 2);
});

test('deployment role pins audience and exact parameter subject; only assumes four bootstrap roles', () => {
  const roles = Object.values(identity.findResources('AWS::IAM::Role')) as any[];
  assert.equal(roles.length, 1);
  const trust = roles[0].Properties.AssumeRolePolicyDocument.Statement[0];
  assert.equal(trust.Condition.StringEquals['token.actions.githubusercontent.com:aud'], 'sts.amazonaws.com');
  assert.deepEqual(trust.Condition.StringEquals['token.actions.githubusercontent.com:sub'], { Ref: 'GitHubOidcSubject' });
  const policies = Object.values(identity.findResources('AWS::IAM::Policy')) as any[];
  const statements = policies.flatMap(p => p.Properties.PolicyDocument.Statement);
  assert.equal(statements.length, 1);
  assert.equal(statements[0].Action, 'sts:AssumeRole');
  assert.equal(statements[0].Resource.length, 4);
  assert.ok(!JSON.stringify(statements).includes('*'));
});

const event = (path: string, method = 'GET') => ({ path, httpMethod: method, requestContext: { elb: { targetGroupArn: 'test-target' } } } as ALBEvent);
test('static gateway rejects non-ALB events, traversal, unknown routes and mutation methods', async () => {
  assert.equal((await handler({} as ALBEvent)).statusCode, 403);
  for (const route of ['/../index.html', '/api/vehicles', '/favicon.ico']) {
    assert.equal((await handler(event(route))).statusCode, 404);
  }
  assert.equal((await handler(event('/', 'POST'))).statusCode, 405);
  assert.equal((await handler(event('/', 'HEAD'))).body, '');
});

test('served dashboard is no-store with CSP hashes, framing blocked and no event reflection', async () => {
  const result = await handler(event('/'));
  assert.equal(result.statusCode, 200);
  assert.match(result.body!, /IVMS 3.0/);
  assert.equal(result.headers!['cache-control'], 'no-store, max-age=0');
  assert.equal(result.headers!['x-frame-options'], 'DENY');
  const csp = String(result.headers!['content-security-policy']);
  assert.match(csp, /script-src 'sha256-/);
  assert.ok(!csp.split(';').find(x => x.includes('script-src'))!.includes('unsafe-inline'));
});

test('deployment is manual, branch restricted, environment gated and OIDC confined to deploy job', () => {
  const workflow = readFileSync('../.github/workflows/infrastructure-deploy.yml', 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.ok(!/^  (push|pull_request|schedule):/m.test(workflow));
  assert.match(workflow, /refs\/heads\/dev\/zero-trust-aws/);
  assert.match(workflow, /environment: development/);
  assert.equal((workflow.match(/id-token: write/g) ?? []).length, 1);
  assert.match(workflow, /allowed-account-ids:/);
  assert.match(workflow, /cdk deploy IvmsDevelopment --exclusively/);
  for (const uses of workflow.matchAll(/uses: (.+)/g)) assert.match(uses[1], /@[a-f0-9]{40}(?:\s|$)/);
  assert.ok(!workflow.includes('AWS_ACCESS_KEY_ID'));
});
