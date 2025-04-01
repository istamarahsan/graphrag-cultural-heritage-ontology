#!/bin/bash

# --- Configuration ---
root_dir="experiment"
data_file="out/data/museum_short.json"
# ---------------------

# Function to process config files in a subfolder
process_subfolder() {
  local subfolder="$1"
  local subfolder_name=$(basename "$subfolder")

  echo "Starting background processing for subfolder: $subfolder_name"
  (
    echo "Processing config files in: $subfolder_name"
    for config_file in "$subfolder"/*.json; do
      local config_filename=$(basename "$config_file")
      # Ignore config files starting with "_"
      if [[ "$config_filename" != _* ]]; then
        if [ -f "$config_file" ]; then
          local full_command="deno --allow-all extract-graph.ts -f \"$data_file\" -c \"$config_file\""
          echo "  Executing in $subfolder_name: $full_command"
          eval "$full_command"
        fi
      fi
    done
    echo "Finished processing subfolder: $subfolder_name"
  ) &
  disown -h

  local pid=$!
  echo "Background process started for $subfolder_name with PID: $pid"
}

# Find all subdirectories in the root directory, ignoring those starting with "_"
find "$root_dir" -maxdepth 1 -type d -not -name "_*" -print0 | while IFS= read -r -d $'\0' subfolder; do
  if [ "$subfolder" != "$root_dir" ]; then
    process_subfolder "$subfolder"
  fi
done

echo "Started background processing for all eligible subfolders."