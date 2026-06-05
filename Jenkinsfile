pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '20'))
    timeout(time: 60, unit: 'MINUTES')
  }

  triggers {
    pollSCM('H/2 * * * *')
  }

  environment {
    CI = 'true'
    DEPLOY_BRANCH = 'main'
    DEPLOY_PATH = '/opt/bizbil'
    HEALTH_URL = 'https://ros.sivsanoils.in/api/health'
    DATABASE_URL = 'postgresql://bizbil:password@localhost:5432/bizbil'
    REDIS_URL = 'redis://:password@localhost:6379'
    JWT_SECRET = 'jenkins-ci-only-jwt-secret'
    NEXT_PUBLIC_API_URL = 'http://localhost:3001/api'
    NEXT_PUBLIC_APP_NAME = 'BizBil'
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
        sh 'git rev-parse --short HEAD'
      }
    }

    stage('Install') {
      steps {
        sh 'corepack enable'
        sh 'corepack pnpm install --frozen-lockfile'
      }
    }

    stage('Prisma') {
      steps {
        sh 'corepack pnpm --filter @bizbil/api prisma:generate'
      }
    }

    stage('Validate Compose') {
      steps {
        sh 'docker compose --env-file .env.production.example -f infra/docker-compose.prod.yml config >/tmp/bizbil-compose.yml'
      }
    }

    stage('Quality Gate') {
      parallel {
        stage('Lint') {
          steps {
            sh 'corepack pnpm lint'
          }
        }
        stage('Test') {
          steps {
            sh 'corepack pnpm test'
          }
        }
      }
    }

    stage('Build') {
      steps {
        sh 'corepack pnpm build'
      }
    }

    stage('Docker Build') {
      steps {
        sh 'docker compose --env-file .env.production.example -f infra/docker-compose.prod.yml build api web'
      }
    }

    stage('Deploy Production') {
      when {
        anyOf {
          branch 'main'
          expression { env.BRANCH_NAME == 'main' || env.GIT_BRANCH == 'origin/main' || env.GIT_BRANCH == 'main' }
        }
      }
      steps {
        withCredentials([
          sshUserPrivateKey(credentialsId: 'bizbil-prod-ssh', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER'),
          string(credentialsId: 'bizbil-prod-host', variable: 'DEPLOY_HOST')
        ]) {
          sh 'bash ops/jenkins/deploy-over-ssh.sh'
        }
      }
    }
  }

  post {
    success {
      echo "BizBil pipeline completed successfully for ${env.BRANCH_NAME ?: env.GIT_BRANCH ?: 'current branch'} at ${env.GIT_COMMIT}"
    }
    failure {
      echo 'BizBil pipeline failed. Deployment was not marked successful.'
    }
  }
}
