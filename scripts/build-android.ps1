param([switch]$InitializeSigning, [switch]$Offline, [switch]$Gecko, [string]$SourceCommit)
$ErrorActionPreference='Stop'
$gameRoot=Split-Path $PSScriptRoot -Parent
$gameTools=if($env:DUSTII_ANDROID_TOOLS){$env:DUSTII_ANDROID_TOOLS}else{'H:\playfround\.android-build-tools'}
if(Test-Path 'C:\Program Files\Java\jdk-21'){$env:JAVA_HOME='C:\Program Files\Java\jdk-21'}
$env:ANDROID_HOME=if($env:DUSTII_ANDROID_SDK){$env:DUSTII_ANDROID_SDK}else{Join-Path $gameTools 'sdk'}
if(!$env:GRADLE_USER_HOME){$env:GRADLE_USER_HOME=Join-Path $gameTools 'gradle-home'}
$buildScratch=if($env:DUSTII_BUILD_ROOT){$env:DUSTII_BUILD_ROOT}else{Join-Path $gameRoot 'artifacts'}
$env:ANDROID_USER_HOME=Join-Path $buildScratch 'android/user-home'
$env:TEMP=Join-Path $buildScratch 'android/tmp';$env:TMP=$env:TEMP
New-Item -ItemType Directory -Force $env:ANDROID_USER_HOME,$env:TEMP | Out-Null
$env:PATH="$env:JAVA_HOME\bin;$env:PATH"
Set-Location $gameRoot
if($SourceCommit -and $SourceCommit -notmatch '^[0-9a-fA-F]{40}$'){throw 'Source commit must be a full 40-character hexadecimal SHA'}
if(Test-Path -LiteralPath (Join-Path $gameRoot '.git')){
    $actualCommit=(& git rev-parse HEAD).Trim()
    if($LASTEXITCODE -or $actualCommit -notmatch '^[0-9a-f]{40}$'){throw 'Could not inspect source commit'}
    if($SourceCommit -and $SourceCommit.ToLowerInvariant() -ne $actualCommit){throw 'Source commit does not match this Git checkout'}
    $sourceIdentity=@{sourceCommit=$actualCommit;sourceKind='git';sourceDirty=[bool](& git status --porcelain)}
}else{
    $provenanceFile=Join-Path $gameRoot 'PUBLIC-CDN-PROVENANCE.json'
    if(!$SourceCommit -or !(Test-Path -LiteralPath $provenanceFile)){throw 'An imported public build requires -SourceCommit and PUBLIC-CDN-PROVENANCE.json'}
    $provenance=Get-Content -LiteralPath $provenanceFile -Raw -Encoding utf8 | ConvertFrom-Json
    if($provenance.source.baselineCommit -cne $SourceCommit.ToLowerInvariant()){throw 'Source commit does not match the verified public baseline'}
    $sourceIdentity=@{sourceCommit=$SourceCommit.ToLowerInvariant();sourceKind='imported-public-baseline';sourceDirty=$null;routingProvenance=@{file='PUBLIC-CDN-PROVENANCE.json';sha256=(Get-FileHash -LiteralPath $provenanceFile -Algorithm SHA256).Hash.ToLowerInvariant();changes=$provenance.changes}}
}
if($InitializeSigning){
    & python scripts/create-android-signing.py
    if($LASTEXITCODE){throw 'Could not initialize signing key'}
}
if(!(Test-Path android/signing/release.json)){throw 'First build: pass -InitializeSigning. Preserve android/signing for future updates.'}
$installed=if($env:DUSTII_INSTALLED_CLIENT){$env:DUSTII_INSTALLED_CLIENT}else{'artifacts/installed-client'}
if(!(Test-Path (Join-Path $installed 'bundle-manifest.json'))){throw 'Run npm run build and node scripts/prepare-installed.mjs first.'}
$module=if($Gecko){'gecko'}else{'app'}
$gradleArgs=@('-p','android',":${module}:assembleDebug",":${module}:assembleRelease",":${module}:lintRelease",'--console=plain','--no-daemon')
if($Offline){$gradleArgs+='--offline'}
$gradle=if($env:DUSTII_GRADLE){$env:DUSTII_GRADLE}else{Join-Path $gameTools 'gradle-9.3.1/bin/gradle.bat'}
& $gradle @gradleArgs
if($LASTEXITCODE){throw 'Android build failed'}
$version=(Get-Content package.json -Raw | ConvertFrom-Json).version
$name=if($Gecko){"DustII-Gecko-Test-$version.apk"}else{"DustII-Android-$version.apk"}
$gameApk=Join-Path $buildScratch "releases/$name"
$androidOutput=if($env:DUSTII_BUILD_ROOT){Join-Path $buildScratch "android-$module"}else{Join-Path $gameRoot "android/$module/build"}
New-Item -ItemType Directory -Force (Split-Path $gameApk) | Out-Null
Copy-Item -LiteralPath (Join-Path $androidOutput "outputs/apk/release/$module-release.apk") -Destination $gameApk -Force
& "$env:ANDROID_HOME/build-tools/36.0.0/apksigner.bat" verify --verbose --print-certs $gameApk
if($LASTEXITCODE){throw 'APK signature validation failed'}
$badging=& "$env:ANDROID_HOME/build-tools/36.0.0/aapt2.exe" dump badging $gameApk
if($LASTEXITCODE){throw 'Could not inspect built APK identity'}
$identity=[regex]::Match(($badging -join "`n"),"(?m)^package: name='([^']+)' versionCode='([0-9]+)' versionName='([^']+)'")
if(!$identity.Success){throw 'Built APK identity is missing'}
$package=if($Gecko){'cn.duskrain.dustii.gecko'}else{'cn.duskrain.dustii'}
$allowedVersionNames=if($Gecko){@($version,"$version-gecko-test")}else{@($version)}
if($identity.Groups[1].Value -ne $package -or $identity.Groups[3].Value -notin $allowedVersionNames){throw 'APK package or version does not match release metadata'}
$versionCode=[int]$identity.Groups[2].Value
if($versionCode -lt 1){throw 'Invalid APK version code'}
$apkInfo=Get-Item -LiteralPath $gameApk
$apkHash=(Get-FileHash -LiteralPath $gameApk -Algorithm SHA256).Hash.ToLowerInvariant()
$metadata=if($Gecko){'public/downloads/gecko-test.json'}else{'public/downloads/android-latest.json'}
$releaseMetadata=@{version=$version;versionName=$identity.Groups[3].Value;versionCode=$versionCode;package=$package;url="https://github.com/ETO-ze/dust2-web/releases/download/online-v$version/$name";bytes=$apkInfo.Length;sha256=$apkHash;minAndroid='8.0';testKernel=[bool]$Gecko;p60Validated=$false}
foreach($field in $sourceIdentity.Keys){$releaseMetadata[$field]=$sourceIdentity[$field]}
$releaseMetadata | ConvertTo-Json -Depth 12 | Set-Content $metadata -Encoding utf8
Write-Output "APK ready: $gameApk ($($apkInfo.Length) bytes, SHA-256 $apkHash)"
