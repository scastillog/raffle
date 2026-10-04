variable "aws_region" {
  description = "AWS region for the Lambda, API and DynamoDB tables."
  type        = string
  default     = "us-east-1"
}

variable "aws_profile" {
  description = "Named AWS CLI profile to deploy with (from ~/.aws/config). Leave null to use the default credential chain (AWS_PROFILE, env vars, SSO, instance role...)."
  type        = string
  default     = null
}

variable "purchase_rate_limit" {
  description = "Ticket purchases per second allowed by API Gateway, shared by ALL buyers. Low values slow down guessing the purchase code but can reject buyers during a rush."
  type        = number
  default     = 2
}

variable "purchase_burst_limit" {
  description = "Short burst of ticket purchases API Gateway accepts above purchase_rate_limit (shared by all buyers)."
  type        = number
  default     = 5
}

variable "project_name" {
  description = "Prefix for all resource names. Lowercase letters, numbers and dashes."
  type        = string
  default     = "rifa"
}

variable "raffle_name" {
  description = "Title shown on the public page."
  type        = string
  default     = "Gran Rifa de 1.000.000"
}

variable "ticket_price" {
  description = "Ticket price in COP (each ticket = 2 numbers)."
  type        = number
  default     = 25000
}

variable "prize" {
  description = "Prize in COP."
  type        = number
  default     = 1000000
}

variable "draw_date" {
  description = "Date of the Lotería de Boyacá draw that decides the raffle (YYYY-MM-DD)."
  type        = string

  validation {
    condition     = can(regex("^\\d{4}-\\d{2}-\\d{2}$", var.draw_date))
    error_message = "draw_date must be YYYY-MM-DD."
  }
}

variable "payment_instructions" {
  description = "How buyers pay (shown after they reserve). Example: Nequi 300 123 4567 a nombre de Juan Pérez."
  type        = string
}

variable "whatsapp_number" {
  description = "Admin WhatsApp number with country code, digits only (e.g. 573001234567). Buyers send payment proof here."
  type        = string

  validation {
    condition     = can(regex("^\\d{10,15}$", var.whatsapp_number))
    error_message = "whatsapp_number must be digits only, including country code (e.g. 573001234567)."
  }
}

variable "reservation_hours" {
  description = "Hours a reservation is held before unpaid numbers are released."
  type        = number
  default     = 24
}

variable "code_rotation_hours" {
  description = "Hours a purchase verification code stays valid before it rotates."
  type        = number
  default     = 1
}

variable "admin_password" {
  description = "Password for /admin.html. Use a long one."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.admin_password) >= 12
    error_message = "admin_password must be at least 12 characters."
  }
}

variable "custom_domain" {
  description = "Custom domain served by CloudFront (e.g. rifamanosanti.lat). Leave null to use the *.cloudfront.net domain."
  type        = string
  default     = null
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN (must be in us-east-1) covering custom_domain. Required when custom_domain is set."
  type        = string
  default     = null

  validation {
    condition     = var.custom_domain == null || var.acm_certificate_arn != null
    error_message = "acm_certificate_arn is required when custom_domain is set."
  }
}
