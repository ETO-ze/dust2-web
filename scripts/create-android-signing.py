"""Create a project-specific release identity once; never print its password."""
import json
import os
from pathlib import Path
import secrets
import subprocess

root=Path(__file__).resolve().parents[1]
folder=root/'android/signing'
config=folder/'release.json'
key=folder/'dustii-release.p12'
if config.exists() and key.exists():
    print('Existing Android signing identity preserved.')
    raise SystemExit(0)
if config.exists() or key.exists():
    raise SystemExit('Incomplete signing identity; restore the existing files before building.')
if subprocess.run(['git','check-ignore','--quiet','android/signing/release.json'],cwd=root).returncode:
    raise SystemExit('Signing files must be ignored by Git.')
folder.mkdir(parents=True,exist_ok=True)
password=secrets.token_hex(32)
env={**os.environ,'DUSTII_SIGN_PASS':password}
subprocess.run(['keytool','-genkeypair','-keystore',str(key),'-storetype','PKCS12',
    '-alias','dustii','-keyalg','RSA','-keysize','3072','-validity','10000',
    '-dname','CN=DuskRain Dust II, OU=Personal Games, O=DuskRain',
    '-storepass:env','DUSTII_SIGN_PASS','-keypass:env','DUSTII_SIGN_PASS'],check=True,env=env)
with config.open('x',encoding='utf-8') as output:
    json.dump({'password':password},output)
print('Created Android release signing identity in the ignored signing folder. Keep a private backup.')
