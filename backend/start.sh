#!/usr/bin/env bash

# Resolve the script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PORT=10000
PID_FILE="./.backend.pid"

# Find virtual environment directory
VENV_DIR=""
if [ -d ".venv" ]; then
    VENV_DIR=".venv"
elif [ -d "venv" ]; then
    VENV_DIR="venv"
fi

# ---------------------------------------------------------------------------
# Aggressively free port 10000 regardless of whether the process is alive.
# Strategy:
#   1. Kill the saved PID from the last run
#   2. Kill every PID using the port
#   3. Wait up to 20 s for the OS to release the socket
# ---------------------------------------------------------------------------
Clear-Port() {
    echo -e "\e[36mClearing port $PORT...\e[0m"

    # -- Step 1: kill the saved PID from the previous run -------------------
    if [ -f "$PID_FILE" ]; then
        local savedPid
        savedPid=$(cat "$PID_FILE" 2>/dev/null)
        if [[ "$savedPid" =~ ^[0-9]+$ ]]; then
            echo "  Killing saved PID $savedPid and its children..."
            # Kill the process and any subprocesses
            kill -15 "$savedPid" 2>/dev/null || true
            sleep 0.5
            kill -9 "$savedPid" 2>/dev/null || true
        fi
        rm -f "$PID_FILE" 2>/dev/null || true
    fi

    # -- Step 2: kill any remaining process found on port -------------------
    local netPids=""
    if command -v lsof >/dev/null 2>&1; then
        netPids=$(lsof -t -i :"$PORT" 2>/dev/null)
    elif command -v fuser >/dev/null 2>&1; then
        netPids=$(fuser "$PORT"/tcp 2>/dev/null | awk '{print $NF}')
    elif command -v ss >/dev/null 2>&1; then
        netPids=$(ss -lptn "sport = :$PORT" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | sort -u)
    fi

    if [ -n "$netPids" ]; then
        for netPid in $netPids; do
            if [[ "$netPid" =~ ^[0-9]+$ ]] && [ "$netPid" -gt 0 ]; then
                echo "  Killing PID $netPid on port $PORT..."
                kill -15 "$netPid" 2>/dev/null || true
                sleep 0.2
                kill -9 "$netPid" 2>/dev/null || true
            fi
        done
    fi

    # -- Step 3: wait up to 20 s for the OS to release the socket ----------
    local waited=0
    while [ $waited -lt 20 ]; do
        local still=""
        if command -v lsof >/dev/null 2>&1; then
            still=$(lsof -i :"$PORT" -sTCP:LISTEN 2>/dev/null)
        elif command -v ss >/dev/null 2>&1; then
            still=$(ss -lptn "sport = :$PORT" 2>/dev/null | grep -E ":$PORT\b")
        elif command -v netstat >/dev/null 2>&1; then
            still=$(netstat -ano 2>/dev/null | grep -E ":$PORT\b.*LISTEN")
        fi

        if [ -z "$still" ]; then
            break
        fi
        sleep 1
        waited=$((waited + 1))
        if [ $((waited % 5)) -eq 0 ]; then
            echo -e "\e[33m  Waiting for port $PORT to free... ($waited/20 s)\e[0m"
        fi
    done

    local final=""
    if command -v lsof >/dev/null 2>&1; then
        final=$(lsof -i :"$PORT" 2>/dev/null)
    elif command -v ss >/dev/null 2>&1; then
        final=$(ss -lptn "sport = :$PORT" 2>/dev/null | grep -E ":$PORT\b")
    fi

    if [ -n "$final" ]; then
        echo -e "\e[33m  Note: Port $PORT may still show as active but SO_REUSEADDR will bypass it.\e[0m"
    fi
}

Stop-Backend() {
    echo "Stopping backend on port $PORT..."
    Clear-Port
    echo "Backend stopped."
}

Test-Environment() {
    local deep=$1
    echo "Checking environment health..."

    if [ -z "$VENV_DIR" ]; then
        echo -e "\e[33mWarning: No virtual environment (.venv or venv) found! Please run './start.sh repair' to set it up.\e[0m"
        return 1
    fi

    local python_bin="$VENV_DIR/bin/python"
    if [ ! -f "$python_bin" ]; then
        echo -e "\e[31mError: Failed to run python from venv. Python executable not found.\e[0m"
        return 1
    fi

    local pyVersion
    pyVersion=$("$python_bin" -c "import sys; print(f'{sys.version_info.major}{sys.version_info.minor}')" 2>/dev/null)
    if [ $? -ne 0 ] || [ -z "$pyVersion" ]; then
        echo -e "\e[31mError: Failed to run python from venv.\e[0m"
        return 1
    fi

    if [ "$deep" = "true" ]; then
        local expectedSuffix="cp$pyVersion"
        local site_packages=""
        if [ -d "$VENV_DIR/lib" ]; then
            site_packages=$(find "$VENV_DIR/lib" -maxdepth 2 -type d -name "site-packages" | head -n 1)
        fi
        if [ -n "$site_packages" ] && [ -d "$site_packages" ]; then
            local mismatched=""
            local so_files
            so_files=$(find "$site_packages" -name "*.so" | head -n 20)
            for file in $so_files; do
                local filename
                filename=$(basename "$file")
                if [[ "$filename" =~ cp[0-9]+ ]]; then
                    if [[ ! "$filename" =~ $expectedSuffix ]]; then
                        mismatched="$file"
                        break
                    fi
                fi
            done

            if [ -n "$mismatched" ]; then
                local foundVersion
                foundVersion=$(echo "$mismatched" | grep -oE 'cp[0-9]+' | head -n 1 | sed 's/cp//')
                echo -e "\e[31mCRITICAL: Detected Python version mismatch in venv components!\e[0m"
                echo -e "\e[31mEnvironment packages are for CP$foundVersion but you are running CP$pyVersion.\e[0m"
                echo -e "\e[33mACTION REQUIRED: Run './start.sh repair' to fix your environment.\e[0m"
                return 1
            fi
        fi
    fi

    echo -e "\e[32mEnvironment health check passed.\e[0m"
    return 0
}

