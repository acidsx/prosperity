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

### Cómo se conecta

1. **Consigue el `organizationId`.** Es el que aparece en las URLs del API
   (`/api/gallery/customer/{organizationId}`).
2. **Comprueba la conexión desde la red de la corredora**, que es donde el API es
   alcanzable:

   ```bash
   JETBROKERS_ORG_ID=<el tuyo> npm run jetbrokers -- diagnostico
   ```

   Prueba los cinco endpoints en modo lectura, contrasta la respuesta real contra los
   tipos del proyecto, y lista los valores de `locality`, `stage`, `mode`, `scope` y
   `tags` que existen de verdad: son justamente las listas que la documentación dejó en
   blanco. **No toca el POST de clientes**, que crearía un registro.
3. **Revisa qué se enviaría** antes de habilitar la escritura:

   ```bash
   npm run jetbrokers -- payload
   ```
4. **Pide la whitelist de IP.** Sin ella son 10 clientes por hora y por IP; con ella,
   900. Para una corredora con varios ejecutivos, 10 se acaban en una mañana.
5. **Habilita la escritura** cuando el payload te calce:
   `JETBROKERS_ESCRITURA=true`.

### Devolución de estado

El Customer API no tiene endpoint de actualización: para cambiar el `status` se vuelve
a hacer POST del mismo cliente, y JetBrokers lo reconoce por `email`, `mobile` o
`taxId` y anota los valores nuevos en su timeline.

Eso significa que **cada actualización gasta uno de los diez envíos por hora**. Por eso:

- Se guarda una huella del último payload enviado y **no se reenvía nada idéntico**.
- Si no queda cupo, la sincronización queda `pendiente` en vez de fallar, y
  `POST /api/crm` la reintenta (pensado para un cron cada hora).
- El reintento se detiene al primer rechazo por cupo: el límite es por IP, no por lead.

La etapa del cierre manda sobre el estado comercial: todo el tramo entre la reserva y la
entrega viaja como `closing`, `cerrado` como `customer` y `caido` como `dropped`. El CRM
no distingue las etapas internas del cierre; ese detalle vive acá.

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
- **Nada de esto se ha probado contra el API real**: el entorno donde se desarrolló
  bloquea `api.jetbrokers.io`. Todo está verificado contra un simulador que replica el
  contrato del documento. El comando `diagnostico` existe justamente para cerrar esa
  brecha en un paso desde tu red.

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

## Simular una venta completa

```bash
npm run simular
```

Recorre el ciclo entero, de la consulta a la entrega, y lo narra paso a paso. Dentro de
la aplicación está en `/simulacion`, con enlaces a la conversación y al cierre que deja
creados, para poder recorrerlos.

**No es una animación.** La calificación, la respuesta, la confirmación de la visita y
la recepción de documentos las hace el agente llamando a las mismas funciones que
corren en producción. Lo simulado son las respuestas del comprador, del banco, de la
notaría y del Conservador, porque ninguno de los tres tiene API.

Comprime unos cuatro meses en una corrida: los hitos llevan fechas reales calculadas
hacia atrás desde hoy, y los mensajes de la conversación se reescriben a esas fechas
para que la ficha del lead quede coherente.

El guion incluye dos momentos que valen la pena:

- **La unidad queda sobre la aprobación del banco.** El calce admite hasta 10% por
  encima del techo por considerarlo negociable, así que la venta se cierra con el
  descuento que haga falta. Sin eso, al comprador le faltaría pie en la firma.
- **Los certificados del Conservador vencen a mitad de camino.** Se sacaron el día 9 y
  duran 30 días; al llegar a la escritura, el día 60, ya no sirven. La alerta salta y se
  vuelven a pedir. Sin ella, el problema aparece en el mesón de la notaría.

La simulación también funciona como prueba de integración del recorrido completo: si
algo se rompe entre la captación y el cierre, sus ocho pruebas lo detectan.

## El closer: el agente conversando con modelo

Las simulaciones anteriores detectan la objeción con expresiones regulares y responden
con texto escrito a mano. Eso es un bot con buen guion: contesta lo previsto y nada más.
El closer mueve la conversación al modelo y deja al código haciendo lo que el código hace
mejor.

```bash
npm run closer -- A   # buscador de hogar indeciso
npm run closer -- B   # inversor de alto patrimonio
```

La división de trabajo:

| | quién decide |
|---|---|
| Qué decir, en qué orden, con qué tono, cómo cerrar | el modelo (`SISTEMA_CLOSER`) |
| Qué es verdad: precios, capacidad, dividendo, agenda | el código (`fichaDeHechos`) |
| Si lo que escribió se puede enviar | el código (`verificarRespuesta`) |

