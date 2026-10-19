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

/** Id anónimo del dispositivo: no identifica a la persona, solo agrupa sus acciones en la mesa */
export function getDeviceKey(): string {
  let key = load<string | null>("bar.deviceKey", null);
  if (!key) {
    key = `d_${crypto.randomUUID().replace(/-/g, "")}`;
    save("bar.deviceKey", key);
  }
  return key;
}

export function formatMoney(cents: number, currency = "ARS") {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100);
}
