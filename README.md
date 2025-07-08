# This is a SampleAPP to deploy to AWS ECS via CDK

All infrastructure code can be found in the `/infrastrcture` folder.

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `npx cdk deploy`  deploy this stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth`   emits the synthesized CloudFormation template

## Stack Deployment

There is a bit of a chicken or the egg issue on initial deployment. The PrepareStack (prepare-stack.ts) provisions ECR for the task definition, however; no image exists in ECR. Due to this lack of image, the ECSStack (ecs-stack.ts) will fail as it has no image to pull and deploy. There are 2 solutions that could work here, but one that we currently utilize. The first issue (not the one we're doing) would be to create a lambda or a script to push a local image from your dev machine to ECR after ECR creation. This works as the overall stack will take time to provision RDS, but if you're not planning to use RDS, this probably won't work for you. The solution we prefer at this time is to comment out the ecsService reference in the aws-cdk-ecs-service.ts in `/bin` folder and setting ecsService = null. The deployment will then provision everything except the ECS Service/Task/Container. Once provisioned, run the pipeline which will build and push your image to ECR, then uncomment the ecsService stack code so its no longer null and commit/run the pipeline again. This will cause the ECS Service/Task/Container to be created and it will pull the image form the previous step.

`cdk synth --all --context ENV_NAME=production`   This is an example of synthesizing the production code.
`cdk deploy --all --context ENV_NAME=production`  This is an example of deploying the production code.

Synth and Deploy utilize the AWS CLI under the hood, so make sure you've set the appropriate AWS CLI profile prior to running the command(s).

## Infrastructure Description

This particular stack provisions common infrastructure for a backend web service or api. This includes an ECS Service running on Fargate, a MySQL RDS instance, ECR for container image storage, and a pipeline that handles both application build/deploy as well as service-specific infrastructure changes. This service relies on the aws-cdk-ecs-environments repository in that it requires an environment created by that repository.

There are specific conventions within the ecs-stack.ts file that define configurations for the SampleApp included (.NET 8). These values are likely not valid for other languages and frameworks, ex: .NET uses port 8080 for the container port, your choosen tech stack may not. Additionally, the health check is configured how we have utilized it, but may be different depending on your use.

* Note: If re-using existing infrastructure (Pre-existing VPC w/subnets), code for creating the VPC can be changed to instead look up a vpc by name or arn.

## CDK Context Configuration (cdk.json)

General parameters for build and deploy are stored within the cdk.json and imported into the CDKContext object. Currently this information encompasses appName (think product/product pod/team name). For those migrating from AWS Copilot, this would be the equivalent of the APP in copilot. For instance, if I were a financial system, I might set my appName to finance. This is used to create meaningful stack IDs and infrastructure object IDs (Ex: finance-qa-ecs-cluster). The serviceName field best aligns with the name in copilot given to the web-service/scheduled job/etc. Tagging is "global" within the stack. Tags can be set in the aws-cdk-environment.ts file under /bin.

"globals" contains the appName, serviceName, and region you're operating out of for this particular product. "baseDir" is a hold over for single page applications and is not utilized within this particular repo or stack.

The next section entails the various environments you may wish to deploy. "production" for instance, has the environment name "production", has a flag isProd (used for turning on pipeline release approvals), a code star connection Arn (assumed you've set this up outside of this work), and the GitHub repository information that the codestar connection has access. This last bit of information to to create stack-specific pipelines that are self-mutating. This means, as you modify your stacks, the pipeline can detect the stack change and apply those changes without requiring redeployment from the cli.

* Note: Some infrastructure is considered immutable (VPC). This means these resources cannot be changed after provisioning and will result in build fails when applying change sets. 