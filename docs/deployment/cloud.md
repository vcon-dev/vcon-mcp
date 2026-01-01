# Cloud Provider Deployment

Deploy vCon MCP Server to major cloud providers with managed container services.

## AWS

### Amazon ECS (Fargate)

#### Task Definition

```json
{
  "family": "vcon-mcp",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::YOUR_ACCOUNT:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::YOUR_ACCOUNT:role/vconMcpTaskRole",
  "containerDefinitions": [
    {
      "name": "vcon-mcp",
      "image": "public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main",
      "essential": true,
      "portMappings": [
        {
          "containerPort": 3000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {"name": "MCP_HTTP_STATELESS", "value": "true"},
        {"name": "MCP_HTTP_HOST", "value": "0.0.0.0"},
        {"name": "MCP_HTTP_PORT", "value": "3000"},
        {"name": "MCP_TOOLS_PROFILE", "value": "full"}
      ],
      "secrets": [
        {
          "name": "SUPABASE_URL",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:YOUR_ACCOUNT:secret:vcon-mcp/supabase-url"
        },
        {
          "name": "SUPABASE_SERVICE_ROLE_KEY",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:YOUR_ACCOUNT:secret:vcon-mcp/supabase-service-role-key"
        },
        {
          "name": "SUPABASE_ANON_KEY",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:YOUR_ACCOUNT:secret:vcon-mcp/supabase-anon-key"
        },
        {
          "name": "OPENAI_API_KEY",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:YOUR_ACCOUNT:secret:vcon-mcp/openai-api-key"
        }
      ],
      "healthCheck": {
        "command": ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://localhost:3000/api/v1/health || exit 1"],
        "interval": 30,
        "timeout": 10,
        "retries": 3,
        "startPeriod": 15
      },
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/vcon-mcp",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
```

#### Create Service with CLI

```bash
# Create secrets
aws secretsmanager create-secret \
  --name vcon-mcp/supabase-url \
  --secret-string "https://your-project.supabase.co"

aws secretsmanager create-secret \
  --name vcon-mcp/supabase-service-role-key \
  --secret-string "your-service-role-key"

aws secretsmanager create-secret \
  --name vcon-mcp/supabase-anon-key \
  --secret-string "your-anon-key"

# Register task definition
aws ecs register-task-definition --cli-input-json file://task-definition.json

# Create service
aws ecs create-service \
  --cluster your-cluster \
  --service-name vcon-mcp \
  --task-definition vcon-mcp \
  --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx],securityGroups=[sg-xxx],assignPublicIp=ENABLED}"
```

#### CloudFormation Template

