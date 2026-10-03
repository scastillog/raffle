data "archive_file" "api" {
  type        = "zip"
  source_dir  = "${path.module}/../backend/src"
  output_path = "${path.module}/build/api.zip"
}

resource "aws_iam_role" "api" {
  name = "${var.project_name}-api"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "api_logs" {
  role       = aws_iam_role.api.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "api" {
  name = "${var.project_name}-api"
  role = aws_iam_role.api.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Scan",
          "dynamodb:ConditionCheckItem",
        ]
        Resource = [
          aws_dynamodb_table.numbers.arn,
          aws_dynamodb_table.tickets.arn,
          aws_dynamodb_table.settings.arn,
        ]
      },
      {
        Effect   = "Allow"
        Action   = "ssm:GetParameter"
        Resource = [aws_ssm_parameter.admin_password.arn, aws_ssm_parameter.token_secret.arn]
      },
    ]
  })
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${var.project_name}-api"
  retention_in_days = 30
}

resource "aws_lambda_function" "api" {
  function_name    = "${var.project_name}-api"
  role             = aws_iam_role.api.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256
  memory_size      = 256
  timeout          = 10

  environment {
    variables = {
      NUMBERS_TABLE        = aws_dynamodb_table.numbers.name
      TICKETS_TABLE        = aws_dynamodb_table.tickets.name
      SETTINGS_TABLE       = aws_dynamodb_table.settings.name
      ADMIN_PASSWORD_PARAM = aws_ssm_parameter.admin_password.name
      TOKEN_SECRET_PARAM   = aws_ssm_parameter.token_secret.name
      RAFFLE_NAME          = var.raffle_name
      TICKET_PRICE         = tostring(var.ticket_price)
      PRIZE                = tostring(var.prize)
      DRAW_DATE            = var.draw_date
      PAYMENT_INSTRUCTIONS = var.payment_instructions
      WHATSAPP_NUMBER      = var.whatsapp_number
      RESERVATION_HOURS    = tostring(var.reservation_hours)
      CODE_ROTATION_HOURS  = tostring(var.code_rotation_hours)
    }
  }

  depends_on = [aws_cloudwatch_log_group.api, aws_iam_role_policy_attachment.api_logs]
}
