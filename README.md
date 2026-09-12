# Gestor inmobiliario — Prosperity

CRM de corretaje con un agente que atiende la captación, montado sobre el CRM de
**JetBrokers**: recibe la consulta de un comprador, extrae su perfil financiero,
calcula cuánto puede pagar con criterios de la banca chilena, la calza contra el
inventario real de proyectos, conversa por WhatsApp y correo, agenda la visita, y
después lleva la operación hasta la inscripción en el Conservador.

### Cómo se reparte con JetBrokers

JetBrokers es dueño del **cliente y del catálogo**: es lo que su API expone. Este
sistema es dueño de la **operación del cierre** —reserva, banco, notaría, Conservador—
que su API no cubre. El estado vuelve al campo `status` del CRM, así el ejecutivo ve lo
mismo en los dos lados y no hay dos verdades.

## Cómo funciona

```
consulta ─► extracción ─► capacidad de compra ─► calce con inventario ─► puntaje
             (Claude)      (reglas banca CL)      (JetBrokers)           (determinista)
                                                                             │
                        CRM JetBrokers ◄── redacción + agenda ◄──────────────┘
                         (Customer API)        (Claude)                      │
                                                                             ▼
                                                              WhatsApp / correo
                                                                             │
  ┌──────────────────────────────────────────────────────────────────────────┘
  ▼
respuesta del comprador ─► intención ─► confirma o reagenda la visita
   (webhook firmado)       (Claude)   ─► recibe documentos por correo
                                      ─► escala a una persona
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

## Conversación con el comprador

El agente responde por **WhatsApp** y por **correo**, y sigue la conversación:
confirma visitas, reagenda, cancela, pide los documentos de la preaprobación y
registra los que llegan.

### La regla que define el diseño: la ventana de 24 horas

WhatsApp **no permite escribir libremente a un comprador**. Pasadas 24 horas
desde su último mensaje, Meta solo acepta **plantillas aprobadas**. Por eso:

- El despachador comprueba la ventana antes de cada envío y cambia solo a la
  plantilla equivalente cuando está cerrada.
- A un lead que llegó de un portal y nunca escribió por WhatsApp se le responde
  por correo, aunque tengamos su teléfono: nunca hubo ventana que abrir.
- `src/lib/mensajeria/plantillas.ts` es el catálogo a dar de alta en el
  WhatsApp Manager. `validarPlantilla` comprueba las reglas de formato de Meta
  (numeración corrida de `{{1}}`, sin variables al inicio o al final, sin dos
  seguidas, botones de hasta 20 caracteres) **antes** de mandarlas a revisión,
  que es donde se pierden los días. La página `/mensajeria` las muestra listas
  para copiar.

### Frenos

El agente es autónomo, pero acotado. Todo sale por un solo punto
(`despachar`), de modo que los frenos no se puedan saltar desde otra parte:

| Freno | Valor por defecto |
|---|---|
| Horario de contacto | 9:00 a 21:00, hora de Chile |
| Mensajes automáticos por lead al día | 3 |
| Seguimientos seguidos sin respuesta | 3, y después lo toma una persona |
| Espaciado entre mensajes | 10 minutos |
| Tope absoluto diario | 12, no se salta ni contestando |

**Contestar no está sujeto al horario, al tope diario ni al espaciado.** Esos
frenos existen para que el agente no insista por iniciativa propia; impedirle
responder a alguien que acaba de escribir sería otra cosa.

**Escala a una persona** —y deja de responder— ante negociación de precio,
reclamos o temas legales, si le piden hablar con alguien, si le preguntan si es
un bot, o ante trámites de cierre. La baja (`BAJA`, "no me escriban más") manda
sobre todo lo demás.

### Documentos

El agente pide por correo los documentos que la banca chilena exige, ajustados
a si el comprador es dependiente o independiente y a si compra en pareja. El
correo dice **para qué sirve cada documento**, hasta cuándo se conservan y cómo
ejercer los derechos sobre esos datos: es lo que exige la Ley 21.719, vigente
desde el 1 de diciembre de 2026, y además es lo que hace que la gente
efectivamente los mande.

Cuando el comprador responde con los adjuntos, se registra **solo metadatos**:
qué documento llegó, cuándo y con qué nombre de archivo. El contenido se queda
en el proveedor de correo y se descarga bajo demanda. Nada de esto se copia al
campo de comentarios de JetBrokers, que es visible para toda la organización.

El clasificador de adjuntos es deliberadamente conservador: si el nombre del
archivo no dice claramente qué documento es, lo deja sin clasificar para que lo
revise una persona, en vez de dar por recibido algo que no llegó.

### Webhooks

| Ruta | Qué recibe |
|---|---|
| `GET /api/whatsapp` | Desafío de verificación de Meta |
| `POST /api/whatsapp` | Mensajes y estados de entrega, con firma `X-Hub-Signature-256` |
| `POST /api/correo` | Eventos de Resend, con firma Svix |

Ambos verifican la firma sobre el **cuerpo crudo** antes de parsear el JSON, y
descartan los mensajes repetidos por el id del proveedor: los dos proveedores
reintentan, y sin eso una visita se confirmaría dos veces.

## Cierre de la venta

Desde la reserva hasta la entrega, con los hitos que tiene una compraventa chilena:
reserva, evaluación bancaria (tasación y estudio de títulos), promesa, escrituración,
firmas ante notario, inscripción en el Conservador, pago y entrega.

**La etapa no se declara a mano**: se deduce de los hitos cumplidos, y apunta a dónde
está la pelota hoy, no al último hito marcado.

### Lo que realmente hace caer un cierre

No es la falta de trabajo, es que a nadie le avisó. El sistema alerta de:

- **Certificados vencidos.** Los del Conservador duran 30 días y los de no expropiación
  60. La vigencia se cuenta **desde la emisión**, no desde que el documento llegó: un
  dominio vigente sacado hace 25 días llega con 5 días de vida, no con 29.
- **Plazos duros.** El vencimiento de la reserva y el plazo de la promesa para
  escriturar salen como críticos: tienen consecuencias contractuales, no son un atraso
  más.
- **Tasación bajo el precio.** Si el banco tasa por debajo, al comprador le falta pie.
  Conviene saberlo ahí y no en la firma.
- **Reparos** del estudio de títulos y del Conservador, y **crédito rechazado**.

### Control documental

Dos catálogos distintos: los del **comprador** (liquidaciones, AFP, carpeta tributaria,
cartola) y los de la **propiedad y el vendedor** (dominio vigente, hipotecas y
gravámenes, prohibiciones, no expropiación, contribuciones, gastos comunes, recepción
final). Cada uno dice dónde se pide, para qué sirve y en qué etapa tiene que estar
arriba. Del contenido no se guarda nada: solo metadatos.

## Usuarios y permisos

| Rol | Alcance |
|---|---|
| Ejecutivo | Su cartera. Edita el cierre y los documentos de sus operaciones |
| Operaciones | Toda la cartera, para control documental y cierres |
| Jefatura comercial | Todo, más el control de gestión y reasignar cartera |
| Administrador | Todo, más la gestión de usuarios |

Un lead fuera de tu cartera no existe para ti: la ficha responde "no encontrado", no
"sin permiso".

Las claves se guardan con **scrypt** y sal por usuario; la sesión va en una cookie
`httpOnly` firmada con HMAC-SHA256 que caduca a las 12 horas. No hay auto-registro: los
usuarios los crea un administrador con `npm run usuarios`. En producción `AUTH_SECRET`
es obligatorio y la aplicación no arranca sin él.

Esto es autenticación propia, no un proveedor externo. Es suficiente para un sistema
interno sin registro abierto, pero si más adelante quieren SSO con Google Workspace o
segundo factor, el camino es cambiar esta capa por Supabase Auth: el resto del código
solo consulta `usuarioActual()`.

## Control de gestión

Dos miradas, calculadas sobre lo que ya está registrado —sin contadores aparte que se
puedan desfasar:

- **Por ejecutivo**: cartera, mediana de tiempo hasta la primera respuesta, leads sin
  responder, visitas, cierres, pipeline y comisión proyectada.
- **Del agente**: cuántos leads calificó con el modelo y cuántos con la heurística,
  mensajes enviados y frenados, escalamientos, bajas y errores, con el desglose de por
  qué se detuvo. Un agente que escala seguido no está fallando: está pidiendo ayuda.

## Correr el proyecto

```bash
npm install
cp .env.example .env.local     # completa lo que tengas a mano
npm run dev                    # http://localhost:3000
```

Sin configurar nada funciona igual: inventario de demostración, tienda en memoria,
heurística local en vez del modelo y cuatro usuarios de prueba que se crean solos. Cada
conexión que agregues reemplaza una pieza. Las cuentas de demostración **solo existen
mientras los datos estén en memoria**: en cuanto configuras Supabase desaparecen.

| Variable | Efecto |
|---|---|
| `JETBROKERS_ORG_ID` | Trae el inventario real; sin esto usa proyectos de demostración |
| `JETBROKERS_ESCRITURA=true` | Habilita la creación de clientes en el CRM |
| `ANTHROPIC_API_KEY` | Usa Claude para extraer y redactar; sin esto, heurística local |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | Persiste en Postgres en vez de memoria |
| `AUTH_SECRET` | Firma las sesiones. Obligatorio en producción (mínimo 32 caracteres) |
| `INGESTA_TOKEN` | Exige `x-ingesta-token` en las rutas de API |
| `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` | Conecta WhatsApp; sin esto los mensajes van a la bandeja simulada |
| `WHATSAPP_APP_SECRET` | Verifica la firma del webhook. Sin él se rechazan todos |
| `WHATSAPP_ENVIO=true` | Habilita el envío real por WhatsApp |
| `RESEND_API_KEY` + `CORREO_REMITENTE` | Conecta el correo |
| `CORREO_ENVIO=true` | Habilita el envío real de correos |

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
npm run prueba   # 119 pruebas: API, finanzas, calce, frenos, conversación, cierre
npm run usuarios # alta de usuarios (requiere Supabase)
npm run tipos    # typecheck
npm run mock          # mock del API de JetBrokers
npm run mock:whatsapp # mock de la Cloud API de WhatsApp
```

