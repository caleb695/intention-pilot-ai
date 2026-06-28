#!/usr/bin/env bash
# Push the operator/ folder to a Hugging Face Space as the repo root.
# Usage: ./operator/scripts/push_to_hf.sh <hf-username> <space-name>
#
# Example:
#   ./operator/scripts/push_to_hf.sh johndoe operator
#
# The script clones the Space, copies the contents of operator/ into it,
# commits, and pushes. You will be prompted for your HF access token.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPERATOR_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ROOT="$(cd "$OPERATOR_DIR/.." && pwd)"

USERNAME="${1:-}"
SPACE_NAME="${2:-}"

if [[ -z "$USERNAME" || -z "$SPACE_NAME" ]]; then
  echo "Usage: $0 <hf-username> <space-name>"
  echo "Example: $0 johndoe operator"
  exit 1
fi

HF_REPO="https://huggingface.co/spaces/$USERNAME/$SPACE_NAME"
WORK_DIR="$PROJECT_ROOT/.hf-operator-push"

echo "Target Space: $HF_REPO"
echo "Source:       $OPERATOR_DIR"
echo "Working dir:  $WORK_DIR"
echo ""

# Remove any old working directory and recreate it.
rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"

# Clone the Space repo (may be empty with just a README).
echo "Cloning Space repo..."
git clone "$HF_REPO" "$WORK_DIR"

# Remove the placeholder README if it's the only file.
# (If there are other files, this is a re-deploy; keep them until overwritten.)
if [[ -f "$WORK_DIR/README.md" ]]; then
  rm "$WORK_DIR/README.md"
fi

# Copy the operator/ contents into the repo root.
# The trailing /* plus hidden files ensures the root contains app/, web/, etc.
echo "Copying operator/ contents into repo root..."
cp -R "$OPERATOR_DIR"/* "$WORK_DIR/"
for hidden in "$OPERATOR_DIR"/.[^.]*; do
  if [[ -e "$hidden" ]]; then
    cp -R "$hidden" "$WORK_DIR/"
  fi
done

cd "$WORK_DIR"

# Initialize git LFS in case we add large files later.
git lfs install 2>/dev/null || true

git add .

if git diff --cached --quiet; then
  echo "No changes to push."
  exit 0
fi

git commit -m "Operator deploy from local operator/ folder"

echo ""
echo "Pushing to Hugging Face..."
echo "When prompted, use your HF username and an access token with write scope."
echo "Get one at: https://huggingface.co/settings/tokens"
echo ""

git push

echo ""
echo "Done. The Space should now be building."
echo "Watch the build logs at: $HF_REPO"
