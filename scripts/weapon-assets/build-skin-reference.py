"""Build a versioned finish reference from Valve's VPK index and three economy text files.

Example from the project root (public dedicated-server depot 2347770):
  py scripts/weapon-assets/build-skin-reference.py

For this pinned index, the two additional VPKs needed alongside the map build's
pak01_543.vpk are pak01_514.vpk and pak01_544.vpk. Fetch the same Steam manifest.
No texture extraction or GLB generation is involved in building the reference.
"""
import argparse
import collections
import hashlib
import json
import pathlib
import re
import struct
import zlib

REPO = pathlib.Path(__file__).resolve().parents[2]
INDEX_HASH = "7db4d2f43e24cda87887a8acce37d967464c92421e15d297aa1b8c749222432c"
MANIFEST = "8225060435969537482"
TEXT_FILES = ("scripts/items/items_game.txt", "resource/csgo_english.txt", "resource/csgo_schinese.txt")
PREFIX = "panorama/images/econ/default_generated/"
SUFFIX = "_light_png.vtex_c"


def read_index(filename):
    data = filename.read_bytes()
    magic, version, length = struct.unpack_from("<III", data)
    if magic != 0x55AA1234 or version != 2:
        raise ValueError("Expected a Valve VPK v2 directory")
    offset = 28

    def string():
        nonlocal offset
        end = data.index(0, offset)
        value = data[offset:end].decode("utf8")
        offset = end + 1
        return value

    index = {}
    while ext := string():
        while directory := string():
            while name := string():
                crc, pre, archive, start, size, end = struct.unpack_from("<IHHIIH", data, offset)
                if end != 65535:
                    raise ValueError("Invalid VPK entry")
                offset += 18
                preload = data[offset:offset + pre]
                offset += pre
                index[f"{directory}/{name}.{ext}"] = (crc, preload, archive, start, size)
    if offset != 28 + length:
        raise ValueError("Truncated VPK tree")
    return index, hashlib.sha256(data).hexdigest()


def text_resource(index, directories, key):
    crc, pre, number, pos, size = index[key]
    filename = f"pak01_{number:03d}.vpk"
    for folder in directories:
        path = folder / filename
        if path.is_file():
            with path.open("rb") as fp:
                fp.seek(pos)
                content = pre + fp.read(size)
            if zlib.crc32(content) == crc and len(content) == len(pre) + size:
                return content.decode("utf-8-sig"), hashlib.sha256(content).hexdigest()
    raise ValueError(f"{key} requires the matching Valve archive {filename}.")


def parse_schema(text):
    # Valve splits sections and item definitions across collection patches.
    # Merge blocks while reading so earlier fields survive partial updates.
    tokens = re.finditer(r'//[^\r\n]*|"((?:[^"\\]|\\.)*)"|([{}])', text)
    stream = (m.group(1) if m.group(1) is not None else m.group(2)
              for m in tokens if m.group(0)[:2] != "//")

    def parse_into(block, outer=False):
        for key in stream:
            if key == "}":
                return
            value = next(stream)
            if value == "{":
                previous = block.get(key)
                if not isinstance(previous, dict):
                    previous = block[key] = {}
                parse_into(previous)
            else:
                block[key] = value
        if not outer:
            raise ValueError("Unterminated item schema")

    root = {}
    parse_into(root, outer=True)
    return root["items_game"]


def translations(text):
    return {k.casefold(): value for k, value in re.findall(
        r'^\s*"([^"\r\n]+)"\s+"((?:[^"\\\r\n]|\\.)*)"', text, re.M)}


def item_attribute(item, prefabs, key):
    if key in item:
        return item[key]
    for name in item.get("prefab", "").split():
        value = item_attribute(prefabs.get(name, {}), prefabs, key)
        if value:
            return value
    return ""


def phase(name):
    numbered = re.search(r"(?:doppler|dopper)_phase_?([1-4])", name)
    if numbered:
        return f"Phase {numbered[1]}"
    for token, label in [("sapphire", "蓝宝石"), ("blackpearl", "黑珍珠"), ("ruby", "红宝石"), ("emerald_marbleized", "绿宝石")]:
        if token in name:
            return label
    return None


def project_weapon(item):
    # Explicit internal aliases used by the browser's equipment catalogue.
    if item in {"weapon_glock", "weapon_m4a1", "weapon_m4a1_silencer", "weapon_usp_silencer", "weapon_sg556", "weapon_knife_karambit"}:
        return {"weapon_glock": "pistol", "weapon_m4a1": "m4a4", "weapon_m4a1_silencer": "m4a1",
                "weapon_usp_silencer": "usp", "weapon_sg556": "sg553", "weapon_knife_karambit": "knife"}[item]
    return item.removeprefix("weapon_")


def collection_pairs(section):
    """The public schema enumerates gun-finish pairings by [paint]weapon key."""
    result = set()
    for key, value in section.items():
        matched = re.fullmatch(r'\[([^\]]+)\](.+)', key)
        if matched:
            result.add((matched[2].casefold(), matched[1].casefold()))
        if isinstance(value, dict):
            result.update(collection_pairs(value))
    return result


