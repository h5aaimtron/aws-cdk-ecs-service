import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { CDKContext } from '../bin/aws-cdk-ecs-service';

interface PrepareStackProps extends cdk.StackProps {
  context: CDKContext
}

/**
 * This stack is used to look up the vpc, create an ecr, and configure the container image.
 */
export class PrepareStack extends cdk.Stack {
  public readonly vpc: ec2.IVpc;
  public readonly ecr: ecr.Repository;
  public readonly appImage: ecs.ContainerImage;

  constructor(scope: Construct, id: string, props: PrepareStackProps) {
    super(scope, id, props);

    // Look up VPC.
    this.vpc = ec2.Vpc.fromLookup(this, `${props.context.appName}-${props.context.environment}-vpc`, {
      ownerAccountId: process.env.CDK_DEFAULT_ACCOUNT,
      vpcName: `${props.context.appName}-${props.context.environment}`
    });

    // Create ECR Repository for application images.
    this.ecr = new ecr.Repository(this, `${props.context.serviceName}-${props.context.environment}-ecr-repo`, {
      removalPolicy: cdk.RemovalPolicy.DESTROY // Do not want to keep ECR upon stack destroy.
    });

    // Get application image from ECR.
    this.appImage = ecs.ContainerImage.fromEcrRepository(this.ecr, 'latest');
  }
}