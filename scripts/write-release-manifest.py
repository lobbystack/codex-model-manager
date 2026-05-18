#!/usr/bin/env python3
import hashlib
import json
import os
import pathlib
import sys
from datetime import datetime, timezone

version, asset_dir, output = sys.argv[1:4]
root = pathlib.Path(asset_dir)
repository = os.environ["GITHUB_REPOSITORY"]
assets = []

for path in sorted(root.glob("codex-model-manager-*")):
    if path.suffix == ".sha256":
        continue

    name = path.name
    parts = name.removeprefix("codex-model-manager-").split(".")[0].split("-")
    platform = parts[0]
    arch = parts[1]
    fmt = "zip" if name.endswith(".zip") else "tar.gz"
    sha256 = hashlib.sha256(path.read_bytes()).hexdigest()
    assets.append(
        {
            "platform": platform,
            "arch": arch,
            "format": fmt,
            "url": f"https://github.com/{repository}/releases/latest/download/{name}",
            "sha256": sha256,
        }
    )

manifest = {
    "version": version,
    "notes": "",
    "publishedAt": datetime.now(timezone.utc).isoformat(),
    "assets": assets,
}

pathlib.Path(output).write_text(json.dumps(manifest, indent=2) + "\n")