## Persistencia

Sin Supabase todo vive en memoria y se pierde al reiniciar el proceso — suficiente para
simular. Para persistir, aplica `supabase/migrations/0001_gestor.sql` y define las dos
variables. Cada tabla guarda el objeto completo en `datos` (jsonb) y expone como
columnas generadas los campos por los que se filtra, así hay un solo camino de escritura
y las consultas siguen siendo SQL normal.

## Límites conocidos

- **La integración de WhatsApp está escrita y probada contra un simulador, pero no
  contra la API real**: todavía no hay una cuenta de WhatsApp Business. Falta crear el
  WABA, verificar el número, dar de alta las plantillas del catálogo y esperar su
  aprobación.
- Los recordatorios de visita y de documentos pendientes están como plantillas, pero
  falta el proceso que los dispara solo (un cron que revise la agenda cada mañana).
- Las visitas confirmadas no se sincronizan con Google Calendar.
- Los documentos se quedan en el proveedor de correo: no hay todavía un proceso que los
  elimine al cumplirse el plazo informado, solo la fecha registrada.
- Las fechas comprometidas de los hitos saltan sábados y domingos, pero **no los
  feriados chilenos**: el calendario cambia cada año y una tabla desactualizada da
  peores fechas que no tenerla. Son estimaciones para detectar atrasos, no plazos
  contractuales.
- **Ningún banco chileno ofrece API para corredores**, así que el estado del crédito lo
  registra una persona. Lo mismo con la notaría y el Conservador.
- No hay segundo factor ni bloqueo por intentos fallidos en el ingreso.
- El valor de la UF se lee de mindicador.cl; si falla, se usa un valor de respaldo
  (`UF_FALLBACK_CLP`) que conviene actualizar.
- El agente no negocia precio ni emite cotizaciones formales.
