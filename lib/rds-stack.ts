import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from 'aws-cdk-lib/aws-rds';
import { DatabaseInstance, DatabaseInstanceEngine, InstanceType, MysqlEngineVersion, StorageType } from 'aws-cdk-lib/aws-rds';
import { CDKContext } from '../bin/aws-cdk-ecs-service';

interface RdsStackProps extends cdk.StackProps {
    vpc: ec2.IVpc;
    context: CDKContext
}

export class RdsStack extends cdk.Stack {
    public readonly dbInstance: rds.DatabaseInstance;

    constructor(scope: Construct, id: string, props: RdsStackProps) {
        super(scope, id, props);

        // Create the database security group.
        const dbSecurityGroup = new ec2.SecurityGroup(this, `${props.context.serviceName}-${props.context.environment}-db-sg`, {
            vpc: props.vpc,
            description: 'Allow MySQL Access',
            allowAllOutbound: false // Don't want our rds instance communicating with the outside world.
        });

        /**
         * Allow resources within the vpc to connect. This can be further restricted depending on
         * your requirements and security posture.
         */
        dbSecurityGroup.addIngressRule(
            ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
            ec2.Port.tcp(3306),
            'Allow MySQL Access from within VPC'
        );

        /**
         * This creates an auto-generated set of credentials used to secure the RDS instance.
         * The credentials will be placed inside the secret within the secrets manager.
         */
        const dbCredentials = rds.Credentials.fromGeneratedSecret(props.context.database.dbAdmin, {
            secretName: `${props.context.serviceName}-${props.context.environment}-rds`
        });

        // Create database instance
        this.dbInstance = new DatabaseInstance(this, `${props.context.serviceName}-${props.context.environment}-rds`, {
            engine: DatabaseInstanceEngine.mysql({
                version: MysqlEngineVersion.VER_8_0_39 // Set the engine you want to utilize.
            }),
            vpc: props.vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
            multiAz: true,
            allocatedStorage: 20,
            storageType: StorageType.GP2,
            credentials: dbCredentials,
            databaseName: props.context.database.dbName,
            securityGroups: [dbSecurityGroup],
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            deletionProtection: props.context.environment == "production" ? true : false, // Example of how you can handle different settings per environment.
            publiclyAccessible: false, // Should never be publically accessible.
            port: 3306,
        });
    }
}