Repair-Environment() {
    echo -e "\e[36mStarting environment repair... This may take several minutes.\e[0m"
    Stop-Backend

    if [ ! -f "requirements_core.txt" ]; then
        echo "Generating core requirements file..."
        if [ -f "requirements.txt" ]; then
            grep -v "chromadb" requirements.txt > requirements_core.txt
        else
            echo -e "\e[31mError: requirements.txt not found. Cannot proceed.\e[0m"
            return 1
        fi
    fi

    echo "Cleaning up corrupted and mismatched packages..."
    if [ -d "$VENV_DIR" ]; then
        find "$VENV_DIR" -name "~*" -exec rm -rf {} + 2>/dev/null || true
    fi

    local python_bin="$VENV_DIR/bin/python"
    if [ ! -f "$python_bin" ]; then
        echo -e "\e[31mError: Python executable not found in $VENV_DIR.\e[0m"
        return 1
    fi

    local pyVersion
    pyVersion=$("$python_bin" -c "import sys; print(f'{sys.version_info.major}{sys.version_info.minor}')")
    local expectedSuffix="cp$pyVersion"

    local site_packages=""
    if [ -d "$VENV_DIR/lib" ]; then
        site_packages=$(find "$VENV_DIR/lib" -maxdepth 2 -type d -name "site-packages" | head -n 1)
    fi
    if [ -n "$site_packages" ] && [ -d "$site_packages" ]; then
        local mismatched_so
        mismatched_so=$(find "$site_packages" -name "*.so" | while read -r file; do
            local filename
            filename=$(basename "$file")
            if [[ "$filename" =~ cp[0-9]+ ]]; then
                if [[ ! "$filename" =~ $expectedSuffix ]]; then
                    echo "$file"
                fi
            fi
        done)

        if [ -n "$mismatched_so" ]; then
            local count
            count=$(echo "$mismatched_so" | wc -l)
            echo -e "\e[33mRemoving $count mismatched compiled extensions...\e[0m"
            echo "$mismatched_so" | xargs rm -f 2>/dev/null || true
        fi
    fi

    echo "Force-reinstalling dependencies for the current Python version..."
    if command -v uv >/dev/null 2>&1; then
        uv pip install --force-reinstall -r requirements_core.txt
    else
        "$python_bin" -m pip install --force-reinstall -r requirements_core.txt
    fi

    if [ $? -eq 0 ]; then
        echo -e "\e[32mRepair complete! Your environment is now healthy.\e[0m"
    else
        echo -e "\e[31mRepair failed. Please check the logs above.\e[0m"
        return 1
    fi
}

Start-Backend() {
    if ! Test-Environment; then
        exit 1
    fi

    # Kill any orphaned processes — TIME_WAIT zombies will be bypassed by
    # SO_REUSEADDR in run_server.py, so we don't abort if the port "looks" busy.
    Clear-Port

    # Guard: backend must only be started via this script.
    export BACKEND_START_MODE="script"

    # Activate virtual environment
    if [ -f "$VENV_DIR/bin/activate" ]; then
        source "$VENV_DIR/bin/activate"
    fi

    echo -e "\e[32mStarting backend on port $PORT...\e[0m"

    # Set UTF-8 encoding so emoji/Unicode in log lines don't crash
    export PYTHONIOENCODING="utf-8"

    echo "Server running on http://127.0.0.1:$PORT"
    # Run python directly so all logs and traceback output are displayed in the console
    python run_server.py
}

Restart-Backend() {
    Stop-Backend
    sleep 1
    Start-Backend
}

ACTION=${1:-"start"}

case "$ACTION" in
    "start")
        Start-Backend
        ;;
    "stop")
        Stop-Backend
        ;;
    "restart")
        Restart-Backend
        ;;
    "repair")
        Repair-Environment
        ;;
    "check")
        Test-Environment "true"
        ;;
    *)
        echo "Usage: ./start.sh [start|stop|restart|repair|check]"
        ;;
esac
