output "site_url" {
  description = "Public raffle page."
  value       = "https://${aws_cloudfront_distribution.site.domain_name}"
}

output "admin_url" {
  description = "Admin page."
  value       = "https://${aws_cloudfront_distribution.site.domain_name}/admin.html"
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.site.id
}
