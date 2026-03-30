name: Weekly Cache Pre-warm

on:
  schedule:
    # Runs at 3:00 AM UTC every Sunday (11:00 PM EST Saturday)
    - cron: '0 3 * * 0'
  workflow_dispatch:

jobs:
  warm-cache:
    runs-on: ubuntu-latest
    steps:
      - name: Warm all 30 roles (one call per role)
        run: |
          BASE="https://gradlaunch-weld.vercel.app/api/warmcache"
          ROLES=(
            "Data Analyst"
            "Data Engineer"
            "Data Scientist"
            "Business Analyst"
            "Software Engineer"
            "Product Manager"
            "Machine Learning Engineer"
            "Analytics Engineer"
            "Business Intelligence Analyst"
            "Financial Analyst"
            "Marketing Analyst"
            "Operations Analyst"
            "Product Analyst"
            "Strategy Analyst"
            "Quantitative Analyst"
            "UX Researcher"
            "Project Manager"
            "Program Manager"
            "Solutions Architect"
            "Data Architect"
            "AI Engineer"
            "Research Scientist"
            "Growth Analyst"
            "Revenue Operations"
            "Sales Operations"
            "Supply Chain Analyst"
            "Risk Analyst"
            "Pricing Analyst"
            "Healthcare Data Analyst"
            "Cybersecurity Analyst"
          )
          FAILED=0
          for role in "${ROLES[@]}"; do
            encoded=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$role'))")
            echo "Warming: $role"
            response=$(curl -s -w "\n%{http_code}" --max-time 90 "${BASE}?role=${encoded}")
            http_code=$(echo "$response" | tail -n1)
            body=$(echo "$response" | head -n-1)
            echo "  Status: $http_code | $body"
            if [ "$http_code" != "200" ]; then
              echo "  WARNING: Failed for $role"
              FAILED=$((FAILED + 1))
            fi
            # 5 second gap between roles — avoids Apify rate limits
            sleep 5
          done
          echo "Done. $FAILED roles failed."
          if [ "$FAILED" -gt "10" ]; then
            echo "Too many failures — exiting with error"
            exit 1
          fi
        timeout-minutes: 40
