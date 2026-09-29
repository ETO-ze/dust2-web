// Shared compatibility identity. Bump rules/assets when gameplay geometry or
// the wire contract becomes incompatible; cosmetic downloads are independent.
export const CLIENT_BUILD='1.1.0';
export const RULES_VERSION=1;
export const ASSET_VERSION='5a82c6eead18b7e0';
export function compatibilityError(msg){
  if(msg.rulesVersion!==undefined&&msg.rulesVersion!==RULES_VERSION)return '游戏规则版本不兼容，请更新客户端后重试。';
  if(msg.assetVersion!==undefined&&msg.assetVersion!==ASSET_VERSION)return '地图资源版本不兼容，请下载新版客户端。';
  return null;
}