**El modelo nunca calcula ni recuerda una cifra.** Cada turno recibe una FICHA DE HECHOS
armada por el código — las unidades reales del inventario, la capacidad calculada con
criterios de la banca, la economía del arriendo, los bloques de agenda — y solo puede usar
números que estén ahí. Después de generar, `verificarRespuesta` revisa la salida cifra por
cifra contra la ficha. Si algo no cuadra, se le devuelve al modelo lo que incumplió y
tiene una corrección; si vuelve a incumplir, la conversación la toma una persona.

Lo que el verificador rechaza:

- una cifra que no está en la ficha (el caso típico: un "5,5% de rentabilidad" que suena
  bien y no salió de ningún cálculo);
- publicar la rentabilidad bruta sin la neta;
- decir que la propiedad "se paga sola" cuando la ficha muestra flujo negativo;
- prometer la aprobación del crédito;
- ofrecer un descuento que el agente no aprueba;
- un mensaje que no cierra con una pregunta.

### Beneficios vigentes: FOGAES, subsidios e IVA

Es la parte del sistema que más rápido se echa a perder. FOGAES tiene fecha de término y
cupos, los subsidios abren y cierran por llamado, y el crédito especial de IVA a la
construcción se extingue por ley con una tasa distinta cada año. Un agente que cite un
beneficio que venció el mes pasado no está siendo útil: está comprometiendo a la corredora.

Por eso el registro **no vive en el código** sino en `datos/incentivos.json`, y cada entrada
obliga a declarar tres cosas: **de dónde salió** (`fuente`), **cuándo lo revisó una persona**
(`verificadoEn`) y **hasta cuándo sirve** (`vigenciaHasta`).

```bash
npm run incentivos            # qué está vigente y qué hay que revisar
npm run incentivos -- --ficha # cómo lo ve el agente
```

El agente solo recibe lo vigente **y** verificado hace menos de 90 días. Lo vencido, lo que
está por vencer y lo que nadie ha confirmado sale como alerta para el equipo, no como
argumento de venta. Un proyecto de ley en trámite se registra para vigilarlo, y nunca se
ofrece.

Dos cosas que el registro evita:

- **Atribuirle al comprador un beneficio que es de la constructora.** El crédito especial de
  IVA lo descuenta la empresa; decirle a alguien que "le devuelven el IVA" es falso. El
  registro marca el `beneficiario` y el verificador rechaza el mensaje que lo confunda.
- **Vender una garantía que no cambia su caso.** FOGAES baja el pie de 20% a 10%, pero
  entonces el límite deja de ser el ahorro y pasa a ser la renta — y con 90% financiado el
  dividendo es *mayor*. `efectoEnCapacidad` acota por pie, por tope del programa y por renta,
  así que la ficha le dice al agente si el beneficio de verdad le sube el techo o no.

### Cuando no le alcanza: las alternativas

El error que esto corrige es concreto: el agente decía "no tengo nada en tu rango" teniendo
proyectos con **bono pie** y **pie cero** en el mismo inventario. Decir que no se puede,
pudiendo, no es prudencia.

`src/lib/dominio/alternativas.ts` calcula las vías que de verdad aplican a cada caso:

| Vía | Qué hace | Qué cuesta |
|---|---|---|
| Multicrédito con segundo titular | Suma ambas rentas líquidas para la carga | Los dos quedan obligados por el total, no por mitades |
| Crédito a 30 años | Mismo dividendo, más capital financiado | Bastante más interés a lo largo del crédito |
| Bono pie | La inmobiliaria aporta parte del pie | Lo aprueba ella, no el corredor, y va con condiciones |
| Pie en cuotas | En verde, el pie se paga hasta la entrega | No reduce el pie, lo reparte |
| Pie cero | Difiere el pie completo | Sube el dividendo: se financia más capital |
| Subsidio | Se suma al pie y no se devuelve | Hay que postular al llamado; nunca sobre el tope legal |
| Leasing habitacional | Sin pie ni evaluación hipotecaria | La propiedad no queda a su nombre hasta el final |

Ninguna se ofrece sin su contra, y solo se ofrecen las que existen: si no hay proyectos con
bono pie en el inventario, no hay bono pie que ofrecer. El verificador rechaza un mensaje que
cierre la puerta teniendo vías disponibles en la ficha.

### El mockup

`mockup/index.html` muestra las dos conversaciones completas con la ficha de hechos que el
código le pasó al modelo en cada turno, las alternativas que encontró y el resultado de la
verificación. Se regenera con `npm run mockup-datos > mockup/datos.json`.

