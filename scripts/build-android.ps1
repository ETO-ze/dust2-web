param([switch]$InitializeSigning, [switch]$Offline)
$ErrorActionPreference='Stop'
$gameRoot=Split-Path $PSScriptRoot -Parent
$gameTools=if($env:DUSTII_ANDROID_TOOLS){$env:DUSTII_ANDROID_TOOLS}else{'H:\playfround\.android-build-tools'}
if(Test-Path 'C:\Program Files\Java\jdk-21'){$env:JAVA_HOME='C:\Program Files\Java\jdk-21'}
$env:ANDROID_HOME=Join-Path $gameTools 'sdk'
$env:GRADLE_USER_HOME=Join-Path $gameTools 'gradle-home'
$env:ANDROID_USER_HOME=Join-Path $gameRoot 'artifacts/android/user-home'
$env:TEMP=Join-Path $gameRoot 'artifacts/android/tmp';$env:TMP=$env:TEMP
New-Item -ItemType Directory -Force $env:ANDROID_USER_HOME,$env:TEMP | Out-Null
$env:PATH="$env:JAVA_HOME\bin;$env:PATH"
Set-Location $gameRoot
if($InitializeSigning){
    & python scripts/create-android-signing.py
    if($LASTEXITCODE){throw 'Could not initialize signing key'}
}
if(!(Test-Path android/signing/release.json)){throw 'First build: pass -InitializeSigning. Preserve android/signing for future updates.'}
$gradleArgs=@('-p','android',':app:assembleDebug',':app:assembleRelease',':app:lintRelease','--console=plain','--no-daemon')
if($Offline){$gradleArgs+='--offline'}
& (Join-Path $gameTools 'gradle-8.11.1/bin/gradle.bat') @gradleArgs
if($LASTEXITCODE){throw 'Android build failed'}
$gameApk=Join-Path $gameRoot 'public/downloads/DustII-Android-1.0.0.apk'
New-Item -ItemType Directory -Force (Split-Path $gameApk) | Out-Null
Copy-Item -LiteralPath 'android/app/build/outputs/apk/release/app-release.apk' -Destination $gameApk -Force
& "$env:ANDROID_HOME/build-tools/35.0.0/apksigner.bat" verify --verbose --print-certs $gameApk
if($LASTEXITCODE){throw 'APK signature validation failed'}
$apkInfo=Get-Item -LiteralPath $gameApk
$apkHash=(Get-FileHash -LiteralPath $gameApk -Algorithm SHA256).Hash.ToLowerInvariant()
@{version='1.0.0';versionCode=1;package='cn.duskrain.dustii';url='./DustII-Android-1.0.0.apk';bytes=$apkInfo.Length;sha256=$apkHash;minAndroid='8.0';sourceCommit=(& git rev-parse HEAD)} | ConvertTo-Json | Set-Content public/downloads/android-latest.json -Encoding utf8
Write-Output "APK ready: $gameApk ($($apkInfo.Length) bytes, SHA-256 $apkHash)"
