# Gestor inmobiliario — Prosperity

Agente que gestiona la venta de propiedades en Chile sobre el CRM de **JetBrokers**:
recibe la consulta de un comprador, extrae su perfil financiero, calcula cuánto puede
pagar con criterios de la banca chilena, la calza contra el inventario real de
proyectos, redacta la respuesta, propone horarios de visita y crea al cliente en el CRM.

El alcance es **captación → visita agendada**. El cierre (reserva, promesa, escritura)
queda en manos de una persona.

## Cómo funciona

```
consulta ─► extracción ─► capacidad de compra ─► calce con inventario ─► puntaje
             (Claude)      (reglas banca CL)      (JetBrokers)           (determinista)
                                                                             │
                        CRM JetBrokers ◄── redacción + agenda ◄──────────────┘
                         (Customer API)        (Claude)
```

Solo dos pasos usan el modelo: **leer el mensaje** y **redactar la respuesta**. El
cálculo financiero, el calce y la decisión de estado son código determinista y
auditable — para que un ejecutivo pueda revisar por qué el agente hizo lo que hizo.

### Reglas financieras aplicadas

- El dividendo no puede superar el **25% de la renta líquida**.
- Las deudas vigentes (dividendos, cuotas de consumo) se descuentan de esa capacidad.
- La **renta variable se pondera al 50%**; la de la pareja solo suma si la declara.
- **Pie mínimo 20%** del precio.
- **Dicom vigente** bloquea la preaprobación → el lead se marca `noQualify`.
- Crédito a 25 años, 4,5% anual, en UF.
- Comisión: el `fee` del proyecto si viene del CRM; si no, 2% + IVA.

## Integración con JetBrokers

Los cinco endpoints del documento están implementados en `src/lib/jetbrokers/cliente.ts`:

| Endpoint | Uso en el gestor |
|---|---|
| `POST /api/gallery/customer/{org}` | Crea el cliente calificado en el CRM |
| `POST /api/gallery/projects` | Buscador de proyectos (inventario) |
| `GET /api/gallery/details/{org}/{id}` | Tipologías, precios en UF, reserva, comisión |
| `GET /api/gallery/download/{org}/{fileId}` | Brochures, renders y planos |
| `GET /api/v1/jetbrokers/meeting-room-video/{org}` | Video de sala de reuniones |

El pipeline **no inventa estados propios**: usa los mismos valores que acepta el campo
`status` del Customer API (`new`, `callAgain`, `noResponse`, `furtherOn`, `scheduled`,
`reschedule`, `quotationSended`, `dropped`, `closing`, `noQualify`, `customer`), así lo
que se ve en el panel es lo que hay en el CRM.

### Resguardos

- **No escribe en el CRM por defecto.** `JETBROKERS_ESCRITURA=false` simula el POST y
  muestra el payload exacto que se habría enviado. Hay que habilitarlo a propósito.
- **Respeta el límite de la API**: 10 clientes por hora y por IP (900 si la IP está en
  la whitelist). El cliente lleva una ventana deslizante y frena **antes** de llamar,
  en vez de comerse un 429.
- **Sanea el payload antes de enviarlo.** La API recorta lo que excede el largo máximo
  y descarta en silencio los tipos incorrectos; acá eso se detecta, se corrige cuando
  se puede (`"1800000"` → `1800000`) y queda registrado como aviso en el timeline.
- **Tags normalizados** al formato `tag1,tag2`: sin espacios ni coma final.

### Cosas que la documentación no trae

- Las listas de valores de `comuna`, `region`, `nationality` y `LocalityEnum` aparecen
  con el título pero **sin valores**. Esos campos se pasan tal cual, sin validar.
- El `POST` de clientes **no devuelve cuerpo**, así que no hay ID del CRM de vuelta: el
  gestor mantiene su propio ID y JetBrokers deduplica por `email`, `mobile` y `taxId`.
- No aparece autenticación más allá del `organizationId` en la URL. Si tu instancia usa
  cabecera o token, hay que agregarlo en `pedir()`.

## Correr el proyecto

```bash
npm install
cp .env.example .env.local     # completa lo que tengas a mano
npm run dev                    # http://localhost:3000
```

Sin configurar nada funciona igual: inventario de demostración, tienda en memoria y
heurística local en vez del modelo. Cada conexión que agregues reemplaza una pieza.

| Variable | Efecto |
|---|---|
| `JETBROKERS_ORG_ID` | Trae el inventario real; sin esto usa proyectos de demostración |
| `JETBROKERS_ESCRITURA=true` | Habilita la creación de clientes en el CRM |
| `ANTHROPIC_API_KEY` | Usa Claude para extraer y redactar; sin esto, heurística local |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | Persiste en Postgres en vez de memoria |
| `INGESTA_TOKEN` | Exige `x-ingesta-token` en las rutas de API |

### Contra un CRM simulado

`mock/servidor.ts` replica el contrato del documento, con el ejemplo "Mirador Alto" tal
como aparece en la página 4:

```bash
npm run mock                                     # http://localhost:4010
JETBROKERS_ORG_ID=91CerSOi \
JETBROKERS_BASE_URL=http://localhost:4010 \
JETBROKERS_ESCRITURA=true npm run dev
```

### Ingesta de leads

```bash
curl -X POST http://localhost:3000/api/leads \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Camila Fuentes",
    "email": "camila@gmail.com",
    "mobile": "+56987654321",
    "origin": "portal_inmobiliario",
    "projectId": "cpmoqN5r",
    "comments": "Gano líquido $2.400.000 y tengo $28.000.000 de pie. ¿Se puede visitar esta semana?"
  }'
```

Acepta tanto los nombres del Customer API (`fullName`, `mobile`, `taxId`, `comments`)
como sus equivalentes en español, para no tener que tocar formularios que ya existen.
Responde con la calificación, el mensaje redactado y los horarios propuestos.

`POST /api/agente` procesa en lote todos los leads pendientes — sirve para un cron.

## Comandos

```bash
npm run dev      # desarrollo
npm run build    # build de producción
npm run prueba   # 35 pruebas: cliente del API, validación, finanzas, calce, estados
npm run tipos    # typecheck
npm run mock     # mock del API de JetBrokers
```

## Persistencia

Sin Supabase todo vive en memoria y se pierde al reiniciar el proceso — suficiente para
simular. Para persistir, aplica `supabase/migrations/0001_gestor.sql` y define las dos
variables. Cada tabla guarda el objeto completo en `datos` (jsonb) y expone como
columnas generadas los campos por los que se filtra, así hay un solo camino de escritura
y las consultas siguen siendo SQL normal.

## Límites conocidos

- El envío del mensaje **no está conectado a WhatsApp**: se redacta y se registra en la
  conversación, pero un humano lo despacha. Falta integrar un proveedor (Twilio, Meta
  Cloud API) para cerrar ese tramo.
- Las visitas quedan en estado `propuesta`: no hay confirmación del comprador ni
  sincronización con Google Calendar.
- El valor de la UF se lee de mindicador.cl; si falla, se usa un valor de respaldo
  (`UF_FALLBACK_CLP`) que conviene actualizar.
- El agente no negocia precio ni emite cotizaciones formales.