### Auditar un prompt

Los prompts se versionan en `src/lib/agente/closer.ts` (`PROMPTS`) y se guardan literales,
sin corregirles nada: si se editan las frases problemáticas, la prueba deja de medir algo.

```bash
npm run closer -- B --v2            # con el apéndice del sistema y corrección
npm run closer -- A --v25 --crudo   # el prompt literal, sin corregir la salida
npm run auditoria                   # qué observó el verificador, con su norma
```

Hay tres guiones de prospecto, con aperturas deliberadamente distintas para que el radar no
se pruebe siempre contra el mismo saludo:

| | Quién | Cómo entra |
|---|---|---|
| `A` | Sofía Reyes, primera compra | Por redes, informal, sin decir a qué viene |
| `B` | Rodrigo Salazar, inversor | Por correo, formal, pidiendo stock |
| `C` | Patricio Vergara, cliente problemático | Hostil, prohibiendo de entrada el gancho de escasez |

Las versiones con reglas de cadencia (`--v26`) usan guiones extendidos: un prompt que exige
mensajes de dos líneas, un beneficio por vez y tres respuestas positivas antes de cerrar no
cabe en cuatro turnos, y la conversación se cortaría antes de que la regla alcance a operar.

Dos modos de intervención:

| | `correccion` (por defecto) | `--crudo` |
|---|---|---|
| Prompt | con el apéndice de hechos del sistema | literal, como lo escribió su autor |
| Ficha | incluye el recordatorio de lo que se revisa | solo datos |
| Si incumple | se le devuelve al modelo para que rehaga | sale tal cual; la verificación solo anota |

El modo crudo existe para ver qué produce un prompt **por sí solo**. Es la única forma de
evaluarlo: con el apéndice puesto y la corrección andando, se mide el sistema, no el prompt.

`src/lib/dominio/afirmaciones.ts` es la capa que **ningún prompt comercial puede apagar**:
afirmaciones que el agente no puede hacer, cada una con la norma que lo impide, la fuente y
qué decir en su lugar. Varias admiten un patrón que las exonera, porque son ciertas cuando
van con su límite dicho: "el arriendo queda libre de impuesto" es falso a secas y correcto si
aparece el tope de dos viviendas.

Lo que encontró la prueba del v2.0, con norma en contra:

| Afirmación del prompt | Por qué no se puede decir |
|---|---|
| "Vía mutuaria la deuda no se informa al sistema financiero" | La Ley 21.680 creó el Registro de Deuda Consolidada, vigente desde el 01-04-2026: las mutuarias informan en tiempo real |
| "Todas estas unidades son DFL2, el arriendo queda libre de impuesto" | El beneficio corre para un máximo de 2 viviendas por persona natural; de la tercera en adelante tributa |
| "Devolución de impuestos directa a tu bolsillo, hasta 16 UTM" | El artículo 55 bis es una rebaja de la base imponible por intereses, tope 8 UTA, por tramos de renta y máximo 2 viviendas |
| "Los bancos están obligados a financiarte hasta el 90%" | FOGAES es una garantía que habilita, no un mandato; el banco evalúa y los cupos tienen tope |
| "Vacancia casi cero" y "Cash on Cash sobre 12%" | Cifras que no salen de ningún cálculo: el modelo da 2,44% neta con flujo mensual negativo |
| "Haz que sienta que posponer le costará millones" | Los plazos reales se dicen con su fecha; lo demás es presión |

La prueba también encontró un agujero en el propio verificador: el "5,5%" inventado del prompt
calzaba por redondeo con el **6** de las "6:00 p. m." de la agenda. Las horas ya no entran al
conjunto de cifras permitidas y la tolerancia por redondeo quedó restringida a montos de 100 o
más.

### Grabación y reproducción

Una conversación con modelo no se puede probar con assertions ni demostrar sin gastar
tokens. `npm run grabar -- A` graba los turnos contra el modelo y guarda **el prompt
completo junto a la respuesta**. Reproducir verifica la huella del prompt: si el prompt
cambió, la corrida falla en vez de mostrar respuestas que ya no corresponden.

Sin `ANTHROPIC_API_KEY` las simulaciones reproducen la grabación **y lo dicen en pantalla**.
Con la credencial definida corren en vivo. Confundir una demostración grabada con una
corrida real es la forma más fácil de creerle a un agente más de lo que corresponde.

## Simular un comprador indeciso

```bash
npm run simular -- --indeciso
```