```yaml
# cloudformation-vcon-mcp.yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: vCon MCP Server on ECS Fargate

Parameters:
  VpcId:
    Type: AWS::EC2::VPC::Id
  SubnetIds:
    Type: List<AWS::EC2::Subnet::Id>
  SupabaseUrl:
    Type: String
    NoEcho: true
  SupabaseServiceRoleKey:
    Type: String
    NoEcho: true
  SupabaseAnonKey:
    Type: String
    NoEcho: true

Resources:
  ECSCluster:
    Type: AWS::ECS::Cluster
    Properties:
      ClusterName: vcon-mcp-cluster

  LogGroup:
    Type: AWS::Logs::LogGroup
    Properties:
      LogGroupName: /ecs/vcon-mcp
      RetentionInDays: 30

  TaskExecutionRole:
    Type: AWS::IAM::Role
    Properties:
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal:
              Service: ecs-tasks.amazonaws.com
            Action: sts:AssumeRole
      ManagedPolicyArns:
        - arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
      Policies:
        - PolicyName: SecretsAccess
          PolicyDocument:
            Version: '2012-10-17'
            Statement:
              - Effect: Allow
                Action:
                  - secretsmanager:GetSecretValue
                Resource: !Sub 'arn:aws:secretsmanager:${AWS::Region}:${AWS::AccountId}:secret:vcon-mcp/*'

  TaskDefinition:
    Type: AWS::ECS::TaskDefinition
    Properties:
      Family: vcon-mcp
      NetworkMode: awsvpc
      RequiresCompatibilities:
        - FARGATE
      Cpu: '512'
      Memory: '1024'
      ExecutionRoleArn: !GetAtt TaskExecutionRole.Arn
      ContainerDefinitions:
        - Name: vcon-mcp
          Image: public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main
          PortMappings:
            - ContainerPort: 3000
          Environment:
            - Name: MCP_HTTP_STATELESS
              Value: 'true'
          Secrets:
            - Name: SUPABASE_URL
              ValueFrom: !Ref SupabaseUrlSecret
            - Name: SUPABASE_SERVICE_ROLE_KEY
              ValueFrom: !Ref SupabaseServiceRoleKeySecret
            - Name: SUPABASE_ANON_KEY
              ValueFrom: !Ref SupabaseAnonKeySecret
          LogConfiguration:
            LogDriver: awslogs
            Options:
              awslogs-group: !Ref LogGroup
              awslogs-region: !Ref AWS::Region
              awslogs-stream-prefix: ecs

  SupabaseUrlSecret:
    Type: AWS::SecretsManager::Secret
    Properties:
      Name: vcon-mcp/supabase-url
      SecretString: !Ref SupabaseUrl

  SupabaseServiceRoleKeySecret:
    Type: AWS::SecretsManager::Secret
    Properties:
      Name: vcon-mcp/supabase-service-role-key
      SecretString: !Ref SupabaseServiceRoleKey

  SupabaseAnonKeySecret:
    Type: AWS::SecretsManager::Secret
    Properties:
      Name: vcon-mcp/supabase-anon-key
      SecretString: !Ref SupabaseAnonKey

  SecurityGroup:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupDescription: vCon MCP Server Security Group
      VpcId: !Ref VpcId
      SecurityGroupIngress:
        - IpProtocol: tcp
          FromPort: 3000
          ToPort: 3000
          CidrIp: 0.0.0.0/0

  Service:
    Type: AWS::ECS::Service
    Properties:
      ServiceName: vcon-mcp
      Cluster: !Ref ECSCluster
      TaskDefinition: !Ref TaskDefinition
      DesiredCount: 2
      LaunchType: FARGATE
      NetworkConfiguration:
        AwsvpcConfiguration:
          AssignPublicIp: ENABLED
          Subnets: !Ref SubnetIds
          SecurityGroups:
            - !Ref SecurityGroup

Outputs:
  ClusterArn:
    Value: !GetAtt ECSCluster.Arn
  ServiceName:
    Value: !Ref Service
```

### AWS App Runner

```yaml
# apprunner.yaml
version: 1.0
runtime: docker
build:
  commands:
    build:
      - echo "Using pre-built image"
run:
  runtime-version: 20
  command: node /app/dist/index.js
  network:
    port: 3000
    env: MCP_HTTP_PORT
  env:
    - name: MCP_HTTP_STATELESS
      value: "true"
    - name: MCP_HTTP_HOST
      value: "0.0.0.0"
```

```bash
# Deploy via CLI
aws apprunner create-service \
  --service-name vcon-mcp \
  --source-configuration '{
    "ImageRepository": {
      "ImageIdentifier": "public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main",
      "ImageRepositoryType": "ECR_PUBLIC",
      "ImageConfiguration": {
        "Port": "3000",
        "RuntimeEnvironmentVariables": {
          "MCP_HTTP_STATELESS": "true",
          "SUPABASE_URL": "https://your-project.supabase.co"
        }
      }
    }
  }'
```

---

## Google Cloud Platform

### Cloud Run

```bash
# Deploy to Cloud Run
gcloud run deploy vcon-mcp \
  --image public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main \
  --platform managed \
  --region us-central1 \
  --port 3000 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 1 \
  --max-instances 10 \
  --set-env-vars "MCP_HTTP_STATELESS=true,MCP_HTTP_HOST=0.0.0.0" \
  --set-secrets "SUPABASE_URL=vcon-supabase-url:latest,SUPABASE_SERVICE_ROLE_KEY=vcon-supabase-key:latest,SUPABASE_ANON_KEY=vcon-supabase-anon-key:latest"
```

#### Cloud Run YAML

