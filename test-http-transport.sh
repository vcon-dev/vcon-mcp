#!/bin/bash

# Test script for HTTP transport
echo "Testing HTTP Transport for vCon MCP Server"
echo "=========================================="
echo ""

# Set environment variables for HTTP mode
export MCP_TRANSPORT=http
export MCP_HTTP_PORT=3001
export MCP_HTTP_HOST=127.0.0.1

# Start the server in background
echo "Starting HTTP server on port 3001..."
node dist/index.js &
SERVER_PID=$!

# Wait for server to start
echo "Waiting for server to initialize..."
sleep 3

# Test 1: Initialize connection
echo "Test 1: Initializing MCP connection..."
INIT_FULL=$(curl -s -i -X POST http://127.0.0.1:3001 \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test-client","version":"1.0.0"}}}' 2>&1)

INIT_CODE=$(echo "$INIT_FULL" | grep "^HTTP" | awk '{print $2}')
echo "Initialize response code: $INIT_CODE"

if [ "$INIT_CODE" != "200" ]; then
    echo "❌ Initialization failed"
    echo "$INIT_FULL"
    kill $SERVER_PID 2>/dev/null || true
    exit 1
fi

# Extract session ID from Mcp-Session-Id header
SESSION_ID=$(echo "$INIT_FULL" | grep -i "^mcp-session-id:" | cut -d' ' -f2 | tr -d '\r\n')
echo "Session ID: $SESSION_ID"

# Test 2: List tools
echo "Test 2: Listing available tools..."
if [ -n "$SESSION_ID" ]; then
    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST http://127.0.0.1:3001 \
      -H "Content-Type: application/json" \
      -H "Accept: application/json, text/event-stream" \
      -H "Mcp-Session-Id: $SESSION_ID" \
      -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' 2>&1)
else
    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST http://127.0.0.1:3001 \
      -H "Content-Type: application/json" \
      -H "Accept: application/json, text/event-stream" \
      -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' 2>&1)
fi

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo ""
echo "HTTP Response Code: $HTTP_CODE"

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ HTTP transport is working!"
    echo ""
    echo "Response preview:"
    echo "$BODY" | head -c 500
    echo "..."
    EXIT_CODE=0
else
    echo "❌ HTTP transport test failed"
    echo "Response: $RESPONSE"
    EXIT_CODE=1
fi

# Cleanup
echo ""
echo "Stopping server (PID: $SERVER_PID)..."
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true

exit $EXIT_CODE
