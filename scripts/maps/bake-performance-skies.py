"""Bake nine map-specific Valve sky panoramas for the lightweight renderer.

Inputs: CS2 pak01_dir.vpk and its referenced numbered siblings; VRF CLI. Uses
Node (for the existing index parser), numpy, OpenEXR, OpenCV and Pillow.
Work files are reusable. Revalidate the compiled texture and material CRCs on
every run, so changing game versions cannot reuse an old EXR.
"""
import argparse
import json
from pathlib import Path
import re
import subprocess
import zlib

import OpenEXR
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


def write_panorama(rgb, width, exposure, output):
    height = width // 2
    # Downsample and tone-map in linear light; transfer to sRGB only once.
    scaled = cv2.resize(rgb, (width, height), interpolation=cv2.INTER_AREA)
    scaled = np.maximum(scaled, 0) * exposure
    mapped = np.clip((scaled * (2.51 * scaled + .03)) / (scaled * (2.43 * scaled + .59) + .14), 0, 1)
    srgb = np.where(mapped <= .0031308, mapped * 12.92, 1.055 * mapped ** (1 / 2.4) - .055)
    output.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.rint(srgb * 255).astype('uint8')).save(output, quality=95, method=6)
    print(f"{output.name}: {width}x{height}, {output.stat().st_size} bytes", flush=True)


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
        channels = OpenEXR.File(str(exr)).channels()
        channel = channels.get("RGBA") or channels.get("RGB")
        if channel is None:
            raise ValueError("Sky has no RGB channels: " + str(exr))
        rgba = channel.pixels
        if rgba.dtype not in (np.float16, np.float32) or rgba.shape[1] != 2 * rgba.shape[0]:
            raise ValueError("Expected a linear 2:1 HDR panorama: " + str(exr))
        if rgba.shape[1] != sky["sourceWidth"]:
            raise ValueError(f"{map_id}: source width changed, review the source sky before rebaking")
        exposure = sum(float(values.get(key, 0)) for key in
                       ("g_flBrightnessExposureBias", "g_flRenderOnlyExposureBias"))
        gain = sky["exposure"] * 2 ** exposure
        rgb = rgba[:, :, :3].astype(np.float32, copy=False)
        print(f"{map_id} {texture['path']}, VTEX CRC32 {texture['crc']:08x}", flush=True)
        write_panorama(rgb, min(4096, sky["sourceWidth"]), gain, args.output / (map_id + ".webp"))
        if sky["sourceWidth"] > 2048:
            write_panorama(rgb, 2048, gain, args.output / "compact" / (map_id + ".webp"))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("index", type=lambda path: Path(path).resolve())
    parser.add_argument("--vrf", type=lambda path: Path(path).resolve(),
                        default=ROOT / "tools/source2viewer/Source2Viewer-CLI.exe")
    parser.add_argument("--work", type=lambda path: Path(path).resolve(), required=True)
    parser.add_argument("--output", type=Path, default=ROOT / "client/flat-skies")
    parser.add_argument("--maps", nargs="*", choices=MAPS)
    bake(parser.parse_args())
