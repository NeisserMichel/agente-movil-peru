// =============================================================
//  CONFIGURACIÓN · Agente Móvil Perú
//  Mientras SUPABASE_URL esté vacío, la app funciona en MODO DEMO
//  (los datos se guardan solo en este navegador, para probar).
//  Pega aquí los datos de tu proyecto Supabase para usarla de verdad:
//  Supabase > Project Settings > API
// =============================================================
window.AMP_CONFIG = {
  SUPABASE_URL: 'https://efahaofcmadteqtkssuz.supabase.co',          // ej. 'https://abcdxyz.supabase.co'
  SUPABASE_ANON_KEY: 'sb_publishable_trMnEFsNRUPBXwel83Lmww_Loeimds6',     // la clave "anon public"

  EMPRESA: 'Agente Móvil Perú',
  WHATSAPP: '51999999999',   // tu número con 51 delante, sin espacios
  TASAS_DIARIAS: [0.2, 0.3], // % diario que usas normalmente
  MONTO_MIN: 100,
  MONTO_MAX: 5000,
  PLAZOS: [7, 15, 30, 45, 60],
  // Tope legal BCRP (% efectivo anual). Vigente may–oct 2026: 114.13.
  // Revísalo cada semestre en bcrp.gob.pe y actualízalo aquí.
  TASA_MAXIMA_TEA: 114.13
};
