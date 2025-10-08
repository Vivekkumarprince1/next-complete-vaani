import { openDB } from 'idb';

const DB_NAME = 'vaani-translate-db';
const DB_VERSION = 1;
const TRANSLATIONS_STORE = 'translations';
const MODELS_STORE = 'models';

let dbPromise;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(TRANSLATIONS_STORE)) {
          db.createObjectStore(TRANSLATIONS_STORE);
        }
        if (!db.objectStoreNames.contains(MODELS_STORE)) {
          db.createObjectStore(MODELS_STORE);
        }
      }
    });
  }
  return dbPromise;
}

export async function getCachedTranslation(key) {
  const db = await getDB();
  return db.get(TRANSLATIONS_STORE, key);
}

export async function setCachedTranslation(key, value) {
  const db = await getDB();
  return db.put(TRANSLATIONS_STORE, value, key);
}

export async function clearTranslationCache() {
  const db = await getDB();
  return db.clear(TRANSLATIONS_STORE);
}

// Model artifact caching (for local inference or tokenizers)
export async function getCachedModel(key) {
  const db = await getDB();
  return db.get(MODELS_STORE, key);
}

export async function setCachedModel(key, arrayBuffer) {
  const db = await getDB();
  return db.put(MODELS_STORE, arrayBuffer, key);
}

export async function prefetchModel(url, modelKey) {
  try {
    const existing = await getCachedModel(modelKey);
    if (existing) return existing;

    const resp = await fetch(url);
    if (!resp.ok) throw new Error('Failed to download model artifact');
    const ab = await resp.arrayBuffer();
    await setCachedModel(modelKey, ab);
    return ab;
  } catch (err) {
    console.warn('Model prefetch failed:', err.message);
    return null;
  }
}

export default {
  getCachedTranslation,
  setCachedTranslation,
  clearTranslationCache,
  getCachedModel,
  setCachedModel,
  prefetchModel
};
