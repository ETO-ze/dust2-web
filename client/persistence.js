// Small preferences only. Asset binaries belong in the SHA-addressed Cache API.
// The mirror survives a damaged primary entry; failed writes never stop a frame.
export function createPreferenceStore(storage) {
  const memory=new Map();
  return {
    getItem(key){
      if(memory.has(key))return memory.get(key);
      try{const value=storage?.getItem(key)??storage?.getItem(key+'.backup')??null;if(value!==null)memory.set(key,value);return value;}catch{return null;}
    },
    setItem(key,value){const text=String(value);memory.set(key,text);try{storage?.setItem(key+'.backup',text);storage?.setItem(key,text);return true;}catch{return false;}},
    removeItem(key){memory.delete(key);try{storage?.removeItem(key);storage?.removeItem(key+'.backup');}catch{}},
    readJSON(key,fallback={}){for(const raw of [this.getItem(key),(()=>{try{return storage?.getItem(key+'.backup');}catch{return null;}})()]){try{if(raw!==null){const value=JSON.parse(raw);if(value&&typeof value==='object'&&!Array.isArray(value))return value;}}catch{}}return fallback;},
  };
}
let storage;try{storage=globalThis.localStorage;}catch{}
export const preferences=createPreferenceStore(storage);
