"""Rebuild a sparse Train, Mirage and/or Vertigo ladder overlay from pinned map exports.

The base nine-map pool is read-only. The output directory must be new.
"""

import argparse
import gzip
import runpy
import shutil
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory

HERE = Path(__file__).resolve().parent
BLENDER_SCRIPTS = HERE / "source-ladders"
seal = runpy.run_path(str(HERE / "seal-performance-maps.py"))
read, write, sha = seal["read"], seal["write"], seal["sha"]
RENDER_FILES = ("render/map.gltf", "render/map.bin")


def sources(arguments):
    pins = read(BLENDER_SCRIPTS / "ladder-source-components.json")
    result = {}
    for value in arguments:
        key, separator, filename = value.partition("=")
        if not separator or key not in pins or key in result:
            raise ValueError(
                "Expected a unique supported map ID and glTF path, e.g. de_train=path/to/map.gltf"
            )
        file = Path(filename).resolve(strict=True)
        result[key] = file
    return result


def check_gameplay(base, ready):
    for name, reference in ready["gameplayHashes"].items():
        path = (
            base / name
            if name == "entity-collision-policy.json"
            else base / "compiled" / name
        )
        if reference != sha(path):
            raise ValueError(f"Gameplay file does not match the base release: {path}")
    baseline_gzip = sum(p.stat().st_size for p in base.rglob("*.gz"))
    if baseline_gzip != ready["gzipBytes"]:
        raise ValueError(f"Base transport sizes do not match READY.json: {base}")


def seal_render(base, folder):
    ready = read(base / "READY.json")
    check_gameplay(base, ready)
    model = read(folder / RENDER_FILES[0])
    seal["validate_model"](model, folder / RENDER_FILES[1])
    files = []
    for relative in RENDER_FILES:
        file = folder / relative
        compressed = file.with_suffix(file.suffix + ".gz")
        with (
            compressed.open("wb") as stream,
            gzip.GzipFile(
                filename="", mode="wb", compresslevel=9, fileobj=stream, mtime=0
            ) as zipped,
            file.open("rb") as data,
        ):
            shutil.copyfileobj(data, zipped)
        if gzip.decompress(compressed.read_bytes()) != file.read_bytes():
            raise ValueError(f"Invalid compressed stream: {compressed}")
        files.append(
            {"path": file.name, "sha256": sha(file), "bytes": file.stat().st_size}
        )
        ready["gzipBytes"] += (
            compressed.stat().st_size - (base / (relative + ".gz")).stat().st_size
        )
    render_bytes = sum(f["bytes"] for f in files)
    ready["rawBytes"] += render_bytes - ready["renderBytes"]
    ready["renderBytes"] = render_bytes
    ready["renderSha256"] = files[0]["sha256"]
    primitives = [p for mesh in model["meshes"] for p in mesh["primitives"]]
    ready["drawBatches"] = len(primitives)
    ready["triangles"] = sum(
        model["accessors"][p["indices"]]["count"] // 3
        for p in primitives
        if p.get("mode", 4) == 4
    )
    write(folder / "READY.json", ready)
    manifest = read(base / "render-manifest.json")
    manifest["files"] = files
    write(folder / "render-manifest.json", manifest)
    visibility = base / "flat-breakables.json"
    if visibility.is_file():
        data = read(visibility)
        for name, node in data["nodesById"].items():
            if model["nodes"][node]["name"] != name:
                raise ValueError(f"Breakable node moved: {name}")
        data["renderSha256"] = ready["renderSha256"]
        write(folder / visibility.name, data)
    return ready


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--base", required=True, type=Path, help="Existing release maps-v1 folder"
    )
    parser.add_argument(
        "--output",
        required=True,
        type=Path,
        help="New directory for overlay, manifest, catalog rows and build receipts",
    )
    parser.add_argument("--blender", default="blender", help="Blender executable")
    parser.add_argument(
        "--source",
        action="append",
        required=True,
        help="Repeat MAP_ID=/path/to/map.gltf for each map",
    )
    args = parser.parse_args()
    base = args.base.resolve(strict=True)
    output = args.output.resolve()
    if output.exists() or output.is_relative_to(base):
        raise ValueError("Choose a new output directory outside the base pool")
    selected = sources(args.source)
    output.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=output.parent) as staging:
        work = Path(staging)
        package = work / "package"
        receipts = package / "receipts"
        receipts.mkdir(parents=True)
        inventory, catalog_rows = {}, {}
        for key, source in selected.items():
            reference = base / key
            build = work / key
            folder = package / "overlay" / key
            for relative in (*RENDER_FILES, "compiled/map.json"):
                destination = build / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(reference / relative, destination)
            subprocess.run(
                [
                    args.blender,
                    "-b",
                    "--python-exit-code",
                    "2",
                    "--python",
                    str(BLENDER_SCRIPTS / "restore-source-ladders.py"),
                    "--",
                    str(build),
                    str(source),
                    str(receipts / f"{key}-bake.json"),
                ],
                check=True,
            )
            folder.mkdir(parents=True)
            (build / "render").rename(folder / "render")
            catalog_rows[key] = seal_render(reference, folder)
            for file in sorted(p for p in folder.rglob("*") if p.is_file()):
                relative = file.relative_to(folder)
                inventory[(Path(key) / relative).as_posix()] = {
                    "originalSha256": sha(reference / relative),
                    "sha256": sha(file),
                    "bytes": file.stat().st_size,
                }
        write(package / "catalog-replacements.json", catalog_rows)
        write(package / "overlay-files.json", inventory)
        package.rename(output)


if __name__ == "__main__":
    main()
