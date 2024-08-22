import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

// Función principal para crear los recursos
async function main() {
    // Obtener el ID de cuenta de AWS
    const callerIdentity = await aws.getCallerIdentity();

    // Crear un rol IAM para GitHub Actions
    const iamRole = new aws.iam.Role("githubActionsRole", {
        assumeRolePolicy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [
                {
                    Effect: "Allow",
                    Principal: {
                        Federated: `arn:aws:iam::${callerIdentity.accountId}:oidc-provider/token.actions.githubusercontent.com`
                    },
                    Action: "sts:AssumeRoleWithWebIdentity",
                    Condition: {
                        StringEquals: {
                            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                            "token.actions.githubusercontent.com:sub": "repo:user-jam/prueba-actions-aws:ref:refs/heads/master"
                        }
                    }
                }
            ]
        })
    });

    // Crear un bucket S3
    const s3Bucket = new aws.s3.Bucket("innovate-static", {
        bucket: "innovate-static",
        website: {
            indexDocument: "index.html",
            errorDocument: "error.html",
        },
        // Eliminar la configuración ACL ya que ObjectOwnership está en BucketOwnerEnforced
    });

    // Crear una política para el rol
    const iamPolicy = new aws.iam.Policy("githubActionsPolicy", {
        description: "Acceso de Github Actions a S3",
        policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [
                {
                    Effect: "Allow",
                    Action: ["s3:GetObject",
                             "s3:PutBucketAcl",
                             "s3:PutObject"],  // Específica acciones permitidas
                    Resource: [
                        `arn:aws:s3:::${s3Bucket.id}`,
                        `arn:aws:s3:::${s3Bucket.id}/*`
                    ]
                }
            ]
        })
    });

    // Adjuntar la política al rol
    const iamRolePolicyAttachment = new aws.iam.RolePolicyAttachment("githubActionsRolePolicyAttachment", {
        role: iamRole.name,
        policyArn: iamPolicy.arn,
    });

    // Crear una política de bucket para permitir acceso público
    const bucketPolicy = new aws.s3.BucketPolicy("bucketPolicy", {
        bucket: s3Bucket.id,
        policy: pulumi.all([s3Bucket.id]).apply(([bucketId]) => JSON.stringify({
            Version: "2012-10-17",
            Statement: [
                {
                    Sid: "PublicReadAccess",
                    Effect: "Allow",
                    Principal: "*",
                    Action: "s3:GetObject",
                    Resource: `arn:aws:s3:::${bucketId}/*`
                }
            ],
        })),
    });

    // Crear una distribución CloudFront
    const cloudfrontDistribution = new aws.cloudfront.Distribution("myDistribution", {
        origins: [{
            originId: s3Bucket.id,
            domainName: s3Bucket.websiteEndpoint.apply(endpoint => endpoint.replace("http://", "")),
            customOriginConfig: {
                originProtocolPolicy: "http-only",
                httpPort: 80,
                httpsPort: 443,
                originSslProtocols: ["TLSv1.2"],
            },
        }],
        enabled: true,
        isIpv6Enabled: true,
        defaultRootObject: "index.html",
        defaultCacheBehavior: {
            targetOriginId: s3Bucket.id,
            viewerProtocolPolicy: "redirect-to-https",
            allowedMethods: ["GET", "HEAD"],
            cachedMethods: ["GET", "HEAD"],
            compress: true,
            forwardedValues: {
                queryString: false, // Indica si deseas pasar parámetros de consulta
                cookies: {
                    forward: "none", // Define cómo manejar las cookies
                },
            },
        },
        priceClass: "PriceClass_100",
        viewerCertificate: {
            cloudfrontDefaultCertificate: true,
        },
        restrictions: {
            geoRestriction: {
                restrictionType: "none",
            },
        },
    });
}

// Ejecutar la función principal
main();