La venta anterior es la fácil: alguien que sabe lo que quiere, puede pagarlo y confirma
la visita al primer mensaje. El comprador habitual es el otro — no tiene claro qué
busca, le da miedo endeudarse a 25 años, pregunta qué pasa si pierde la pega, encuentra
todo caro, está mirando otro proyecto y desconfía de que esto sea serio.

Esta simulación muestra **cómo persuade el agente y dónde se detiene**. Los mensajes del
comprador están escritos; cada respuesta la produce `procesarEntrante` detectando la
objeción y `responderObjecion` contestándola, con el mismo código que corre en producción.

Los límites están en el código, en `LIMITES_DE_PERSUASION`, y hay pruebas que los
verifican sobre cada respuesta posible:

- **Se responde con hechos verificables**, no con presión: el dividendo que sale de su
  renta, el arriendo de mercado de una propiedad igual, lo que cubre el seguro de
  cesantía. Nunca escasez ni urgencia inventada ("queda solo uno", "hay otro interesado").
- **La misma objeción se aborda dos veces como máximo.** A la tercera el agente dice que
  no va a seguir insistiendo y deja la puerta abierta. Que alguien repita tres veces que
  no está listo es información, no una barrera que haya que vencer.
- **Si la propiedad está sobre lo que el banco le va a prestar, se lo dice** y ofrece
  buscar en su rango. Meter a alguien temeroso en un dividendo que no puede pagar es un
  negocio que se cae en la firma y una familia con un problema.
- **La desconfianza la toma una persona.** El agente responde con hechos (la reserva se
  paga a la inmobiliaria con comprobante, nadie es dueño hasta la inscripción en el
  Conservador) y ofrece un ejecutivo del equipo.
- **Nunca promete la aprobación del crédito**: la decide el banco.
- **Si pide espacio, se le da.**

Termina donde tiene que terminar un comprador que todavía está decidiendo: pidiendo los
documentos de la preaprobación, que es gratis y no obliga a nada. Sin reserva y sin
visita forzada. En la aplicación está en `/simulacion`, con la conversación completa y
la objeción que respondió cada mensaje.

## Simular un inversionista

```bash
npm run simular -- --inversionista
```

El opuesto del comprador temeroso: no hay miedo que acompañar, hay una calculadora al
otro lado. Rodrigo pide **cuatro departamentos para arriendo** y el agente le dimensiona
la cartera antes de mostrarle una sola unidad.

Los tres momentos que la simulación existe para mostrar:

- **Pide cuatro, le alcanzan dos.** Tratándose de inversión el banco financia el 70%, no
  el 80%: el pie por unidad sube de 20% a 30%. Y el dividendo de cada unidad cuenta como
  deuda para el crédito de la siguiente, así que la carga financiera también frena.
  Descubrirlo en la mesa del banco cuesta tres meses; el agente lo dice el primer día.
- **"Se paga solo con el arriendo" es falso**, y el sistema no puede decirlo. Dividendo
  contra arriendo neto — ya descontados vacancia, administración, contribuciones y
  mantención — da negativo: cada departamento le cuesta plata todos los meses. El agente
  muestra el número y después la otra mitad de la verdad, que es la amortización: parte
  del dividendo no es gasto sino capital que pasa a su patrimonio.
- **El descuento por volumen no lo da el agente.** Lo aprueba la inmobiliaria, así que la
  detección de "descuento" escala sola a una persona.

El modelo vive en `src/lib/dominio/inversion.ts` y el mensaje en
`src/lib/agente/cartera.ts`. Todos los supuestos son constantes con nombre y se presentan
como referencias de mercado, no como tasaciones: retorno bruto por arriendo, financiamiento
por orden de propiedad, vacancia, administración, contribuciones y mantención.

Termina con **dos cierres abiertos en el CRM, uno por unidad** — cada departamento tiene su
propia escritura, su propia inscripción en el Conservador y su propia comisión.

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
npm run prueba   # 285 pruebas: API, finanzas, inversión, calce, frenos, conversación, objeciones, cierre
npm run simular  # una venta completa, narrada paso a paso
npm run simular -- --conversacion  # solo la conversación con el comprador
npm run simular -- --indeciso      # un comprador indeciso, temeroso y lleno de dudas
npm run simular -- --inversionista # un inversionista que quiere varios departamentos
npm run closer -- A | B             # el agente conversando con modelo
npm run incentivos                  # vigencia de FOGAES, subsidios e IVA
npm run closer -- B --v2 [--crudo]  # una conversación con el prompt v2.0
npm run auditoria                   # qué rechazó el verificador y con qué norma
npm run grabar -- A | B             # graba los turnos contra el modelo
npm run jetbrokers -- diagnostico  # prueba la conexión con el CRM
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
