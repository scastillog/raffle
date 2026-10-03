terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.6"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # State is local by default. For a shared/safer setup, uncomment and point to an S3 bucket:
  # backend "s3" {
  #   bucket       = "my-terraform-state-bucket"
  #   key          = "rifa/terraform.tfstate"
  #   region       = "us-east-1"
  #   use_lockfile = true
  # }
}

provider "aws" {
  region  = var.aws_region
  profile = "account"

  default_tags {
    tags = {
      Project = var.project_name
    }
  }
}
