// Acceso seguro a localStorage (puede fallar en modo privado o con datos bloqueados)
export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* sin almacenamiento: se sigue en memoria */
  }
}

export function remove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* noop */
  }
}

/**
 * UUID v4 que funciona también fuera de HTTPS.
 * crypto.randomUUID() solo existe en "contextos seguros" (HTTPS o localhost): abriendo la
 * carta por la IP de la red local (http://192.168.x.x) no está y rompía el ingreso a la mesa.
 * crypto.getRandomValues() sí está disponible en HTTP.
 */
export function uuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40; // versión 4
  b[8] = (b[8]! & 0x3f) | 0x80; // variante RFC 4122
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Id anónimo del dispositivo: no identifica a la persona, solo agrupa sus acciones en la mesa */
export function getDeviceKey(): string {
  let key = load<string | null>("bar.deviceKey", null);
  if (!key) {
    key = `d_${uuid().replace(/-/g, "")}`;
    save("bar.deviceKey", key);
  }
  return key;
}

export function formatMoney(cents: number, currency = "ARS") {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100);
}
