# Per-IP rate limit on ticket purchases. This is what stops someone from brute-forcing the
# 6-digit purchase code without slowing down everyone else during a sales rush.
# WAF for CloudFront must live in us-east-1 (per-resource `region` needs AWS provider v6).
resource "aws_wafv2_web_acl" "site" {
  count  = var.enable_waf ? 1 : 0
  region = "us-east-1"
  name   = "${var.project_name}-site"
  scope  = "CLOUDFRONT"

  default_action {
    allow {}
  }

  custom_response_body {
    key          = "too_many_purchases"
    content_type = "APPLICATION_JSON"
    content      = jsonencode({ error = "Demasiados intentos desde tu conexión. Espera unos minutos e intenta de nuevo." })
  }

  rule {
    name     = "limit-ticket-purchases-per-ip"
    priority = 1

    action {
      block {
        custom_response {
          response_code            = 429
          custom_response_body_key = "too_many_purchases"
        }
      }
    }

    statement {
      rate_based_statement {
        limit                 = var.purchase_limit_per_ip
        evaluation_window_sec = 300
        aggregate_key_type    = "IP"

        scope_down_statement {
          and_statement {
            statement {
              byte_match_statement {
                search_string         = "/api/boletos"
                positional_constraint = "EXACTLY"

                field_to_match {
                  uri_path {}
                }

                text_transformation {
                  priority = 0
                  type     = "NONE"
                }
              }
            }

            statement {
              byte_match_statement {
                search_string         = "POST"
                positional_constraint = "EXACTLY"

                field_to_match {
                  method {}
                }

                text_transformation {
                  priority = 0
                  type     = "NONE"
                }
              }
            }
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.project_name}-purchase-limit"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.project_name}-site"
    sampled_requests_enabled   = true
  }
}
