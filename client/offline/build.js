// Build-time switch: online builds keep their existing networking and cache.
export const OFFLINE = import.meta.env?.MODE === 'offline';
export const OFFLINE_VERSION = '0.2.0';