def reference(index, schema, english, chinese):
    items = {item["name"]: (int(key), item) for key, item in schema["items"].items()
             if key.isdigit() and "name" in item}
    kits = {kit["name"].casefold(): (int(key), kit) for key, kit in schema["paint_kits"].items()
            if key.isdigit() and "name" in kit}
    defaults = schema["paint_kits"]["0"]
    gloves = {name for name, (_, item) in items.items() if item.get("prefab") == "hands_paintable"}
    names = sorted((n for n in items if n.startswith("weapon_") or n in gloves), key=len, reverse=True)
    collections_and_loot = collection_pairs(schema["item_sets"]) | collection_pairs(schema["client_loot_lists"])
    rows, skipped, inventory_only = [], [], []
    for file in sorted(index):
        if not file.startswith(PREFIX) or not file.endswith(SUFFIX):
            continue
        stem = file[len(PREFIX):-len(SUFFIX)]
        name = next((weapon for weapon in names if stem.startswith(weapon + "_") and stem[len(weapon)+1:] in kits), None)
        if not name:
            skipped.append(stem)
            continue
        paint = stem[len(name) + 1:]
        paintkit, kit = kits[paint]
        definition, item = items[name]
        item_token = item_attribute(item, schema["prefabs"], "item_name").lstrip("#").casefold()
        paint_token = kit["description_tag"].lstrip("#").casefold()
        category = ("手套" if name in gloves else "刀具" if name.startswith("weapon_knife") or name == "weapon_bayonet"
                    else "电击枪" if name == "weapon_taser" else "枪械")
        # Shared kits can have unused official pictures on the wrong weapon.
        # The public lists enumerate guns, but do not enumerate rare knives/gloves.
        if category in ("枪械", "电击枪") and (name, paint) not in collections_and_loot:
            inventory_only.append(stem)
            continue
        minimum = float(kit.get("wear_remap_min", defaults["wear_remap_min"]))
        maximum = float(kit.get("wear_remap_max", defaults["wear_remap_max"]))
        if not 0 <= minimum <= maximum <= 1:
            raise ValueError(f"Invalid wear for {stem}")
        rows.append(dict(weapon=project_weapon(name), valveWeapon=name, definition=definition,
                         weaponName=chinese.get(item_token) or english[item_token], weaponNameEn=english[item_token],
                         category=category, paintkit=paintkit, paint=paint, name=chinese.get(paint_token) or english[paint_token],
                         nameEn=english[paint_token], phase=phase(paint), wearMin=minimum, wearMax=maximum,
                         factoryNew=minimum < .07, inventoryPath=file))
    duplicates = collections.Counter((r["definition"], r["paintkit"]) for r in rows)
    if max(duplicates.values()) != 1:
        raise ValueError("Duplicate item definition and finish")
    official_guns = {n for n in items if n.startswith("weapon_") and "knife" not in n and n != "weapon_bayonet"}
    missing = {(n, k) for n, k in collections_and_loot if n in official_guns and k in kits}
    missing.difference_update((r["valveWeapon"], r["paint"]) for r in rows)
    if missing:
        raise ValueError(f"Collection finishes without reviewed inventory images: {sorted(missing)}")
    return sorted(rows, key=lambda r: (r["definition"], r["paintkit"])), skipped, inventory_only


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--index", type=pathlib.Path, default=REPO / "artifacts/flat-sky-source/current/game/csgo/pak01_dir.vpk")
    parser.add_argument("--archives", action="append", type=pathlib.Path)
    parser.add_argument("--output", type=pathlib.Path, default=REPO / "artifacts/skin-library-review/reference.json")
    args = parser.parse_args()
    archives = args.archives or [REPO / "artifacts/skin-library-review/depot/game/csgo",
                                REPO / "artifacts/performance-maps/source-extra/steam-files/game/csgo"]
    index, index_hash = read_index(args.index)
    if index_hash != INDEX_HASH:
        raise ValueError("Index differs from the pinned Steam manifest; validate provenance before updating.")
    resources = {name: text_resource(index, archives, name) for name in TEXT_FILES}
    schema = parse_schema(resources[TEXT_FILES[0]][0])
    rows, skipped, inventory_only = reference(index, schema, translations(resources[TEXT_FILES[1]][0]), translations(resources[TEXT_FILES[2]][0]))
    result = dict(source=dict(provider="Valve Steam / Counter-Strike 2", app=730, depot=2347770, manifest=MANIFEST,
                              manifestDate="2026-11-19", indexSha256=index_hash,
                              inputSha256={name: value[1] for name, value in resources.items()}),
                  scope="枪械和电击枪按 Valve 收藏品或掉落清单中的武器涂装配对核验；刀具与手套按正式物品、涂装定义及对应库存图核验。每行按物品定义 ID + paint kit ID 去重，原版无涂装、图案模板及单件磨损不单列。",
                  counts=dict(collections.Counter(row["category"] for row in rows)), unmatchedInventory=skipped,
                  unlistedGunInventory=inventory_only, rows=rows)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    print(len(rows), result["counts"], f"unmatched={len(skipped)}")


if __name__ == "__main__":
    main()
