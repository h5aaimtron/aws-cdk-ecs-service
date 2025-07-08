import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import { CodeBuildStep, CodePipeline, CodePipelineFileSet } from 'aws-cdk-lib/pipelines';
import { CDKContext } from '../bin/aws-cdk-ecs-service';

interface PipelineStackProps extends cdk.StackProps {
    ecr: any;
    fargateService: any;
    context: CDKContext;
    firstRun: boolean;
}

export class PipelineStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: PipelineStackProps) {
        super(scope, id, props);

        // Build and push the image to ecr.
        const buildProject = new codebuild.PipelineProject(this, `${props.context.serviceName}-${props.context.environment}-build-project`, {
            environment: {
                // Required for docker.
                privileged: true
            },
            buildSpec: codebuild.BuildSpec.fromObject({
                version: '0.2',
                phases: {
                    build: {
                        commands: [
                            'aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $REPOSITORY_URI',
                            'docker build -t $REPOSITORY_URI:latest .', // Replace with your Docker build command
                            'docker tag $REPOSITORY_URI:latest $REPOSITORY_URI:$CODEBUILD_RESOLVED_SOURCE_VERSION',
                        ],
                    },
                    post_build: {
                        commands: [
                            'docker push $REPOSITORY_URI:latest',
                            'docker push $REPOSITORY_URI:$CODEBUILD_RESOLVED_SOURCE_VERSION',
                            'export imageTag=$CODEBUILD_RESOLVED_SOURCE_VERSION',
                            `printf '[{\"name\":\"${props.context.serviceName}-${props.context.environment}-container\",\"imageUri\":\"%s\"}]' $REPOSITORY_URI:$imageTag > imagedefinitions.json`
                        ]
                    }
                },
                env: {
                    "exported-variables": ["imageTag"]
                },
                artifacts: {
                    files: [
                        'imagedefinitions.json',
                        '**/*',
                    ],
                    "secondary-artifacts": {
                        "imagedefinitions": {
                            "files": "imagedefinitions.json",
                            "name": "imagedefinitions"
                        }
                    }
                },
            }),
            environmentVariables: {
                "REPOSITORY_URI": {
                    value: props.ecr.repositoryUri
                }
            }
        });

        // Grant access to ECR Repository from build project.
        props.ecr.grantPullPush(buildProject);

        // Create artifact repos for build.
        const sourceOutput = new codepipeline.Artifact();
        const buildOutput = new codepipeline.Artifact();

        const pipeline = new codepipeline.Pipeline(this, `${props.context.serviceName}-${props.context.environment}-pipeline`);

        // Add Source Stage.
        pipeline.addStage({
            stageName: 'Source',
            actions: [
                new cdk.aws_codepipeline_actions.CodeStarConnectionsSourceAction({
                    actionName: 'Checkout',
                    branch: props.context.repo.branch,
                    connectionArn: props.context.codeStarConnectionArn,
                    output: sourceOutput,
                    owner: props.context.repo.owner,
                    repo: props.context.repo.name
                })
            ],
        });

        // Create Approval Stage for Production only.
        if (props.context.isProd) {
            let approveStage: codepipeline.StageOptions = {
                stageName: 'Approve',
                actions: [
                    new cdk.aws_codepipeline_actions.ManualApprovalAction({
                        actionName: "ApprovalAction"
                    })
                ]
            }
            pipeline.addStage(approveStage);
        }

        // Add build Stage.
        pipeline.addStage({
            stageName: 'BuildImage',
            actions: [
                new codepipeline_actions.CodeBuildAction({
                    actionName: 'Build',
                    project: buildProject,
                    input: sourceOutput,
                    outputs: [buildOutput],
                }),
            ],
        });

        // Add Deploy Stage if service exists.
        if (props.fargateService != null) {
            pipeline.addStage({
                stageName: 'Deploy',
                actions: [
                    new codepipeline_actions.EcsDeployAction({
                        actionName: 'DeployECS',
                        service: props.fargateService.service,
                        input: buildOutput
                    })
                ]
            });
        }

        // Creates self-mutating pipeline.
        const synthPipeline = new CodePipeline(this, `${props.context.serviceName}-${props.context.environment}-synth-pipeline-id`, {
            codePipeline: pipeline,
            synth: new CodeBuildStep('Synth', {
                buildEnvironment: {
                    buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_5
                },
                input: CodePipelineFileSet.fromArtifact(sourceOutput),
                installCommands: ["npm install -g aws-cdk"],
                commands: [
                    'cd infrastructure',
                    'npm ci',
                    'npm run build',
                    'ls',
                    'cdk synth --context ENV_NAME=' + props.context.environment
                ],
                primaryOutputDirectory: "infrastructure/cdk.out"
            })
        });
    }
}