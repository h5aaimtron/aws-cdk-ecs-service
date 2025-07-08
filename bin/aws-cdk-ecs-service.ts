#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { PrepareStack } from '../lib/prepare-stack';
import { RdsStack } from '../lib/rds-stack';
import { EcsStack } from '../lib/ecs-stack';
import { PipelineStack } from '../lib/pipeline-stack';

const app = new cdk.App();
const envName: string = app.node.tryGetContext('ENV_NAME') || 'dev';

// Retrieve global and environment configurations to create a context.
const envConfig = app.node.tryGetContext(envName);
const globalConfig = app.node.tryGetContext('globals');
const context: CDKContext = { ...globalConfig, ...envConfig };

console.log("Building " + context.appName + "'s service " + context.serviceName + " in " + context.environment);

// Get VPC, ECR, and app image.
const prepareStack = new PrepareStack(app, `${context.appName}-${context.serviceName}-${context.environment}-stack`, {
  /* If you don't specify 'env', this stack will be environment-agnostic.
   * Account/Region-dependent features and context lookups will not work,
   * but a single synthesized template can be deployed anywhere. */

  /* Uncomment the next line to specialize this stack for the AWS Account
   * and Region that are implied by the current CLI configuration. */
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },

  /**
   * Pass in the cdk context information from cdk.json
   */
  context: context

  /* Uncomment the next line if you know exactly what Account and Region you
   * want to deploy the stack to. */
  // env: { account: '123456789012', region: 'us-east-1' },

  /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */
});

// Create RDS Instance. (Creates a MySQL instance, but can be configured for any.)
const rdsStack = new RdsStack(app, `${context.serviceName}-${context.environment}-rds-stack`, {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  vpc: prepareStack.vpc,
  context: context
});

// Create ECS Fargate Service and grant access to RDS instance.
//const ecsService = null;
const ecsService = new EcsStack(app, `${context.serviceName}-${context.environment}-ecs-stack`, {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  vpc: prepareStack.vpc,
  appImage: prepareStack.appImage,
  mysqlInstance: rdsStack.dbInstance,
  context: context
});

// Create pipeline.
const pipeline = new PipelineStack(app, `${context.serviceName}-${context.environment}-pipeline-stack`, {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  ecr: prepareStack.ecr,
  fargateService: ecsService.fargateService,
  context: context,
  firstRun: false
});

/**
 * Define tags for infrastructure within the stack.
 */
cdk.Tags.of(app).add("organization", "YourOrg");
cdk.Tags.of(app).add("department", "YourDept");
cdk.Tags.of(app).add("team", "YourTeam");
cdk.Tags.of(app).add("app", "Environments");
cdk.Tags.of(app).add("contact", "Your@EmailAddress.com");
cdk.Tags.of(app).add("github", context.repo.owner + "/" + context.repo.name);

/**
 * CDK Context (cdk.json)
 */
export type CDKContext = {
  appName: string;
  serviceName: string;
  region: string;
  environment: string;
  isProd: boolean;
  domain: string;
  subdomain: string,
  codeStarConnectionArn: string;
  repo: {
    owner: string,
    name: string,
    branch: string
  },
  scaling: {
    min: number,
    max: number
  },
  database: {
    dbName: string,
    dbAdmin: string
  }
}