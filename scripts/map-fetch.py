"""Fetch only Dust II members from the versioned Awpy source archives.

Game assets belong to Valve. This script uses standard ZIP byte ranges;
it neither downloads the game nor modifies installed game files.
"""
import io, json, pathlib, struct, urllib.request, zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/assets/map'
OUT.mkdir(parents=True, exist_ok=True)
BASE = 'https://github.com/pnxenopoulos/awpy-data/releases/download/2000905/'

class RemoteZip(io.RawIOBase):
    def __init__(self, url):
        with urllib.request.urlopen(urllib.request.Request(url, method='HEAD'), timeout=20) as response:
            self.url = response.url
            self.length = int(response.headers['Content-Length'])
        self.pos = 0
    def seekable(self): return True
    def tell(self): return self.pos
    def seek(self, n, whence=0):
        self.pos = n if whence == 0 else self.pos+n if whence == 1 else self.length+n
        return self.pos
    def read(self, n=-1):
        if n < 0: n = self.length-self.pos
        n = min(n, self.length-self.pos)
        if n <= 0: return b''
        request = urllib.request.Request(self.url, headers={'Range': f'bytes={self.pos}-{self.pos+n-1}'})
        with urllib.request.urlopen(request, timeout=40) as response:
            if response.status != 206: raise RuntimeError(f'Range unsupported: {response.status}')
            data = response.read()
        if len(data) != n: raise RuntimeError(f'Unexpected range {len(data)} != {n}')
        self.pos += n
        return data

for archive, suffix in [('geometry.zip', '.mesh'), ('navs.zip', '.nav')]:
    remote = RemoteZip(BASE+archive)
    with zipfile.ZipFile(remote) as z:
        member = next(n for n in z.namelist() if pathlib.PurePosixPath(n).name == 'de_dust2'+suffix)
        info = z.getinfo(member)
        print(json.dumps({'archive': archive, 'member':member, 'size':info.file_size, 'compressed':info.compress_size}), flush=True)
        data = z.read(member)
        (OUT / ('de_dust2'+suffix)).write_bytes(data)
        print(f'Wrote {len(data)} bytes', flush=True)

with urllib.request.urlopen(BASE+'manifest.json', timeout=20) as response:
    (OUT/'source-manifest.json').write_bytes(response.read())
