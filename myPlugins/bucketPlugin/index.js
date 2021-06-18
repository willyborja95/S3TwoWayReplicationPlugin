'use strict';

class ServerlessPlugin {

  originBucket;
  destinationBucket;
  destinationRegion;

  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.commands = {
      bidirectionalReplication: {
        lifecycleEvents: [
            'createBuckets',
            'attachPermissions'
        ],
        usage: "Add replica configuration to buckets"
      }
    };

    this.hooks = {
      'before:bidirectionalReplication.createBuckets': this.getBucketsProps.bind(this),
    };
    this.getBucketsProps();
  }

  async getBucketsProps(){
    this.originBucket = this.serverless.service.custom.crossregions3.buckets[0].bucket;
    this.destinationBucket = this.serverless.service.custom.crossregions3.buckets[0].destinationBucket;
    this.destinationRegion = this.serverless.service.custom.crossregions3.buckets[0].destinationRegion;
    let originBucketCreated = await this.createBucket(this.originBucket);
    this.setBucketVersioning(this.originBucket)
    let destinationBucketCreated = await this.createBucket(this.destinationBucket);
    this.setBucketVersioning(this.destinationBucket)

    let roleOriginToDestination = await this.createRole("RoleOriginToDestination");
    let policyOriginToDestination = await this.createPolicy("Policy-OriginToDestination", this.originBucket, this.destinationBucket);
    this.attachPolicyToRole(policyOriginToDestination.Policy.Arn, roleOriginToDestination.Role.RoleName)
    this.putBucketReplication(this.originBucket, this.destinationBucket, roleOriginToDestination.Role.Arn)

    let roleDestinationToOrigin = await this.createRole("RoleDestinationToOrigin");
    let policyDestinationToOrigin = await this.createPolicy("Policy-DestinationToOrigin", this.destinationBucket, this.originBucket);
    this.attachPolicyToRole(policyDestinationToOrigin.Policy.Arn, roleDestinationToOrigin.Role.RoleName)
    this.putBucketReplication( this.destinationBucket, this.originBucket,roleDestinationToOrigin.Role.Arn)
  }

  async createBucket(bucketName){
    return await this.serverless.getProvider('aws').request('S3', 'createBucket', {
      Bucket: bucketName
    })
  }

  async setBucketVersioning(bucketName){
    return await this.serverless.getProvider('aws').request('S3', 'putBucketVersioning', {
      Bucket: bucketName,
      VersioningConfiguration: {
        MFADelete: "Disabled",
        Status: "Enabled"
      }
    })
  }

  async putBucketReplication(bucket1, bucket2, roleArn){
    return await this.serverless.getProvider('aws').request('S3', 'putBucketReplication', {
      Bucket: bucket1,
      ReplicationConfiguration: {
        Role: roleArn,
        Rules: [
          {
            Destination: {
              Bucket: `arn:aws:s3:::${bucket2}`,
              StorageClass: "STANDARD"
            },
            Prefix: "",
            Status: "Enabled"
          }
        ]
      }
    })
  }

  async createRole(roleName){
    return await this.serverless.getProvider('aws').request('IAM', 'createRole', {
      RoleName: roleName,
      AssumeRolePolicyDocument: JSON.stringify(this.assumeRoleStatement)
    })
  }

  async createPolicy(policyName, sourceBucket, destinationBucket){
    return await this.serverless.getProvider('aws').request('IAM', 'createPolicy', {
      PolicyName: policyName,
      PolicyDocument: this.statements1(sourceBucket, destinationBucket)
    })
  }

  async attachPolicyToRole(policyArn, roleName){
    return await this.serverless.getProvider('aws').request('IAM', 'attachRolePolicy', {
      PolicyArn: policyArn,
      RoleName: roleName
    })
  }

  assumeRoleStatement = {
    Version: "2012-10-17",
    Statement: {
      Effect: "Allow",
      Principal: {
        Service: ["s3.amazonaws.com"]
      },
        Action: "sts:AssumeRole"
      }
  }

  statements1 = (bucket1, bucket2)=>{
    return JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: [
            "s3:GetReplicationConfiguration",
            "s3:ListBucket"
          ],
          Resource: `arn:aws:s3:::${bucket1}`
        },
        {
          Effect: "Allow",
          Action: [
            "s3:GetObjectVersion",
            "s3:GetObjectVersionAcl",
            "s3:GetObjectVersionForReplication"
          ],
          Resource: `arn:aws:s3:::${bucket1}`
        },
        {
          Effect: "Allow",
          Action: [
            "s3:ReplicateObject",
            "s3:ReplicateDelete",
            "s3:ReplicateTags",
            "s3:GetObjectVersionTagging"
          ],
          Resource: `arn:aws:s3:::${bucket2}`
        }]
    });
  }
}

module.exports = ServerlessPlugin;
