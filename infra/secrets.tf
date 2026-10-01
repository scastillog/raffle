resource "aws_ssm_parameter" "admin_password" {
  name  = "/${var.project_name}/admin-password"
  type  = "SecureString"
  value = var.admin_password
}

resource "random_password" "token_secret" {
  length  = 64
  special = false
}

# Signs admin session tokens. Changing it logs out every admin session.
resource "aws_ssm_parameter" "token_secret" {
  name  = "/${var.project_name}/token-secret"
  type  = "SecureString"
  value = random_password.token_secret.result
}
