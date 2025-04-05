#!/bin/bash

# Script to process JSONL graph data, convert to RDF, and compute embeddings.
#
# Structure Expected:
# ./out/run/
#     <model_config_X>/
#         simple/
#             data1.jsonl
#             data2.jsonl
#         ontology/
#             data1.jsonl
#             data2.jsonl
#     <model_config_Y>/
#         ...

# Exit immediately if a command exits with a non-zero status.
set -e
# Treat unset variables as an error when substituting.
set -u
# Pipe failures should exit script
set -o pipefail

# --- Configuration ---
# Base directory containing the run folders (e.g., model_config_X)
readonly BASE_DIR="./out/run"
# Path to the embedding config file (relative to script execution dir)
readonly CONFIG_FILE="./embed.json"
# Deno script paths (relative to script execution dir)
readonly CONVERTER_SCRIPT="./tuples-to-graph.js"
readonly EMBEDDER_SCRIPT="./node-embeddings.ts"

# --- Helper Functions ---
log_info() {
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
if [ ! -f "$CONFIG_FILE" ]; then
    log_error "Embedding config file '$CONFIG_FILE' not found."
    exit 1
fi
 if [ ! -f "$CONVERTER_SCRIPT" ]; then
    log_error "Converter script '$CONVERTER_SCRIPT' not found."
    exit 1
fi
 if [ ! -f "$EMBEDDER_SCRIPT" ]; then
    log_error "Embedder script '$EMBEDDER_SCRIPT' not found."
    exit 1
fi
if ! command -v deno &> /dev/null; then
    log_error "Deno command not found. Please install Deno."
    exit 1
fi


# --- Main Processing Loop ---
log_info "Starting processing for JSONL files in '$BASE_DIR'"
log_info "Using config: '$CONFIG_FILE'"
log_info "Converter script: '$CONVERTER_SCRIPT'"
log_info "Embedder script: '$EMBEDDER_SCRIPT'"
log_info "---"

# Find all .jsonl files within */simple/ or */ontology/ subdirectories
# Use -print0 and read -d $'\0' for robust handling of various filenames
find "$BASE_DIR" -type f -name '*.jsonl' \( -path '*/simple/*' -o -path '*/ontology/*' \) -print0 | while IFS= read -r -d $'\0' jsonl_file; do
    log_info "Processing file: $jsonl_file"

    # Extract directory path, base filename (without .jsonl), and type (simple/ontology)
    dir_path=$(dirname "$jsonl_file")
    base_name=$(basename "$jsonl_file" .jsonl)
    subfolder_type=$(basename "$dir_path") # This should be 'simple' or 'ontology'
    # Construct the expected output RDF filename (assuming .ttl extension)
    rdf_file="${dir_path}/${base_name}.ttl"

    # Validate extracted type - ensures we are in the correct subfolder
    if [[ "$subfolder_type" != "simple" && "$subfolder_type" != "ontology" ]]; then
        log_error "Could not determine type ('simple' or 'ontology') for '$jsonl_file' based on parent directory '$dir_path'. Skipping."
        continue # Skip to the next file
    fi

    # --- Step 1: Run RDF Converter ---
    log_info "  Running converter for '$base_name.jsonl' (type: $subfolder_type)..."
    if deno run  -A "$CONVERTER_SCRIPT" -f "$jsonl_file" -t "$subfolder_type"; then
        log_info "  Converter finished successfully."
        # Basic check if the output file seems to exist now
        if [ ! -f "$rdf_file" ]; then
             log_error "Converter completed but output RDF file '$rdf_file' was not found. Cannot proceed with embedding for this file."
             continue # Skip to the next file
        fi
         log_info "  Output RDF file: $rdf_file"
    else
        log_error "Converter script failed for '$jsonl_file'. Skipping embedding."
        # set -e will cause exit here, but explicit message is good if set -e removed
        continue
    fi


    # --- Step 2: Compute Embeddings ---
    log_info "  Running embedder for '$base_name.ttl'..."
    if deno run -A "$EMBEDDER_SCRIPT" -f "$rdf_file" -c "$CONFIG_FILE"; then
        log_info "  Embedder finished successfully for '$rdf_file'."
    else
        log_error "Embedder script failed for '$rdf_file'."
        # set -e will cause exit here
        continue
    fi

    log_info "--- Completed processing for: $jsonl_file ---"

done # End of while loop reading files

log_info "All processing finished."
exit 0