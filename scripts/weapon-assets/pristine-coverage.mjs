/** Source 2 exposes substrate through a thresholded wear mask. Treating the
 * packed A channel as direct opacity adds scratches even when wear is zero.
 * These thresholds come from the installed csgo_customweapon shader's pristine
 * endpoint. Full no-paint regions remain masked; subtle edge wear stays covered.
 */
export function pristinePaintCoverage(noPaint){
 const t=Math.max(0,Math.min(1,(noPaint-.58)/.10));
 return 1-t*t*(3-2*t);
}
