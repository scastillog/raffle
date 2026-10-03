resource "aws_apigatewayv2_api" "api" {
  name          = "${var.project_name}-api"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "api" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "api" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "ANY /api/{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

# Dedicated route so ticket creation can be throttled harder than the rest of the API.
resource "aws_apigatewayv2_route" "create_ticket" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "POST /api/boletos"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true

  # Basic protection against abuse / password guessing.
  default_route_settings {
    throttling_rate_limit  = 20
    throttling_burst_limit = 40
  }

  # Ticket creation checks the 6-digit purchase code, so cap guesses hard. The limit is shared
  # by all buyers: 2 req/s is ~7,200 guesses/hour (<1% chance of hitting a 1-in-a-million code),
  # but in a sales rush some buyers may get a 429 and have to retry.
  route_settings {
    route_key              = aws_apigatewayv2_route.create_ticket.route_key
    throttling_rate_limit  = var.purchase_rate_limit
    throttling_burst_limit = var.purchase_burst_limit
  }
}

resource "aws_lambda_permission" "api" {
  statement_id  = "AllowApiGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}
