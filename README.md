# Agente Móvil Perú: app de créditos y página web

## Qué incluye

| Carpeta / archivo | Qué es |
|---|---|
| `index.html` | Página web de la empresa (inicio, cómo funciona, simulador, requisitos, preguntas, contacto) |
| `app/` | La app para clientes y para ti (administrador). Se instala en el celular como una app (PWA) |
| `app/config.js` | **Tus datos:** conexión a Supabase, WhatsApp, tasas, montos y plazos |
| `supabase/schema.sql` | La base de datos: usuarios, préstamos, pagos, notificaciones y seguridad |

## Cómo funciona

1. **El cliente** se registra con correo, contraseña, nombres, DNI y celular.
2. Toca **Solicitar crédito**, elige monto y plazo y envía.
3. **Tú (admin)** recibes al instante una notificación: *“María Quispe solicitó un préstamo por S/ 1,500.00 a 30 días”*.
4. Abres la solicitud, ajustas **monto, interés diario (0.3% u otro), plazo y fecha** y ves en vivo el interés por día, el total al vencimiento y la fecha de pago.
5. Tocas **Confirmar aprobación y depósito** y al cliente le aparece: *“¡Tu crédito fue aprobado y depositado!”*, con su saldo y fecha de pago.
6. Registras el **pago total** (Yape, transferencia, efectivo) y el crédito pasa a **Pagado**.

Además tienes un resumen (capital prestado, por cobrar, intereses, vencidos), una lista de clientes y recordatorios por WhatsApp con un toque.

**Fórmula:** deuda = monto × 1.003 ^ días transcurridos (interés de 0.3% diario que se suma cada medianoche sobre la deuda). El pago es por el total, sin pagos parciales.
Ejemplo: S/ 1,000 a 10 días = S/ 1,030.41.

---

## Poner la app en funcionamiento (unos 20 minutos, gratis)

### Paso 1: Crear la base de datos en Supabase
1. Entra a **https://supabase.com** y crea una cuenta gratuita.
2. Clic en **New project** → nombre `agente-movil-peru` → región **South America (São Paulo)** → crea una contraseña segura.
3. Ve a **SQL Editor** → **New query** → pega todo el contenido de `supabase/schema.sql` → **Run**.
4. Ve a **Project Settings → API** y copia: **Project URL** y la clave **anon public**.

### Paso 2: Configurar la app
Abre `app/config.js` y llena:
```js
SUPABASE_URL: 'https://TU-PROYECTO.supabase.co',
SUPABASE_ANON_KEY: 'eyJhbGciOi...',
WHATSAPP: '51987654321',
```
Cambia también el número de WhatsApp al inicio del `<script>` en `index.html` (la web) y los datos de contacto y el RUC.

### Paso 3: Publicar en internet (gratis)
Opción más fácil, **Netlify Drop**:
1. Entra a **https://app.netlify.com/drop**.
2. Arrastra la carpeta completa `agente-movil-peru`.
3. Te da un enlace como `https://agente-movil-peru.netlify.app`. Ahí está tu web, y la app en `/app/`.
4. (Opcional) Conecta tu propio dominio, por ejemplo `agentemovilperu.pe`, en *Domain settings*.

En Supabase → **Authentication → URL Configuration**, pon tu enlace de Netlify en **Site URL** para que funcionen los correos de confirmación y recuperación de contraseña.

### Paso 4: Convertirte en administrador
1. Abre la app y **regístrate con tu correo** como si fueras cliente.
2. En Supabase → SQL Editor ejecuta (con tu correo):
```sql
update public.profiles set role = 'admin' where email = 'tucorreo@gmail.com';
```
3. Cierra sesión y vuelve a entrar. Ya verás el panel de administración.

### Paso 5: Instalar en el celular
Abre `https://tu-sitio/app/` en el celular:
- **Android (Chrome):** menú ⋮ → *Instalar app* / *Agregar a pantalla principal*.
- **iPhone (Safari):** botón Compartir → *Agregar a inicio*.

Cuando la app te pregunte, acepta **“Permitir notificaciones”** para recibir los avisos de nuevas solicitudes.

---

## Notas importantes

- **Modo demo:** si `config.js` no tiene los datos de Supabase, la app funciona en modo demo (los datos se guardan solo en ese navegador). Sirve para probar. Usuarios de prueba: `admin@agentemovil.pe / admin123`, `maria@ejemplo.pe / cliente123`.
- **Notificaciones:** llegan al instante mientras la app está abierta o en segundo plano reciente. Para avisos *push* con la app totalmente cerrada, el siguiente paso es integrar OneSignal o Firebase Cloud Messaging.
- **Confirmación de correo:** Supabase pide por defecto que el cliente confirme su correo. Puedes desactivarlo en *Authentication → Providers → Email → Confirm email*.
- **Formalidad en Perú:** si prestas dinero como negocio, consulta con un abogado o contador si debes inscribirte en algún registro de la SBS, el contrato o pagaré, el **Libro de Reclamaciones virtual** (obligatorio si tienes web) y tu política de privacidad (Ley 29733). Los enlaces del pie de página de la web ya están listos para que pongas los tuyos.
