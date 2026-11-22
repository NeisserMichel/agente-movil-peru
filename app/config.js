// =============================================================
//  CONFIGURACIÓN · Agente Móvil Perú
//  Si SUPABASE_URL está vacío, la app funciona en MODO DEMO
//  (los datos se guardan solo en ese navegador, para probar).
// =============================================================
window.AMP_CONFIG = {
  SUPABASE_URL: 'https://efahaofcmadteqtkssuz.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_trMnEFsNRUPBXwel83Lmww_Loeimds6',   // clave pública

  EMPRESA: 'Agente Móvil Perú',
  WHATSAPP: '51917486188',   // número con 51 delante, sin espacios
  TASA_DIARIA: 0.3,          // % de interés por día
  PLAZO_MAX: 14,             // máximo de días que puede pedir un cliente
  MONTO_MIN: 100,
  MONTO_MAX: 5000,

  // Cuentas donde los clientes pueden depositar sus pagos
  CUENTAS: [
    { banco: 'Yape',       etiqueta: 'Celular',          numero: '917486188',          titular: 'Neisser Calla' },
    { banco: 'BCP',        etiqueta: 'Cuenta',           numero: '24505804732091',     titular: 'Neisser Michel Calla Delgado' },
    { banco: 'BBVA',       etiqueta: 'Cuenta',           numero: '001108040200515146', titular: 'Neisser Michel Calla Delgado' },
    { banco: 'Interbank',  etiqueta: 'Cuenta',           numero: '8983183421648',      titular: 'Neisser Michel Calla Delgado' },
    { banco: 'Scotiabank', etiqueta: 'Cuenta de ahorro', numero: '6320768804',         titular: 'Neisser Michel Calla Delgado' }
  ]
};
