import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Stack, StackProps, Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { LambdaInsightsVersion, LayerVersion, Tracing } from 'aws-cdk-lib/aws-lambda';

interface ProductsAppStackProps extends StackProps {
  eventsDdb: Table
}

export class ProductsAppStack extends Stack {
  readonly productsFetchHandler: NodejsFunction;
  readonly productsAdminHandler: NodejsFunction;
  readonly productsDdb: Table;

  constructor(scope: Construct, id: string, props: ProductsAppStackProps) {
    super(scope, id, props);

    this.productsDdb = new Table(this, 'ProductsDdb',
      {
        tableName: 'products',
        removalPolicy: RemovalPolicy.DESTROY,
        partitionKey: {
          name: 'id',
          type: AttributeType.STRING
        },
        billingMode: BillingMode.PROVISIONED,
        readCapacity: 1,
        writeCapacity: 1
      }
    );

    // Products Layer
    const productsLayerArn = StringParameter
      .valueForStringParameter(this, 'ProductsLayerVersionArn');
    const productsLayer = LayerVersion
      .fromLayerVersionArn(this, 'ProductsLayerVersionArn', productsLayerArn);

    // Products Events Layer
    const productsEventsLayerArn = StringParameter
      .valueForStringParameter(this, 'ProductsEventsLayerVersionArn');
    const productsEventsLayer = LayerVersion
      .fromLayerVersionArn(this, 'ProductsEventsLayerVersionArn', productsEventsLayerArn);
    
    const productsEventsHandler = new NodejsFunction(this, 'ProductsEventsFunction',
      {
        functionName: 'ProductsEventsFunction',
        entry: 'lambda/products/productsEventsFunction.ts',
        handler: 'handler',
        memorySize: 128,
        timeout: Duration.seconds(2),
        bundling: {
          minify: true,
          sourceMap: false
        },
        environment: {
          EVENTS_DDB: props.eventsDdb.tableName
        },
        layers: [productsEventsLayer],
        tracing: Tracing.ACTIVE,
        insightsVersion: LambdaInsightsVersion.VERSION_1_0_119_0
      }
    );
    props.eventsDdb.grantWriteData(productsEventsHandler);

    this.productsFetchHandler = new NodejsFunction(this, 'ProductsFetchFunction',
      {
        functionName: 'ProductsFetchFunction',
        entry: 'lambda/products/productsFetchFunction.ts',
        handler: 'handler',
        memorySize: 128,
        timeout: Duration.seconds(5),
        bundling: {
          minify: true,
          sourceMap: false
        },
        environment: {
          PRODUCTS_DDB: this.productsDdb.tableName
        },
        layers: [productsLayer],
        tracing: Tracing.ACTIVE,
        insightsVersion: LambdaInsightsVersion.VERSION_1_0_119_0
      }
    );
    this.productsDdb.grantReadData(this.productsFetchHandler);
    
    this.productsAdminHandler = new NodejsFunction(this, 'ProductsAdminFunction',
      {
        functionName: 'ProductsAdminFunction',
        entry: 'lambda/products/productsAdminFunction.ts',
        handler: 'handler',
        memorySize: 128,
        timeout: Duration.seconds(5),
        bundling: {
          minify: true,
          sourceMap: false
        },
        environment: {
          PRODUCTS_DDB: this.productsDdb.tableName,
          PRODUCTS_EVENTS_FUNCTION_NAME: productsEventsHandler.functionName
        },
        layers: [productsLayer, productsEventsLayer],
        tracing: Tracing.ACTIVE,
        insightsVersion: LambdaInsightsVersion.VERSION_1_0_119_0
      }
    );
    this.productsDdb.grantWriteData(this.productsAdminHandler);
    productsEventsHandler.grantInvoke(this.productsAdminHandler);
  }
}