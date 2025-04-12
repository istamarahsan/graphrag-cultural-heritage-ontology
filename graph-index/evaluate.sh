#!/bin/bash

# Script to run KBQA evaluation on generated RDF Turtle files.
#
# Assumes a directory structure like:
# ./out/run/
#     <model_config_X>/
#         simple/
#             data1.ttl
#         ontology/
#             data1.ttl
#     <model_config_Y>/
#         ...
#
# And runs a Deno script against each .ttl file found in the
# 'simple' and 'ontology' subdirectories.

# Exit immediately if a command exits with a non-zero status.
set -e
# Treat unset variables as an error when substituting.
set -u
# Pipe failures should exit script
set -o pipefail

# --- Configuration ---
# Path to the Deno QA testing script (relative to script execution dir)
readonly QA_SCRIPT="./test-qa.ts"
# Path to the QA data file (relative to script execution dir)
readonly QA_FILE="./data/qa.json"
# Base directory containing the run folders (e.g., model_config_X)
readonly BASE_DIR="./out/run"

# --- Helper Functions ---
log_info() {
  # Using current date, assuming script runs near the context time provided
  echo "[INFO] $(date +'%Y-%m-%d %H:%M:%S') - $1"
}

log_error() {
  echo "[ERROR] $(date +'%Y-%m-%d %H:%M:%S') - $1" >&2
}

# --- Pre-flight Checks ---
if [ ! -d "$BASE_DIR" ]; then
    log_error "Base directory '$BASE_DIR' not found."
    exit 1
fi
if [ ! -f "$QA_SCRIPT" ]; then
    log_error "QA script '$QA_SCRIPT' not found."
    exit 1
fi
if [ ! -f "$QA_FILE" ]; then
    log_error "QA data file '$QA_FILE' not found."
    exit 1
fi
if ! command -v deno &> /dev/null; then
    log_error "Deno command not found. Please install Deno."
    exit 1
fi

# --- Main Processing Loop ---
log_info "Starting KBQA evaluation for TTL files in '$BASE_DIR'"
log_info "Using QA script: '$QA_SCRIPT'"
log_info "Using QA data: '$QA_FILE'"
log_info "---"

# Blank run
log_info "Running blank evaluation"
deno -A "$QA_SCRIPT" -q "$QA_FILE"
# Find all .ttl files within */simple/ or */ontology/ subdirectories
# Use -print0 and read -d $'\0' for robust handling of filenames
find "$BASE_DIR" -type f -name '*.ttl' \( -path '*/simple/*' -o -path '*/ontology/*' \) -print0 | while IFS= read -r -d $'\0' ttl_file; do
    log_info "Running QA evaluation for: $ttl_file"
    if deno -A "$QA_SCRIPT" -q "$QA_FILE" -t "$ttl_file"; then
        log_info "  Successfully completed QA for '$ttl_file'."
    else
        log_error "  QA script failed for '$ttl_file'."
    fi
    log_info "---"

done # End of while loop reading files

log_info "All QA evaluations attempted."
exit 0