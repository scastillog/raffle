locals {
  frontend_dir = "${path.module}/../frontend"
  content_types = {
    html = "text/html; charset=utf-8"
    css  = "text/css; charset=utf-8"
    js   = "application/javascript; charset=utf-8"
    svg  = "image/svg+xml"
    png  = "image/png"
    ico  = "image/x-icon"
  }

  # Absolute URL of the site: link-preview crawlers need full https:// URLs for og:url and og:image.
  site_url = var.custom_domain != null ? "https://${var.custom_domain}" : "https://${aws_cloudfront_distribution.site.domain_name}"
  html_escape = {
    title       = replace(replace(replace(replace(var.share_title, "&", "&amp;"), "\"", "&quot;"), "<", "&lt;"), ">", "&gt;")
    description = replace(replace(replace(replace(var.share_description, "&", "&amp;"), "\"", "&quot;"), "<", "&lt;"), ">", "&gt;")
  }
  # HTML pages get their link-preview placeholders filled in; every other file is uploaded as is.
  rendered_html = {
    for f in fileset(local.frontend_dir, "**/*.html") : f => replace(replace(replace(replace(
      file("${local.frontend_dir}/${f}"),
      "__SITE_URL__", local.site_url),
      "__SHARE_TITLE__", local.html_escape.title),
      "__SHARE_DESCRIPTION__", local.html_escape.description),
      # Changes when the image changes, so WhatsApp/Facebook fetch the new one.
    "__OG_IMAGE_VERSION__", substr(filemd5("${local.frontend_dir}/og-image.png"), 0, 8))
  }
}

resource "aws_s3_bucket" "site" {
  bucket_prefix = "${var.project_name}-site-"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_object" "site" {
  for_each = fileset(local.frontend_dir, "**")

  bucket        = aws_s3_bucket.site.id
  key           = each.value
  source        = contains(keys(local.rendered_html), each.value) ? null : "${local.frontend_dir}/${each.value}"
  content       = lookup(local.rendered_html, each.value, null)
  etag          = contains(keys(local.rendered_html), each.value) ? md5(local.rendered_html[each.value]) : filemd5("${local.frontend_dir}/${each.value}")
  content_type  = lookup(local.content_types, reverse(split(".", each.value))[0], "application/octet-stream")
  cache_control = "no-cache" # small site: browsers revalidate, so deploys show up immediately
}

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "${var.project_name}-site"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

data "aws_cloudfront_response_headers_policy" "security" {
  name = "Managed-SecurityHeadersPolicy"
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  comment             = var.raffle_name
  default_root_object = "index.html"


  origin {
    origin_id                = "s3"
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  origin {
    origin_id   = "api"
    domain_name = replace(aws_apigatewayv2_api.api.api_endpoint, "https://", "")

    # Shared secret so the Lambda rejects requests that skip CloudFront.
    custom_header {
      name  = "X-Origin-Verify"
      value = random_password.origin_verify.result
    }

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id           = "s3"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security.id
  }

  ordered_cache_behavior {
    path_pattern               = "/api/*"
    target_origin_id           = "api"
    viewer_protocol_policy     = "https-only"
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  aliases = var.custom_domain == null ? [] : [var.custom_domain]

  viewer_certificate {
    cloudfront_default_certificate = var.acm_certificate_arn == null ? true : null
    acm_certificate_arn            = var.acm_certificate_arn
    ssl_support_method             = var.acm_certificate_arn == null ? null : "sni-only"
    minimum_protocol_version       = var.acm_certificate_arn == null ? "TLSv1" : "TLSv1.2_2021"
  }

  tags = {
    Name = "Raffle"
  }

  # Flat-rate plans attach a CloudFront-managed WAF web ACL; don't let Terraform detach it.
  lifecycle {
    ignore_changes = [web_acl_id]
  }
}

resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowCloudFrontRead"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.site.arn}/*"
      Condition = {
        StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.site.arn }
      }
    }]
  })
}
