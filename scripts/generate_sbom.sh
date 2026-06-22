#!/bin/bash
# Phase 4: Supply Chain Integrity - SBOM Generation

set -e

echo "=== ATP Gateway: Generating SBOMs ==="

# Define where to put the outputs
OUTPUT_DIR="$(pwd)"
ENGINE_SBOM="$OUTPUT_DIR/engine-sbom.cdx.json"
SDK_SBOM="$OUTPUT_DIR/sdk-sbom.cdx.json"
COMBINED_SBOM="$OUTPUT_DIR/sbom.cdx.json"

# Check if syft is installed
if ! command -v syft &> /dev/null
then
    echo "Syft is not installed. Please install it first:"
    echo "curl -sSfL https://raw.githubusercontent.com/anchore/syft/main/install.sh | sh -s -- -b /usr/local/bin"
    exit 1
fi

echo "[1/3] Generating SBOM for Go Engine..."
syft scan dir:./engine -o cyclonedx-json > "$ENGINE_SBOM"

echo "[2/3] Generating SBOM for Python SDK..."
syft scan dir:./sdk -o cyclonedx-json > "$SDK_SBOM"

echo "[3/3] Merging SBOMs (assuming simple concatenation for now or you can use cyclonedx-cli to merge properly)"
# Ideally, we use cyclonedx-cli to merge, but we'll output side-by-side for the MVP
cat <<EOF > "$COMBINED_SBOM"
{
  "engine_sbom_path": "./engine-sbom.cdx.json",
  "sdk_sbom_path": "./sdk-sbom.cdx.json"
}
EOF

echo "SUCCESS: SBOM generation complete. Artifacts saved in $OUTPUT_DIR"
