import * as path from 'node:path';
import {
  CfnOutput, CfnParameter, DefaultStackSynthesizer, Duration, RemovalPolicy, Stack, StackProps,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elb from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as actions from 'aws-cdk-lib/aws-elasticloadbalancingv2-actions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as waf from 'aws-cdk-lib/aws-wafv2';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';

export class DevelopmentStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, { ...props, synthesizer: new DefaultStackSynthesizer({ qualifier: 'ivmsdev01' }) });
    const parameter = (name: string, description: string, allowedPattern: string) =>
      new CfnParameter(this, name, { description, allowedPattern }).valueAsString;
    const domain = parameter('ViewerDomain', 'Dedicated development hostname, e.g. ivms-dev.example.org', '^[a-z0-9][a-z0-9.-]+[a-z0-9]$');
    const originDomain = parameter('OriginDomain', 'Separate development origin hostname with DNS alias to ALB', '^[a-z0-9][a-z0-9.-]+[a-z0-9]$');
    const certificateArn = parameter('CertificateArn', 'Existing us-east-1 ACM certificate covering BOTH viewer and origin hostnames', '^arn:aws:acm:us-east-1:[0-9]{12}:certificate/[a-f0-9-]+$');
    const metadata = parameter('EntraMetadataUrl', 'Tenant/app-specific Entra federation metadata URL', '^https://login\\.microsoftonline\\.com/[a-fA-F0-9-]{36}/federationmetadata/2007-06/federationmetadata\\.xml\\?appid=[a-fA-F0-9-]{36}$');
    const prefixList = parameter('CloudFrontPrefixListId', 'us-east-1 com.amazonaws.global.cloudfront.origin-facing managed prefix list ID', '^pl-[a-f0-9]+$');
    const certificate = acm.Certificate.fromCertificateArn(this, 'Certificate', certificateArn);

    const logBucket = new s3.Bucket(this, 'AccessLogs', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      // Required by legacy CloudFront access log delivery. No public ACLs are allowed.
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
      lifecycleRules: [{ expiration: Duration.days(90) }],
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2, natGateways: 0,
      subnetConfiguration: [{ name: 'ingress', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 }],
    });
    const flowLogs = new logs.LogGroup(this, 'FlowLogs', { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.RETAIN });
    vpc.addFlowLog('Audit', { destination: ec2.FlowLogDestination.toCloudWatchLogs(flowLogs), trafficType: ec2.FlowLogTrafficType.REJECT });
    const sg = new ec2.SecurityGroup(this, 'OriginSecurityGroup', { vpc, allowAllOutbound: false });
    sg.addIngressRule(ec2.Peer.prefixList(prefixList), ec2.Port.tcp(443), 'CloudFront origin-facing network only');
    // ALB managed authentication needs outbound HTTPS to Cognito/token endpoints.
    sg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Managed authentication HTTPS endpoints');
    const alb = new elb.ApplicationLoadBalancer(this, 'Origin', {
      vpc, internetFacing: true, securityGroup: sg,
      dropInvalidHeaderFields: true, deletionProtection: true,
    });
    alb.logAccessLogs(logBucket, 'alb');
    const originKey = new secretsmanager.Secret(this, 'OriginVerification', {
      generateSecretString: { passwordLength: 48, excludePunctuation: true },
    });
    // CF/ALB resource properties resolve this at deployment; the value is never synthesized.
    const secretHeader = originKey.secretValue.unsafeUnwrap();
    const pool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: false,
      signInAliases: { username: true },
      accountRecovery: cognito.AccountRecovery.NONE,
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
      passwordPolicy: { minLength: 16, requireDigits: true, requireLowercase: true, requireUppercase: true, requireSymbols: true },
    });
    const saml = new cognito.UserPoolIdentityProviderSaml(this, 'Entra', {
      userPool: pool, name: 'EntraDevelopment',
      metadata: cognito.UserPoolIdentityProviderSamlMetadata.url(metadata),
      attributeMapping: { email: cognito.ProviderAttribute.other('http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress') },
    });
    const poolDomain = pool.addDomain('Domain', { cognitoDomain: { domainPrefix: `ivms-dev-${this.account}` } });
    const client = pool.addClient('Gateway', {
      generateSecret: true,
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.custom(saml.providerName)],
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      authFlows: { userPassword: false, userSrp: false, adminUserPassword: false, custom: false },
      accessTokenValidity: Duration.minutes(15), idTokenValidity: Duration.minutes(15), refreshTokenValidity: Duration.hours(1),
      oAuth: {
        flows: { authorizationCodeGrant: true, implicitCodeGrant: false },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL],
        callbackUrls: [`https://${domain}/oauth2/idpresponse`],
        logoutUrls: [`https://${domain}/`],
      },
    });
    client.node.addDependency(saml);
    const gatewayLogs = new logs.LogGroup(this, 'GatewayLogs', { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.RETAIN });
    const gateway = new lambda.Function(this, 'GatewayFunction', {
      runtime: lambda.Runtime.NODEJS_22_X, handler: 'handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../gateway')),
      timeout: Duration.seconds(5), memorySize: 128, reservedConcurrentExecutions: 10,
      logGroup: gatewayLogs,
      description: 'Development static dashboard; invoked only by the authenticated ALB target group',
    });
    // CDK's stock LambdaTarget grants the ELB service unscoped invocation.
    // A fixed name allows permission before registration without a CFN cycle.
    // Only the generated target-group ID suffix is wildcarded, within this account.
    const targetGroupName = 'ivms-development-static';
    const invokePermission = new lambda.CfnPermission(this, 'GatewayInvokePermission', {
      action: 'lambda:InvokeFunction', functionName: gateway.functionArn,
      principal: 'elasticloadbalancing.amazonaws.com', sourceAccount: this.account,
      sourceArn: `arn:aws:elasticloadbalancing:us-east-1:${this.account}:targetgroup/${targetGroupName}/*`,
    });
    const targetGroup = new elb.ApplicationTargetGroup(this, 'GatewayTargets', {
      targetGroupName,
      targets: [{ attachToApplicationTargetGroup: () => ({
        targetType: elb.TargetType.LAMBDA, targetJson: { id: gateway.functionArn },
      }) }],
    });
    targetGroup.node.addDependency(invokePermission);
    const listener = alb.addListener('Https', {
      port: 443, certificates: [certificate], open: false,
      sslPolicy: elb.SslPolicy.TLS13_RES,
      defaultAction: elb.ListenerAction.fixedResponse(403, { contentType: 'text/plain', messageBody: 'Forbidden' }),
    });
    listener.addAction('Authenticate', {
      priority: 10,
      conditions: [elb.ListenerCondition.httpHeader('X-Ivms-Origin', [secretHeader]), elb.ListenerCondition.hostHeaders([domain])],
      action: new actions.AuthenticateCognitoAction({
        userPool: pool, userPoolClient: client, userPoolDomain: poolDomain,
        scope: 'openid email', sessionTimeout: Duration.minutes(15),
        sessionCookieName: 'IVMSDevelopmentSession',
        onUnauthenticatedRequest: elb.UnauthenticatedAction.AUTHENTICATE,
        authenticationRequestExtraParams: { identity_provider: saml.providerName },
        next: elb.ListenerAction.forward([targetGroup]),
      }),
    });
    const acl = new waf.CfnWebACL(this, 'WebAcl', {
      scope: 'CLOUDFRONT', defaultAction: { allow: {} },
      visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: 'IvmsDevelopmentWaf', sampledRequestsEnabled: false },
      rules: [{
        name: 'RateLimit', priority: 0, action: { block: {} },
        statement: { rateBasedStatement: { aggregateKeyType: 'IP', limit: 500 } },
        visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: 'RateLimit', sampledRequestsEnabled: false },
      }, {
        name: 'CommonRules', priority: 1,
        overrideAction: { none: {} },
        statement: { managedRuleGroupStatement: { vendorName: 'AWS', name: 'AWSManagedRulesCommonRuleSet' } },
        visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: 'CommonRules', sampledRequestsEnabled: false },
      }],
    });
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      domainNames: [domain], certificate,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      webAclId: acl.attrArn,
      enableLogging: true, logBucket, logFilePrefix: 'cloudfront/', logIncludesCookies: false,
      defaultBehavior: {
        origin: new origins.HttpOrigin(originDomain, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
          originSslProtocols: [cloudfront.OriginSslPolicy.TLS_V1_2],
          customHeaders: { 'X-Ivms-Origin': secretHeader },
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      comment: 'IVMS development only; managed authentication on every request',
    });
    distribution.node.addDependency(listener);
    new cloudwatch.Alarm(this, 'GatewayErrors', {
      metric: gateway.metricErrors(), threshold: 5, evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    new cloudwatch.Alarm(this, 'OriginErrors', {
      metric: alb.metrics.httpCodeElb(elb.HttpCodeElb.ELB_5XX_COUNT), threshold: 5, evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    new CfnOutput(this, 'CloudFrontDomain', { value: distribution.distributionDomainName });
    new CfnOutput(this, 'OriginDnsTarget', { value: alb.loadBalancerDnsName });
    new CfnOutput(this, 'SamlEntityId', { value: `urn:amazon:cognito:sp:${pool.userPoolId}` });
    new CfnOutput(this, 'SamlAcsUrl', { value: `${poolDomain.baseUrl()}/saml2/idpresponse` });
    new CfnOutput(this, 'OriginSecretArn', { value: originKey.secretArn });
  }
}
