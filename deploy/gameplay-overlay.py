#!/usr/bin/env python3
"""Verified gameplay/assets overlay. Uses the existing bounded archive assembler.

Only the game client, game server/shared JS, and the map's material table may be
replaced. No dependencies, service configuration, credentials or host files.
"""
import importlib.util
import gzip
import io
import zlib
from pathlib import Path
import re
spec=importlib.util.spec_from_file_location('safe_overlay',Path(__file__).with_name('overlay-release.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
component=r'[A-Za-z0-9_][A-Za-z0-9_. ()-]*'
asset_path=rf'(?:{component}/)*{component}'
asset_extension=r'(?:js|css|json|svg|glb|gltf|bin|u8|f32|mesh|nav|png|webp|jpg|jpeg|avif|gif|hdr|ogg|mp3|wav|webm|mp4|woff2?|ttf|otf|txt|md)'
module.OVERLAY_NAME=re.compile(
    rf'(?:dist/(?:(?:index\.html|sw\.js|manifest\.webmanifest)(?:\.gz)?'
    rf'|icons/[A-Za-z0-9_-]+\.png(?:\.gz)?'
    rf'|assets/{asset_path}\.{asset_extension}(?:\.gz)?)'
    r'|(?:server|shared)/[A-Za-z0-9_/-]+\.js'
    r'|public/assets/map/penetration-materials\.(?:u8|json))')
module.MAX_OVERLAY_TOTAL=192*1024**2
module.MAX_OVERLAY_FILE=32*1024**2
module.MAX_OVERLAY_MEMBERS=2048

_read_overlay=module.read_overlay
_checked_member=module.checked_member
_rewrite=module.rewrite
_active_overlay=None

def validate_gzip_pairs(entries):
    """A gzip sidecar may only replace exactly the raw bytes in this patch."""
    for name,(_,content) in entries.items():
        if not name.endswith('.gz'):
            continue
        raw_name=name[:-3]
        if raw_name not in entries:
            raise ValueError(f'Gzip sidecar has no matching raw overlay member: {name}')
        try:
            with gzip.GzipFile(fileobj=io.BytesIO(content),mode='rb') as compressed:
                expanded=compressed.read(module.MAX_OVERLAY_FILE+1)
        except (OSError,EOFError,zlib.error) as error:
            raise ValueError(f'Invalid gzip sidecar: {name}') from error
        if len(expanded)>module.MAX_OVERLAY_FILE or expanded!=entries[raw_name][1]:
            raise ValueError(f'Stale or mismatched gzip sidecar: {name}')

def read_overlay(source):
    entries=_read_overlay(source)
    validate_gzip_pairs(entries)
    return entries

def checked_member(info,seen,parents,overlay=False):
    _checked_member(info,seen,parents,overlay)
    # Check stale base sidecars during the original single streaming rewrite.
    if (not overlay and _active_overlay is not None and info.isfile()
            and info.name.endswith('.gz') and info.name[:-3] in _active_overlay
            and info.name not in _active_overlay):
        raise ValueError(f'Updated raw member would retain stale base gzip: {info.name}')

def rewrite(base,overlay,output):
    global _active_overlay
    validate_gzip_pairs(overlay)
    previous=_active_overlay;_active_overlay=overlay
    try:
        return _rewrite(base,overlay,output)
    finally:
        _active_overlay=previous

module.read_overlay=read_overlay
module.checked_member=checked_member
module.rewrite=rewrite
if __name__=='__main__':module.main()
