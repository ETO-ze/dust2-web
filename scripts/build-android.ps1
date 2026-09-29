param([switch]$InitializeSigning, [switch]$Offline)
$ErrorActionPreference='Stop'
$gameRoot=Split-Path $PSScriptRoot -Parent
$gameTools=if($env:DUSTII_ANDROID_TOOLS){$env:DUSTII_ANDROID_TOOLS}else{'H:\playfround\.android-build-tools'}
if(Test-Path 'C:\Program Files\Java\jdk-21'){$env:JAVA_HOME='C:\Program Files\Java\jdk-21'}
$env:ANDROID_HOME=Join-Path $gameTools 'sdk'
$env:GRADLE_USER_HOME=Join-Path $gameTools 'gradle-home'
$buildScratch=if($env:DUSTII_BUILD_ROOT){$env:DUSTII_BUILD_ROOT}else{Join-Path $gameRoot 'artifacts'}
$env:ANDROID_USER_HOME=Join-Path $buildScratch 'android/user-home'
$env:TEMP=Join-Path $buildScratch 'android/tmp';$env:TMP=$env:TEMP
New-Item -ItemType Directory -Force $env:ANDROID_USER_HOME,$env:TEMP | Out-Null
$env:PATH="$env:JAVA_HOME\bin;$env:PATH"
Set-Location $gameRoot
if($InitializeSigning){
    & python scripts/create-android-signing.py
    if($LASTEXITCODE){throw 'Could not initialize signing key'}
}
if(!(Test-Path android/signing/release.json)){throw 'First build: pass -InitializeSigning. Preserve android/signing for future updates.'}
if(!(Test-Path 'artifacts/installed-client/bundle-manifest.json')){throw 'Run npm run build and node scripts/prepare-installed.mjs first.'}
$gradleArgs=@('-p','android',':app:assembleDebug',':app:assembleRelease',':app:lintRelease','--console=plain','--no-daemon')
if($Offline){$gradleArgs+='--offline'}
& (Join-Path $gameTools 'gradle-8.11.1/bin/gradle.bat') @gradleArgs
if($LASTEXITCODE){throw 'Android build failed'}
$gameApk=Join-Path $buildScratch 'releases/DustII-Android-1.1.0.apk'
$androidOutput=if($env:DUSTII_BUILD_ROOT){Join-Path $buildScratch 'android-app'}else{Join-Path $gameRoot 'android/app/build'}
New-Item -ItemType Directory -Force (Split-Path $gameApk) | Out-Null
Copy-Item -LiteralPath (Join-Path $androidOutput 'outputs/apk/release/app-release.apk') -Destination $gameApk -Force
& "$env:ANDROID_HOME/build-tools/35.0.0/apksigner.bat" verify --verbose --print-certs $gameApk
if($LASTEXITCODE){throw 'APK signature validation failed'}
$apkInfo=Get-Item -LiteralPath $gameApk
$apkHash=(Get-FileHash -LiteralPath $gameApk -Algorithm SHA256).Hash.ToLowerInvariant()
@{version='1.1.0';versionCode=2;package='cn.duskrain.dustii';url='https://github.com/ETO-ze/dust2-web/releases/download/online-v1.1.0/DustII-Android-1.1.0.apk';bytes=$apkInfo.Length;sha256=$apkHash;minAndroid='8.0';sourceCommit=(& git rev-parse HEAD)} | ConvertTo-Json | Set-Content public/downloads/android-latest.json -Encoding utf8
Write-Output "APK ready: $gameApk ($($apkInfo.Length) bytes, SHA-256 $apkHash)"