```yaml
# service.yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: vcon-mcp
  annotations:
    run.googleapis.com/ingress: all
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/minScale: '1'
        autoscaling.knative.dev/maxScale: '10'
    spec:
      containerConcurrency: 100
      timeoutSeconds: 300
      containers:
      - image: public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main
        ports:
        - containerPort: 3000
        env:
        - name: MCP_HTTP_STATELESS
          value: "true"
        - name: MCP_HTTP_HOST
          value: "0.0.0.0"
        - name: SUPABASE_URL
          valueFrom:
            secretKeyRef:
              name: vcon-supabase-url
              key: latest
        - name: SUPABASE_SERVICE_ROLE_KEY
          valueFrom:
            secretKeyRef:
              name: vcon-supabase-key
              key: latest
        - name: SUPABASE_ANON_KEY
          valueFrom:
            secretKeyRef:
              name: vcon-supabase-anon-key
              key: latest
        resources:
          limits:
            memory: 512Mi
            cpu: '1'
```

```bash
# Create secrets first
echo -n "https://your-project.supabase.co" | gcloud secrets create vcon-supabase-url --data-file=-
echo -n "your-service-role-key" | gcloud secrets create vcon-supabase-key --data-file=-
echo -n "your-anon-key" | gcloud secrets create vcon-supabase-anon-key --data-file=-

# Deploy
gcloud run services replace service.yaml --region us-central1
```

### Google Kubernetes Engine (GKE)

Use the standard [Kubernetes manifests](./kubernetes.md) with GKE-specific annotations:

```yaml
# Add to deployment metadata
annotations:
  cloud.google.com/neg: '{"ingress": true}'
```

---

## Microsoft Azure

### Azure Container Apps

```bash
# Create Container App
az containerapp create \
  --name vcon-mcp \
  --resource-group myResourceGroup \
  --environment myEnvironment \
  --image public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main \
  --target-port 3000 \
  --ingress external \
  --cpu 0.5 \
  --memory 1.0Gi \
  --min-replicas 1 \
  --max-replicas 10 \
  --secrets supabase-url=secretref:supabase-url,supabase-key=secretref:supabase-key,supabase-anon-key=secretref:supabase-anon-key \
  --env-vars \
    MCP_HTTP_STATELESS=true \
    MCP_HTTP_HOST=0.0.0.0 \
    SUPABASE_URL=secretref:supabase-url \
    SUPABASE_SERVICE_ROLE_KEY=secretref:supabase-key \
    SUPABASE_ANON_KEY=secretref:supabase-anon-key
```

#### Bicep Template

```bicep
// main.bicep
param location string = resourceGroup().location
param containerAppName string = 'vcon-mcp'
param supabaseUrl string
@secure()
param supabaseServiceRoleKey string
@secure()
param supabaseAnonKey string

resource containerAppEnvironment 'Microsoft.App/managedEnvironments@2023-05-01' = {
  name: '${containerAppName}-env'
  location: location
  properties: {}
}

resource containerApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: containerAppName
  location: location
  properties: {
    managedEnvironmentId: containerAppEnvironment.id
    configuration: {
      ingress: {
        external: true
        targetPort: 3000
        transport: 'http'
      }
      secrets: [
        {
          name: 'supabase-url'
          value: supabaseUrl
        }
        {
          name: 'supabase-service-role-key'
          value: supabaseServiceRoleKey
        }
        {
          name: 'supabase-anon-key'
          value: supabaseAnonKey
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'vcon-mcp'
          image: 'public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main'
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            {
              name: 'MCP_HTTP_STATELESS'
              value: 'true'
            }
            {
              name: 'MCP_HTTP_HOST'
              value: '0.0.0.0'
            }
            {
              name: 'SUPABASE_URL'
              secretRef: 'supabase-url'
            }
            {
              name: 'SUPABASE_SERVICE_ROLE_KEY'
              secretRef: 'supabase-service-role-key'
            }
            {
              name: 'SUPABASE_ANON_KEY'
              secretRef: 'supabase-anon-key'
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 10
        rules: [
          {
            name: 'http-scaling'
            http: {
              metadata: {
                concurrentRequests: '100'
              }
            }
          }
        ]
      }
    }
  }
}

output fqdn string = containerApp.properties.configuration.ingress.fqdn
```

### Azure Container Instances (ACI)

