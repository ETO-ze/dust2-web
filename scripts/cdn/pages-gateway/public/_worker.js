// Only handler exports are valid on a workerd entry module. Wrangler bundles
// the shared module; this output directory contains no game or secret files.
export {default} from '../gateway.mjs';
