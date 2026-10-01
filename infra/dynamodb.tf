# One item per number that is reserved or sold. Missing item = number available.
resource "aws_dynamodb_table" "numbers" {
  name         = "${var.project_name}-numeros"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "num"

  attribute {
    name = "num"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }
}

# One item per ticket (buyer name, phone, the 2 numbers, payment status).
resource "aws_dynamodb_table" "tickets" {
  name         = "${var.project_name}-boletos"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }
}

# Raffle-wide settings, currently just the declared winner.
resource "aws_dynamodb_table" "settings" {
  name         = "${var.project_name}-ajustes"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }
}
