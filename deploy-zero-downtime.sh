#!/bin/bash
set -ex


echo "🚀 Initiating Zero-Downtime Deployment (Blue/Green)"

# 0. Fix SSH permissions (prevents "Bad owner or permissions on ~/.ssh/config" error)
echo "🔐 Fixing SSH permissions..."
if [ -f ~/.ssh/config ]; then
    chmod 600 ~/.ssh/config
fi
if [ -d ~/.ssh ]; then
    chmod 700 ~/.ssh
    chmod 600 ~/.ssh/id_* 2>/dev/null || true
    chmod 644 ~/.ssh/*.pub 2>/dev/null || true
fi

# 0. Pull latest changes from GitHub (optional/fallback in case script is run manually)
echo "📥 Syncing code from GitHub..."
if git fetch origin 2>/dev/null; then
    git reset --hard origin/main || true
else
    echo "⚠️ Warning: Git sync failed. Proceeding with existing code state."
fi

# 0.5 Ensure INTERVIEW_JWT_SECRET and ENCRYPTION_KEY exist in backend/.env
# IMPORTANT: We NEVER overwrite existing values to avoid decryption failures and
# invalidating active interview sessions. Keys are only injected when absent.
echo "🔧 Checking environment variables..."
ENV_FILE="backend/.env"
if [ -f "$ENV_FILE" ]; then
    if ! grep -q "INTERVIEW_JWT_SECRET" "$ENV_FILE"; then
        echo "Adding missing INTERVIEW_JWT_SECRET to $ENV_FILE..."
        RAND_SECRET=$(openssl rand -hex 32 2>/dev/null || python3 -c "import secrets; print(secrets.token_hex(32))" 2>/dev/null || echo "")
        if [ -z "$RAND_SECRET" ]; then
            echo "⚠️ Warning: Could not generate INTERVIEW_JWT_SECRET. Please add it manually to $ENV_FILE."
        else
            echo "" >> "$ENV_FILE"
            echo "INTERVIEW_JWT_SECRET=$RAND_SECRET" >> "$ENV_FILE"
            echo "✅ INTERVIEW_JWT_SECRET added."
        fi
    else
        echo "✅ INTERVIEW_JWT_SECRET already exists — not overwriting."
    fi
    if ! grep -q "^ENCRYPTION_KEY=" "$ENV_FILE"; then
        echo "⚠️ ENCRYPTION_KEY is missing from $ENV_FILE!"
        echo "   Please set it manually: openssl rand -base64 32"
        echo "   Deployment will continue but encrypted data will be inaccessible."
    else
        echo "✅ ENCRYPTION_KEY already exists — not overwriting."
    fi
else
    echo "⚠️ Warning: backend/.env file not found. Skipping auto-injection."
fi

# 1. Determine active environment
# Deterministically read active upstream from nginx.conf first
ACTIVE_ENV=$(grep -oP '(?<=server frontend_)(blue|green)' nginx.conf | head -n 1 || true)

# Fallback to docker ps if nginx.conf couldn't be parsed
if [ -z "$ACTIVE_ENV" ]; then
    ACTIVE_ENV=$(docker ps --format "{{.Names}}" | grep -E "frontend_(blue|green)" | head -n 1 | grep -oP '(?<=frontend_)(blue|green)' || true)
fi

if [ -z "$ACTIVE_ENV" ]; then
    ACTIVE_ENV="green" # Default to green so we deploy blue first
fi

if [ "$ACTIVE_ENV" == "blue" ]; then
    DEPLOY_ENV="green"
else
    DEPLOY_ENV="blue"
fi

echo "Active environment is: $ACTIVE_ENV. Deploying to: $DEPLOY_ENV"

# 2. Clean state for target deploy environment and prune old build cache
echo "🧹 Stopping any stale containers for $DEPLOY_ENV before rebuild..."
docker compose -f docker-compose.prod.yml stop frontend_$DEPLOY_ENV backend_$DEPLOY_ENV worker_$DEPLOY_ENV 2>/dev/null || true

echo "🧹 Pruning old Docker images and build cache..."
docker system prune -f --filter "until=24h" || true

# 2. Build and boot the new environment safely in the background
echo "🏗️ Building and starting $DEPLOY_ENV environment..."
docker compose -f docker-compose.prod.yml up -d --build frontend_$DEPLOY_ENV backend_$DEPLOY_ENV

# 3. Wait for Healthchecks (Wait up to 180 seconds)
# Startup migrations can take up to 60s; 180s total gives sufficient margin.
echo "⌛ Waiting for $DEPLOY_ENV backend & frontend to become healthy (up to 180s)..."
MAX_RETRIES=36
RETRY_COUNT=0
HEALTH_OK=false

# Dynamically find the exact container IDs created by docker compose
BACKEND_CONTAINER=$(docker compose -f docker-compose.prod.yml ps -q backend_$DEPLOY_ENV || true)
FRONTEND_CONTAINER=$(docker compose -f docker-compose.prod.yml ps -q frontend_$DEPLOY_ENV || true)

echo "Watching backend: ${BACKEND_CONTAINER:-unknown}, frontend: ${FRONTEND_CONTAINER:-unknown}"

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    sleep 5
    RETRY_COUNT=$((RETRY_COUNT + 1))

    # Re-evaluate container IDs if they were not yet resolved
    if [ -z "$BACKEND_CONTAINER" ]; then
        BACKEND_CONTAINER=$(docker compose -f docker-compose.prod.yml ps -q backend_$DEPLOY_ENV || true)
    fi
    if [ -z "$FRONTEND_CONTAINER" ]; then
        FRONTEND_CONTAINER=$(docker compose -f docker-compose.prod.yml ps -q frontend_$DEPLOY_ENV || true)
    fi

    # Check container status
    BACKEND_STATUS=$(docker inspect --format='{{.State.Status}}' $BACKEND_CONTAINER 2>/dev/null || echo "starting")
    FRONTEND_STATUS=$(docker inspect --format='{{.State.Status}}' $FRONTEND_CONTAINER 2>/dev/null || echo "starting")

    echo "Status: backend=$BACKEND_STATUS, frontend=$FRONTEND_STATUS ($((RETRY_COUNT * 5))s / 180s)"

    if [ "$BACKEND_STATUS" != "running" ] || [ "$FRONTEND_STATUS" != "running" ]; then
        continue
    fi

    # Active verification: live HTTP probe directly into backend and frontend
    BACKEND_PROBE=$(docker exec $BACKEND_CONTAINER curl -fsS http://localhost:10000/health 2>/dev/null || echo "")
    if [[ "$BACKEND_PROBE" == *"\"status\":\"healthy\""* ]] || [[ "$BACKEND_PROBE" == *"\"status\": \"healthy\""* ]]; then
        FRONTEND_PROBE=$(docker exec $FRONTEND_CONTAINER curl -fsS http://localhost:3000/calrims/api/health/ 2>/dev/null || echo "")
        if [ -n "$FRONTEND_PROBE" ]; then
            HEALTH_OK=true
            echo "✅ Direct health probe passed for both backend and frontend ($DEPLOY_ENV)."
            break
        fi
    fi
done

if [ "$HEALTH_OK" != "true" ]; then
    echo "❌ DEPLOYMENT FAILED: Health verification failed on $DEPLOY_ENV after 180 seconds."
    echo "=== Backend logs ==="
    docker logs $BACKEND_CONTAINER --tail=50 2>&1 || true
    echo "=== Frontend logs ==="
    docker logs $FRONTEND_CONTAINER --tail=50 2>&1 || true
    docker compose -f docker-compose.prod.yml stop frontend_$DEPLOY_ENV backend_$DEPLOY_ENV
    exit 1
fi

echo "✅ New environment $DEPLOY_ENV is healthy."

# 4. Traffic Switching
echo "🔀 Switching NGINX traffic to $DEPLOY_ENV..."
# Use a temporary file and 'cat' to preserve the inode, ensuring Docker bind-mounts update correctly
sed "s/frontend_$ACTIVE_ENV:3000/frontend_$DEPLOY_ENV:3000/g" nginx.conf > nginx.conf.tmp
sed -i "s/backend_$ACTIVE_ENV:10000/backend_$DEPLOY_ENV:10000/g" nginx.conf.tmp
cat nginx.conf.tmp > nginx.conf
rm nginx.conf.tmp

echo "📋 nginx.conf now routes to: $DEPLOY_ENV"
grep -E "server (frontend|backend)_" nginx.conf || true

# Wait for nginx container to be in a running (not restarting) state before reloading
echo "⏳ Ensuring nginx container is running before reload..."
NGINX_RETRIES=12
NGINX_COUNT=0
NGINX_STATUS="restarting"

# Dynamically find the Nginx container name to handle prefixes/suffixes correctly
NGINX_CONTAINER_NAME=$(docker ps --format '{{.Names}}' -f "name=nginx" | head -n 1)
if [ -z "$NGINX_CONTAINER_NAME" ]; then
    echo "⚠️ Warning: Could not find container for nginx. Defaulting to rims-nginx-1"
    NGINX_CONTAINER_NAME="rims-nginx-1"
fi

echo "Watching nginx container: $NGINX_CONTAINER_NAME"

while [ "$NGINX_STATUS" != "running" ] && [ $NGINX_COUNT -lt $NGINX_RETRIES ]; do
    sleep 5
    NGINX_STATUS=$(docker inspect --format='{{.State.Status}}' $NGINX_CONTAINER_NAME 2>/dev/null || echo "unknown")
    echo "Nginx status: $NGINX_STATUS ($((NGINX_COUNT * 5))s / 60s)"
    NGINX_COUNT=$((NGINX_COUNT + 1))
done

if [ "$NGINX_STATUS" != "running" ]; then
    echo "⚠️ Nginx is not running (status: $NGINX_STATUS). Attempting to start it..."
    docker compose -f docker-compose.prod.yml up -d nginx
    sleep 10
    # Re-evaluate status after attempting to start
    NGINX_STATUS=$(docker inspect --format='{{.State.Status}}' $NGINX_CONTAINER_NAME 2>/dev/null || echo "unknown")
fi

# Restart nginx to ensure Docker propagates the bind-mounted nginx.conf file changes and picks up the new upstream
docker compose -f docker-compose.prod.yml restart nginx
echo "✅ Traffic successfully routed to $DEPLOY_ENV."

# 5. Stabilize (Observability Window) & Automated Inactive Environment Teardown
echo "🛑 Keeping old environment '$ACTIVE_ENV' alive for 15 minutes for instant rollback coverage..."
# Spin down old environment after 15 minutes in a detached background subshell to prevent memory/CPU waste and log spam
(
    sleep 900
    echo "🧹 Teardown: Stopping inactive environment '$ACTIVE_ENV' after 15-minute stabilization window..."
    docker compose -f docker-compose.prod.yml stop frontend_$ACTIVE_ENV backend_$ACTIVE_ENV worker_$ACTIVE_ENV 2>/dev/null || true
) >/dev/null 2>&1 &

echo "🎉 ZERO-DOWNTIME DEPLOYMENT COMPLETE."
