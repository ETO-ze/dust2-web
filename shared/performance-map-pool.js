/** Additional maps are only enabled inside the separately mounted performance game. */
export const PERFORMANCE_MAPS = Object.freeze([
  ['de_dust2', 'Dust II', '炙热沙城 II'], ['de_mirage', 'Mirage', '荒漠迷城'],
  ['de_inferno', 'Inferno', '炼狱小镇'], ['de_nuke', 'Nuke', '核子危机'],
  ['de_ancient', 'Ancient', '远古遗迹'], ['de_anubis', 'Anubis', '阿努比斯'],
  ['de_cache', 'Cache', '死城之谜'], ['de_train', 'Train', '列车停放站'],
  ['de_vertigo', 'Vertigo', '殒命大厦'],
].map(([id, name, nameZh]) => Object.freeze({id, name, nameZh})));
export const isPerformanceMap = id => PERFORMANCE_MAPS.some(map => map.id === id);