```bash
# Quick deployment with ACI
az container create \
  --resource-group myResourceGroup \
  --name vcon-mcp \
  --image public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main \
  --dns-name-label vcon-mcp \
  --ports 3000 \
  --cpu 1 \
  --memory 1 \
  --environment-variables \
    MCP_HTTP_STATELESS=true \
    MCP_HTTP_HOST=0.0.0.0 \
  --secure-environment-variables \
    SUPABASE_URL=https://your-project.supabase.co \
    SUPABASE_SERVICE_ROLE_KEY=your-key \
    SUPABASE_ANON_KEY=your-anon-key
```

---

## DigitalOcean

### App Platform

```yaml
# .do/app.yaml
name: vcon-mcp
services:
- name: vcon-mcp
  image:
    registry_type: DOCKER_HUB
    registry: public.ecr.aws
    repository: r4g1k2s3/vcon-dev/vcon-mcp
    tag: main
  http_port: 3000
  instance_count: 2
  instance_size_slug: basic-xs
  envs:
  - key: MCP_HTTP_STATELESS
    value: "true"
  - key: MCP_HTTP_HOST
    value: "0.0.0.0"
  - key: SUPABASE_URL
    type: SECRET
    value: EV[SUPABASE_URL]
  - key: SUPABASE_SERVICE_ROLE_KEY
    type: SECRET
    value: EV[SUPABASE_SERVICE_ROLE_KEY]
  - key: SUPABASE_ANON_KEY
    type: SECRET
    value: EV[SUPABASE_ANON_KEY]
  health_check:
    http_path: /api/v1/health
    initial_delay_seconds: 10
    period_seconds: 30
```

```bash
doctl apps create --spec .do/app.yaml
```

---

## Fly.io

```toml
# fly.toml
app = "vcon-mcp"
primary_region = "iad"

[build]
  image = "public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main"

[env]
  MCP_HTTP_STATELESS = "true"
  MCP_HTTP_HOST = "0.0.0.0"
  MCP_HTTP_PORT = "8080"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 1

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 512
```

```bash
# Set secrets
fly secrets set SUPABASE_URL=https://your-project.supabase.co
fly secrets set SUPABASE_SERVICE_ROLE_KEY=your-key
fly secrets set SUPABASE_ANON_KEY=your-anon-key

# Deploy
fly deploy
```

---

## Railway

```json
// railway.json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE"
  },
  "deploy": {
    "startCommand": "node /app/dist/index.js",
    "healthcheckPath": "/api/v1/health",
    "healthcheckTimeout": 30,
    "restartPolicyType": "ON_FAILURE"
  }
}
```

Or deploy via CLI:

```bash
railway login
railway init
railway add --docker public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main
railway variables set MCP_HTTP_STATELESS=true
railway variables set SUPABASE_URL=https://your-project.supabase.co
railway variables set SUPABASE_SERVICE_ROLE_KEY=your-key
railway variables set SUPABASE_ANON_KEY=your-anon-key
railway up
```

---

## Render

```yaml
# render.yaml
services:
  - type: web
    name: vcon-mcp
    env: docker
    dockerfilePath: ./Dockerfile
    # Or use pre-built image:
    # image:
    #   url: public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main
    plan: starter
    envVars:
      - key: MCP_HTTP_STATELESS
        value: true
      - key: MCP_HTTP_HOST
        value: 0.0.0.0
      - key: SUPABASE_URL
        sync: false
      - key: SUPABASE_SERVICE_ROLE_KEY
        sync: false
      - key: SUPABASE_ANON_KEY
        sync: false
    healthCheckPath: /api/v1/health
```

---

## Comparison Table

| Provider | Service | Min Cost | Auto-scaling | Cold Start |
|----------|---------|----------|--------------|------------|
| AWS | ECS Fargate | ~$30/mo | Yes | No |
| AWS | App Runner | ~$5/mo | Yes | ~2s |
| GCP | Cloud Run | ~$0 (free tier) | Yes | ~1s |
| Azure | Container Apps | ~$15/mo | Yes | ~2s |
| DigitalOcean | App Platform | ~$5/mo | Yes | No |
| Fly.io | Machines | ~$5/mo | Yes | ~1s |
| Railway | Container | ~$5/mo | Limited | No |
| Render | Web Service | ~$7/mo | Limited | ~30s |

## Next Steps

- [Kubernetes Deployment](./kubernetes.md) - Container orchestration
- [Docker Deployment](./docker.md) - Container basics
- [Security](./security.md) - Production security hardening

