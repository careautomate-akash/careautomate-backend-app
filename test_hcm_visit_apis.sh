#!/bin/bash

# HCM Visit History API Testing Script
# Base URL
BASE_URL="http://localhost:9003"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test counter
TEST_COUNT=0
PASS_COUNT=0
FAIL_COUNT=0

# Function to log test results
log_test() {
    TEST_COUNT=$((TEST_COUNT + 1))
    if [ $1 -eq 200 ] || [ $1 -eq 201 ]; then
        echo -e "${GREEN}✓ PASS${NC} - Test $TEST_COUNT: $2 (Status: $1)"
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        echo -e "${RED}✗ FAIL${NC} - Test $TEST_COUNT: $2 (Status: $1)"
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
}

# Function to make API call and log result
test_api() {
    local method=$1
    local endpoint=$2
    local data=$3
    local description=$4
    
    echo -e "\n${BLUE}Testing:${NC} $description"
    echo -e "${YELLOW}Endpoint:${NC} $method $endpoint"
    if [ -n "$data" ]; then
        echo -e "${YELLOW}Data:${NC} $data"
    fi
    
    if [ "$method" = "POST" ]; then
        if [ -n "$data" ]; then
            response=$(curl -s -w "%{http_code}" -X POST "$BASE_URL$endpoint" \
                -H "Content-Type: application/json" \
                -H "Authorization: Bearer $JWT_TOKEN" \
                -d "$data")
        else
            response=$(curl -s -w "%{http_code}" -X POST "$BASE_URL$endpoint" \
                -H "Content-Type: application/json" \
                -H "Authorization: Bearer $JWT_TOKEN")
        fi
    else
        response=$(curl -s -w "%{http_code}" -X GET "$BASE_URL$endpoint" \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer $JWT_TOKEN")
    fi
    
    # Extract status code (last 3 characters)
    status_code="${response: -3}"
    # Extract response body (everything except last 3 characters)
    response_body="${response%???}"
    
    log_test $status_code "$description"
    
    # Pretty print JSON response if it's valid JSON
    if echo "$response_body" | jq . >/dev/null 2>&1; then
        echo -e "${YELLOW}Response:${NC}"
        echo "$response_body" | jq .
    else
        echo -e "${YELLOW}Response:${NC} $response_body"
    fi
    
    echo "----------------------------------------"
}

echo -e "${BLUE}=== HCM Visit History API Testing Script ===${NC}"
echo -e "${YELLOW}Please provide your JWT token for authentication:${NC}"

# Get JWT token from user
echo -n "JWT Token: "
read -s JWT_TOKEN
echo

if [ -z "$JWT_TOKEN" ]; then
    echo -e "${RED}Error: JWT token is required!${NC}"
    echo -e "${YELLOW}To get a JWT token, first login:${NC}"
    echo "curl -X POST $BASE_URL/auth/login \\"
    echo "  -H \"Content-Type: application/json\" \\"
    echo "  -d '{\"email\": \"your_email@example.com\", \"password\": \"your_password\"}'"
    exit 1
fi

# HCM IDs from the snapshot
HCM_ID_1="6841dabaa8b903162f98c2a1"
HCM_ID_2="684103d856f780795f382056"

# Tenant IDs from the snapshot
TENANT_ID_1="684570e50d06a7bf3147b759"
TENANT_ID_2="683fb1c40067b303cdd54de6"

echo -e "\n${BLUE}Starting comprehensive API tests...${NC}\n"

# ==============================================
# 1. BASIC FUNCTIONALITY TESTS
# ==============================================
echo -e "${GREEN}=== 1. BASIC FUNCTIONALITY TESTS ===${NC}"

test_api "POST" "/hcm/hcm-visit-history/$HCM_ID_1" '{}' "Get all visits for HCM 1"

test_api "POST" "/hcm/hcm-visit-history/$HCM_ID_2" '{}' "Get all visits for HCM 2"

test_api "POST" "/hcm/hcm-visit-history/invalid-id" '{}' "Invalid HCM ID test"

# ==============================================
# 2. STATUS FILTER TESTS
# ==============================================
echo -e "\n${GREEN}=== 2. STATUS FILTER TESTS ===${NC}"

test_api "POST" "/hcm/hcm-visit-history/$HCM_ID_1" '{"status": "approved"}' "Get approved visits for HCM 1"

test_api "POST" "/hcm/hcm-visit-history/$HCM_ID_1" '{"status": "pending"}' "Get pending visits for HCM 1"

test_api "POST" "/hcm/hcm-visit-history/$HCM_ID_1" '{"status": "rejected"}' "Get rejected visits for HCM 1"

test_api "POST" "/hcm/hcm-visit-history/$HCM_ID_2" '{"status": "approved"}' "Get approved visits for HCM 2"

# ==============================================
# 3. TENANT FILTER TESTS
# ==============================================
echo -e "\n${GREEN}=== 3. TENANT FILTER TESTS ===${NC}"

test_api "POST" "/hcm/hcm-visit-history/$HCM_ID_1" "{\"tenantId\": \"$TENANT_ID_1\"}" "Filter by Tenant ID 1 for HCM 1"

test_api "POST" "/hcm/hcm-visit-history/$HCM_ID_2" "{\"tenantId\": \"$TENANT_ID_2\"}" "Filter by Tenant ID 2 for HCM 2"

test_api "POST" "/hcm/hcm-visit-history/$HCM_ID_1" '{"tenantId": "000000000000000000000000"}' "Filter by non-existent Tenant ID"

# ==============================================
# 4. DATE FILTER TESTS
# ==============================================
echo -e "\n${GREEN}=== 4. DATE FILTER TESTS ===${NC}"

test_api "POST" "/hcm/hcm-visit-history/$HCM_ID_1" '{"date": "2025-06-09"}' "Filter by specific date (2025-06-09)"

test_api "POST" "/hcm/hcm-visit-history/$HCM_ID_1" '{"date": "2025-06-10"}' "Filter by specific date (2025-06-10)"

test_api "POST" "/hcm/hcm-visit-history/$HCM_ID_1" '{"startDate": "2025-06-01", "endDate": "2025-06-30"}' "Filter by date range (June 2025)"

test_api "POST" "/hcm/hcm-visit-history/$HCM_ID_1" '{"startDate": "2025-06-01"}' "Filter by start date only"

test_api "POST" "/hcm/hcm-visit-history/$HCM_ID_1" '{"endDate": "2025-06-30"}' "Filter by end date only"

test_api "POST" "/hcm/hcm-visit-history/$HCM_ID_1" '{"startDate": "2025-01-01", "endDate": "2025-12-31"}' "Filter by wide date range (2025)"

# ==============================================
# 5. COMBINED FILTER TESTS
# ==============================================
echo -e "\n${GREEN}=== 5. COMBINED FILTER TESTS ===${NC}"

test_api "POST" "/hcm/hcm-visit-history/$HCM_ID_1" "{\"status\": \"approved\", \"tenantId\": \"$TENANT_ID_1\"}" "Status + Tenant filter"

test_api "POST" "/hcm/hcm-visit-history/$HCM_ID_1" '{"status": "approved", "date": "2025-06-09"}' "Status + Date filter"

test_api "POST" "/hcm/hcm-visit-history/$HCM_ID_1" "{\"status\": \"approved\", \"tenantId\": \"$TENANT_ID_1\", \"startDate\": \"2025-06-01\", \"endDate\": \"2025-06-30\"}" "All filters combined"

test_api "POST" "/hcm/hcm-visit-history/$HCM_ID_2" "{\"status\": \"pending\", \"tenantId\": \"$TENANT_ID_2\", \"date\": \"2025-06-10\"}" "Multiple filters for HCM 2"

# ==============================================
# 6. EDGE CASE TESTS
# ==============================================
echo -e "\n${GREEN}=== 6. EDGE CASE TESTS ===${NC}"

test_api "POST" "/hcm/hcm-visit-history/$HCM_ID_1" '' "Empty request body"

test_api "POST" "/hcm/hcm-visit-history/$HCM_ID_1" '{"status": "invalid_status"}' "Invalid status value"

test_api "POST" "/hcm/hcm-visit-history/$HCM_ID_1" '{"date": "invalid-date"}' "Invalid date format"

test_api "POST" "/hcm/hcm-visit-history/000000000000000000000000" '{}' "Non-existent HCM ID"

test_api "POST" "/hcm/hcm-visit-history/$HCM_ID_1" '{"status": ""}' "Empty status value"

test_api "POST" "/hcm/hcm-visit-history/$HCM_ID_1" '{"tenantId": ""}' "Empty tenant ID"

test_api "POST" "/hcm/hcm-visit-history/$HCM_ID_1" '{"date": ""}' "Empty date value"

# ==============================================
# 7. AUTHENTICATION TESTS
# ==============================================
echo -e "\n${GREEN}=== 7. AUTHENTICATION TESTS ===${NC}"

echo -e "\n${BLUE}Testing:${NC} No authentication token"
echo -e "${YELLOW}Endpoint:${NC} POST /hcm/hcm-visit-history/$HCM_ID_1"

response=$(curl -s -w "%{http_code}" -X POST "$BASE_URL/hcm/hcm-visit-history/$HCM_ID_1" \
    -H "Content-Type: application/json" \
    -d '{}')

status_code="${response: -3}"
response_body="${response%???}"

if [ $status_code -eq 401 ] || [ $status_code -eq 403 ]; then
    log_test 200 "No authentication token (Expected 401/403, got $status_code)"
else
    log_test $status_code "No authentication token (Expected 401/403, got $status_code)"
fi

echo -e "${YELLOW}Response:${NC}"
if echo "$response_body" | jq . >/dev/null 2>&1; then
    echo "$response_body" | jq .
else
    echo "$response_body"
fi
echo "----------------------------------------"

echo -e "\n${BLUE}Testing:${NC} Invalid authentication token"
echo -e "${YELLOW}Endpoint:${NC} POST /hcm/hcm-visit-history/$HCM_ID_1"

response=$(curl -s -w "%{http_code}" -X POST "$BASE_URL/hcm/hcm-visit-history/$HCM_ID_1" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer invalid_token" \
    -d '{}')

status_code="${response: -3}"
response_body="${response%???}"

if [ $status_code -eq 401 ] || [ $status_code -eq 403 ]; then
    log_test 200 "Invalid authentication token (Expected 401/403, got $status_code)"
else
    log_test $status_code "Invalid authentication token (Expected 401/403, got $status_code)"
fi

echo -e "${YELLOW}Response:${NC}"
if echo "$response_body" | jq . >/dev/null 2>&1; then
    echo "$response_body" | jq .
else
    echo "$response_body"
fi
echo "----------------------------------------"

# ==============================================
# 8. PERFORMANCE TESTS
# ==============================================
echo -e "\n${GREEN}=== 8. PERFORMANCE TESTS ===${NC}"

echo -e "\n${BLUE}Testing:${NC} Response time for basic query"
start_time=$(date +%s%N)
test_api "POST" "/hcm/hcm-visit-history/$HCM_ID_1" '{}' "Basic query performance test"
end_time=$(date +%s%N)
duration=$((($end_time - $start_time) / 1000000))
echo -e "${YELLOW}Response time:${NC} ${duration}ms"

# ==============================================
# FINAL SUMMARY
# ==============================================
echo -e "\n${BLUE}=== TEST SUMMARY ===${NC}"
echo -e "${GREEN}Total Tests: $TEST_COUNT${NC}"
echo -e "${GREEN}Passed: $PASS_COUNT${NC}"
echo -e "${RED}Failed: $FAIL_COUNT${NC}"

if [ $FAIL_COUNT -eq 0 ]; then
    echo -e "\n${GREEN}🎉 All tests passed successfully!${NC}"
else
    echo -e "\n${YELLOW}⚠️  Some tests failed. Please review the output above.${NC}"
fi

echo -e "\n${BLUE}=== Testing completed ===${NC}"