"""One-time download of Moondream 2 weights into MOONDREAM_MODEL_DIR."""
from __future__ import annotations
import os
import sys
from huggingface_hub import snapshot_download

REPO = "vikhyatk/moondream2"
TARGET = os.environ.get("MOONDREAM_MODEL_DIR", "./models/moondream2")


def main() -> int:
    print(f"Downloading {REPO} → {TARGET} (this is ~2 GB) ...")
    snapshot_download(repo_id=REPO, local_dir=TARGET, local_dir_use_symlinks=False)
    print("done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
