"""Bake nine map-specific Valve sky panoramas for the lightweight renderer.

Inputs: CS2 pak01_dir.vpk and its referenced numbered siblings; VRF CLI. Uses
Node (for the existing index parser), numpy, OpenCV with OpenEXR, and Pillow.
Work files are reusable. Revalidate the compiled texture and material CRCs on
every run, so changing game versions cannot reuse an old EXR.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import zlib

os.environ.setdefault("OPENCV_IO_ENABLE_OPENEXR", "1")
import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
MAPS = json.loads((ROOT / "shared/performance-skies.json").read_text())


def read_index(index):
    query = """import {readVpkIndex} from './tools/vpk-index.mjs';
    console.log(JSON.stringify(readVpkIndex(process.argv[1]).entries.filter(
      e=>/sky/i.test(e.path)&&/\\.(vmat|vtex)_c$/.test(e.path))));"""
    result = subprocess.run(["node", "--input-type=module", "-e", query, str(index)],
                            cwd=ROOT, capture_output=True, check=True)
    return {entry["path"]: entry for entry in json.loads(result.stdout)}


def decode(entry, index, vrf, work, extension):
    archive = index.with_name("pak01_%03d.vpk" % entry["archiveIndex"])
    with archive.open("rb") as handle:
        handle.seek(entry["offset"])
        data = handle.read(entry["length"])
    if entry["preloadBytes"] or len(data) != entry["length"] or zlib.crc32(data) != entry["crc"]:
        raise ValueError("Incomplete archive or wrong Steam manifest: " + entry["path"])
    folder = work / ("%08x" % entry["crc"])
    folder.mkdir(parents=True, exist_ok=True)
    compiled = folder / Path(entry["path"]).name
    result = compiled.with_suffix(extension)
    if not result.is_file():
        compiled.write_bytes(data)
        subprocess.run([str(vrf), "-i", str(compiled), "-o", str(folder), "-d"],
                       check=True, stdout=subprocess.DEVNULL)
    return result


def add_cloud_layer(rgb, strength, solar):
    # Several Source maps use a smooth env_sky plus independent sky geometry.
    # Composite the existing CC0 Kloofendal photograph at bake time. Align
    # azimuth using the VMAT's solar direction and preserve the native horizon.
    cloud = cv2.imread(str(ROOT / "public/assets/sky/daylight.hdr"), cv2.IMREAD_UNCHANGED)
    height, width = rgb.shape[:2]
    cloud = cv2.resize(cloud, (width, height), interpolation=cv2.INTER_AREA)[:, :, ::-1]
    _, sun_x = np.unravel_index(np.argmax(cloud[:height // 2].sum(axis=2)), (height // 2, width))
    if solar:
        x, y, _ = map(float, solar.strip("[]").split()[:3])
        target = round(np.arctan2(-y, x) * width / (2 * np.pi))
        cloud = np.roll(cloud, target - sun_x, axis=1)
    # Match the photographed sky's exposure to the map before compositing.
    upper = slice(height // 8, height // 3)
    cloud = cloud * np.clip(np.median(rgb[upper]) / max(.001, np.median(cloud[upper])), .35, 1.8)
    t = np.clip((.51 - np.arange(height) / height) * 12, 0, 1).reshape(-1, 1, 1)
    weight = strength * t * t * (3 - 2 * t)
    return (rgb + (cloud - rgb) * weight).astype("float32")


def bake(args):
    entries = read_index(args.index)
    args.output.mkdir(parents=True, exist_ok=True)
    for map_id, sky in MAPS.items():
        if args.maps and map_id not in args.maps:
            continue
        material = decode(entries[sky["material"] + ".vmat_c"], args.index,
                          args.vrf, args.work, ".vmat").read_text(encoding="utf-8")
        values = dict(re.findall(r'"([^"]+)"\s+"([^"]*)"', material))
        texture = entries[values["g_tSkyTexture"] + "_c"]
        exr = decode(texture, args.index, args.vrf, args.work, ".exr")
        rgba = cv2.imread(str(exr), cv2.IMREAD_UNCHANGED)
        if rgba is None or rgba.dtype != np.float32 or rgba.shape[1] != 2 * rgba.shape[0]:
            raise ValueError("Expected a linear 2:1 HDR panorama: " + str(exr))
        width = min(1536, rgba.shape[1])
        rgb = cv2.resize(rgba[:, :, :3], (width, width // 2), interpolation=cv2.INTER_AREA)[:, :, ::-1]
        exposure = sum(float(values.get(key, 0)) for key in
                       ("g_flBrightnessExposureBias", "g_flRenderOnlyExposureBias"))
        rgb = np.maximum(rgb, 0) * (sky["exposure"] * 2 ** exposure)
        if sky.get("cloudLayer"):
            rgb = add_cloud_layer(rgb, sky["cloudLayer"], values.get("SolarPosition"))
        # Compress HDR highlights in linear light before the final sRGB transfer.
        ldr = np.clip((rgb * (2.51 * rgb + 0.03)) / (rgb * (2.43 * rgb + 0.59) + 0.14), 0, 1)
        srgb = np.where(ldr <= 0.0031308, ldr * 12.92, 1.055 * ldr ** (1 / 2.4) - 0.055)
        output = args.output / (map_id + ".webp")
        Image.fromarray(np.rint(srgb * 255).astype("uint8")).save(output, quality=86, method=6)
        print(f"{map_id}: {texture['path']}, {width}x{width // 2}, {output.stat().st_size} bytes", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("index", type=lambda path: Path(path).resolve())
    parser.add_argument("--vrf", type=lambda path: Path(path).resolve(),
                        default=ROOT / "tools/source2viewer/Source2Viewer-CLI.exe")
    parser.add_argument("--work", type=lambda path: Path(path).resolve(), required=True)
    parser.add_argument("--output", type=Path, default=ROOT / "client/flat-skies")
    parser.add_argument("--maps", nargs="*", choices=MAPS)
    bake(parser.parse_args())
