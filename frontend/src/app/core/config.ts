/** Where the Aaina API lives. Set API_BASE at deploy time if your Render URL differs. */
const PROD_API = 'https://aaina-api.onrender.com';

export const API_BASE: string =
  (globalThis as any).AAINA_API_BASE ??
  (['localhost', '127.0.0.1'].includes(globalThis.location?.hostname ?? '') ? 'http://localhost:8000' : PROD_API);

/** The backend is multi-tenant; this simple app always uses one default space. */
export const SPACE = 'demo';
