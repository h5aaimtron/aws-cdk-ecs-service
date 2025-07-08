import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecs_patterns from "aws-cdk-lib/aws-ecs-patterns";
import * as iam from 'aws-cdk-lib/aws-iam';
import { HostedZone } from 'aws-cdk-lib/aws-route53';
import * as sm from 'aws-cdk-lib/aws-secretsmanager';
import { CDKContext } from '../bin/aws-cdk-ecs-service';

interface EcsStackProps extends cdk.StackProps {
    vpc: ec2.IVpc;
    appImage: any;
    mysqlInstance: any;
    context: CDKContext
}

export class EcsStack extends cdk.Stack {
    public readonly fargateService: ecs_patterns.ApplicationLoadBalancedFargateService;


    constructor(scope: Construct, id: string, props: EcsStackProps) {
        super(scope, id, props);

        /**
         * Construct a full domain name. We utilize a lot of sub-domains, so this has been separated.
         * This can be modified to handle top level or subs.
         */
        const domainName = props.context.subdomain + '.' + props.context.domain;

        // Get Managed Execution Policy and Role
        const executionPolicy = iam.ManagedPolicy.fromManagedPolicyArn(this, `${props.context.serviceName}-${props.context.environment}-execution-policy`, "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy");
        const executionRole = new iam.Role(this, `${props.context.serviceName}-${props.context.environment}-execution-role`, {
            assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
            managedPolicies: [executionPolicy]
        });

        /**
         * Looks up the cluster we made from the environment repository.
         * Worth noting, the returned value does not contain all information
         * about the cluster. Under the hood, this is a JSON representation of
         * the cluster and many keys are truncated.
         */
        const cluster = ecs.Cluster.fromClusterAttributes(this, `${props.context!.appName}-${props.context.environment}-cluster`, {
            vpc: props.vpc,
            clusterName: `${props.context.appName}-${props.context.environment}`
        });

        // Look up hosted zone.
        const hostedZone = HostedZone.fromLookup(this, props.context.domain, {
            domainName: props.context.domain,
            privateZone: false,
        });

        /**
         * If you are not utilizing CloudFront, you can direclty utilize ACM
         * to manage the certificate within a single region. Workloads that 
         * are cross-regional and/or utilizing the CDN require the certificate
         * to be created in us-east-1.
         */
        const certificate = new acm.Certificate(this, `${props.context.serviceName}-${props.context.environment}-certificate`, {
            domainName: domainName,
            certificateName: `${props.context.serviceName}-${props.context.environment}`,
            validation: acm.CertificateValidation.fromDns(hostedZone),
        });

        // Create Task Definition.
        const taskDef = new ecs.FargateTaskDefinition(this, `${props.context.serviceName}-${props.context.environment}-taskdef`, {
            cpu: 256,
            memoryLimitMiB: 512,
            executionRole: executionRole
        });

        // Grant access to RDS.
        props.mysqlInstance.secret!.grantRead(taskDef.executionRole);

        // Create Container definition.
        const container = taskDef.addContainer(`${props.context.serviceName}-${props.context.environment}-container`, {
            image: props.appImage,
            environment: {
                PLATFORM_ENV: `${props.context.environment}`
            },
            secrets: {
                DB_INSTANCE_SECRET: ecs.Secret.fromSecretsManager(props.mysqlInstance.secret!) // Useful for letting the container know what environment its running in.
            },
            logging: ecs.LogDriver.awsLogs({ streamPrefix: 'ecs' }),
            readonlyRootFilesystem: true // Containers are transient and as such, should not write, even to tmp files/folders. 
        });

        /**
         * This is the specific port .NET 8+ runs on within a container. Your port 
         * may vary. This is not the external port, but the port the ALB will use
         * to connect to the container.
         */
        container.addPortMappings({
            containerPort: 8080
        });


        // Create a load-balanced Fargate service and make it public
        const albFargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, `${props.context.serviceName}-${props.context.environment}-service`, {
            cluster: cluster,
            taskDefinition: taskDef,
            certificate: certificate,
            listenerPort: 443, // Set the listening port of the ALB (https)
            domainName: domainName,
            domainZone: hostedZone,
            publicLoadBalancer: true,
            taskSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS // Tasks should ideally be deployed within the private subnets.
            }
        });



        // Configure health check. Our .NET apps use the /api/healthcheck path
        // which returns a generic 200 response. This can be any accessible 
        // path not requiring authz.
        albFargateService.targetGroup.configureHealthCheck({
            path: '/api/healthcheck',
            port: '8080',
            healthyHttpCodes: '200-299',
            interval: cdk.Duration.seconds(60)
        });

        // Configure Auto-Scaling (only in production)
        if (props.context.isProd) {
            // Minimum is almost always at least 1 container running. Context can be extended to track max capacity.
            const scaling = albFargateService.service.autoScaleTaskCount({ minCapacity: props.context.scaling.min, maxCapacity: props.context.scaling.max });
            scaling.scaleOnCpuUtilization('cpuScaling', {
                targetUtilizationPercent: 75,
                scaleInCooldown: cdk.Duration.seconds(60),
                scaleOutCooldown: cdk.Duration.seconds(60)
            });
            scaling.scaleOnMemoryUtilization('memoryScaling', {
                targetUtilizationPercent: 75,
                scaleInCooldown: cdk.Duration.seconds(60),
                scaleOutCooldown: cdk.Duration.seconds(60)
            });
        }

        // Grant access to SES (Send Email)
        albFargateService.taskDefinition.addToTaskRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                "ses:SendEmail",
                "ses:SendRawEmail",
                "ses:SendTemplatedEmail"
            ],
            resources: ["*"], // You can be scoped down to specific verified identities or templates.
        }));

        // Set property to pass.
        this.fargateService = albFargateService;
    }
}
