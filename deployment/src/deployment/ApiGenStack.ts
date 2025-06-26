import {App, Stack} from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import {
     TYPES,
     ENUMS,
     DiscoveryServiceDefaultData,
     DiscoveryServiceConfigurator,
     AwsServerlessStackBase,
} from "@cny-common/aws.cdk.ts";

export class ApiGenStack extends AwsServerlessStackBase {
     protected apiGatewayObj: TYPES.GateWayGroup;
     protected stackObj: {
          [gatewayGroup: string]: TYPES.GateWayGroup;
     };
     constructor(scope: App, id: string, props: {inputData: TYPES.ExtendedGroupEndpoints; dependsOn?: Stack[]}) {
          super(scope, id, {
               env: {
                    region: process.env.CDK_DEFAULT_REGION,
                    account: process.env.CDK_DEFAULT_ACCOUNT,
               },
          });
          const {inputData} = props;

          this.defaultData = new DiscoveryServiceDefaultData(inputData);
          this.defaultData.initializeValues();

          this.lambdaDeploymentType = ENUMS.LambdaCreationType.Asset;

          this.stackObj = Object.values(inputData)[0];
          this.apiGatewayObj = Object.values(this.stackObj)[0];
          this.productShortName = this.apiGatewayObj.productShortName.toLowerCase();
          this.orgShortName = this.apiGatewayObj.orgShortName?.toLowerCase();
          this.cors = this.apiGatewayObj["cors"];
          this.stage = this.apiGatewayObj.stage;
          this.apiGatewayName = `${Object.keys(this.stackObj)[0]}`;
          this.resourceName = this.apiGatewayObj.endpointsInfoArray[0].resourceName;
          this.dsConfigurator = new DiscoveryServiceConfigurator({
               parentStack: this,
               stage: this.stage!,
               resourceName: this.resourceName,
               productShortName: this.productShortName,
               orgShortName: this.orgShortName,
               discoveryTablePrefix: "root",
          });
          this.endpoints = this.apiGatewayObj.endpointsInfoArray;
          this.isAuthorizationExists = this.apiGatewayObj.features[ENUMS.ApiFeatures.Authorization];
          this.mappingDomainSubDomainPrefix = `${
               this.apiGatewayObj.serverUrlSubDomain ? `${this.apiGatewayObj.serverUrlSubDomain}-` : ""
          }`;
          this.mappingDomain = `${this.mappingDomainSubDomainPrefix}${this.stage}.${this.apiGatewayObj.serverUrl!}`;
     }

     async doDeployment(): Promise<void> {
          const {stage} = this;

          const dynamodbTable = await this.createDynamodbTable(this.resourceName, {
               pk: dynamodb.AttributeType.STRING,
               sk: dynamodb.AttributeType.STRING,
          });

          if (this.isAuthorizationExists) {
               // Authorizer
               this.authorizerLambdaPath = `${handlersPath}/authorizer/src`;
               this.authorizerEnvironment = {
                    stage: stage!,
               };
          }

          await this.createApiGateway();

          const lambdaRole = new iam.Role(this, "LambdaRole-SystemManagerGetAccess", {
               assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
          });

          lambdaRole.addToPolicy(
               new iam.PolicyStatement({
                    resources: ["*"],
                    actions: ["ssm:GetParameter", "logs:*"],
               })
          );
          

          lambdaRole.addToPolicy(
               new iam.PolicyStatement({
                    actions: ["dynamodb:*"],
                    resources: [dynamodbTable.tableArn],
               })
          );

          this.endpoints.forEach(async (endpoint) => {
               const environment = {
                    STAGE: this.stage!,
                    DEFAULT_DYNAMODB_TABLE_NAME: dynamodbTable.tableName,
               };

               const lambdaPath = `${handlersPath}/${endpoint.serviceMethodName}/src`;

               await this.createNodejsLambda({
                    endpoint,
                    environment,
                    lambdaPath,
                    awsResourceObj: {
                         goals: dynamodbTable,
                    },
                    lambdaRole,
                    disableAuthorizer: endpoint.disableAuthorizer,
               });
          });
     }
}
