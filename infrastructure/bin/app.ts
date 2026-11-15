import { App, Tags } from 'aws-cdk-lib';
import { DevelopmentStack } from '../lib/development-stack';
import { DeploymentIdentityStack } from '../lib/deployment-identity-stack';

const app = new App();
// Fixed region: CloudFront WAF and the viewer ACM certificate require us-east-1.
// Account-agnostic synthesis performs no AWS lookups or credential discovery.
new DevelopmentStack(app, 'IvmsDevelopment', { env: { region: 'us-east-1' } });
new DeploymentIdentityStack(app, 'IvmsDevelopmentIdentity', { env: { region: 'us-east-1' } });
Tags.of(app).add('Application', 'IVMS-3.0');
Tags.of(app).add('Environment', 'development');
