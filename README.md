# Event Intelligence · Consola

La consola de operación en vivo para recintos: el "centro de mando" de
`../event-intelligence-vision/`, ahora como producto. Muestra accesos, filas, barras, densidad
en pista y la bitácora de todas las áreas sobre la maqueta 3D del estadio. Un copiloto propone
acciones (abrir carriles, desviar fans, abrir cajas, abrir la válvula de alivio) que se aprueban
o se ejecutan solas, y al final arma el reporte post-evento.

No es un cliente: es producto propio de la agencia. OCESA es un prospecto.

## Qué hace

| Pantalla | Para qué |
|---|---|
| `/` Consola | Hora del evento, indicadores, mapa 3D con las alertas en su lugar, peor espera a 30 min por puerta, bitácora por área, acciones por aprobar, copiloto, ingreso real contra esperado, barras |
| `/reporte` | Asistencia, pico, espera promedio y p95 ponderadas por persona, horas-persona en fila, ventas por barra, acciones del copiloto, bitácora de Protección Civil. CSV e impresión a PDF |
| `/configuracion` | Evento (fecha, horarios, aforo, boletos), puertas (reparto, carriles, máximo), barras (cajas), umbrales, copiloto automático, fuente de datos y guía de integración |

## Cómo funciona

Cada petición a `/api/state` reconstruye el evento minuto a minuto desde la apertura de puertas
(`src/lib/engine.ts`). No hay procesos en segundo plano, así que corre igual en Vercel.

- **Fila por puerta:** con sensor de fila (cámara/LiDAR) se usa el dato. Sin sensor se estima:
  llegadas esperadas (boletos × curva de llegada × reparto de la puerta) menos escaneos. Con
  sensor, la curva se recalibra con lo que realmente llega.
- **Espera** = fila / (carriles × escaneos por carril por minuto).
- **Pronóstico** a 30 min por puerta con los carriles actuales.
- **Reglas del copiloto:** si la espera o su pronóstico pasa el umbral de "saturada", propone
  los carriles mínimos para volver a menos de 5 min. Si ya no hay carriles, propone desviar 30%
  a la puerta más fluida. También propone cajas cuando la fila de una barra pasa el umbral, y la
  válvula de alivio cuando la densidad en pista lo pasa. En vivo también avisa si una barra lleva
  10 min sin ventas mientras las demás venden.
- **Acciones:** con el copiloto automático se ejecutan solas; en modo manual esperan tu
  aprobación. Una vez aprobadas cambian la operación desde ese minuto.
- **En vivo, una puerta sin ningún dato** (ni escaneos ni sensor) se marca "sin datos" y no se
  estima, para no inventar filas.

## Fuentes de datos

- **Simulador** (por defecto): un estadio de 60,000 personas con datos sintéticos. Tiene
  controles de reproducir, pausa, velocidad (1×–30×), saltar en la línea de tiempo y reiniciar.
  Sirve para demos y capacitación.
- **En vivo**: lo que llega a `POST /api/ingest`, en el reloj real y la zona horaria del recinto.

```bash
curl -X POST https://<tu-proyecto>.vercel.app/api/ingest \
  -H "Content-Type: application/json" -H "x-api-key: $INGEST_API_KEY" \
  -d '{"events":[
    {"type":"scan","gate":"C","count":42},
    {"type":"queue","gate":"C","people":380},
    {"type":"sale","bar":"4","amount":1250.5,"count":7},
    {"type":"bar_queue","bar":"4","minutes":9},
    {"type":"density","value":3.4},
    {"type":"alert","area":"SEG","text":"Objeto olvidado en Acceso B","severity":"warning","at":"gate:B"}
  ]}'
```

`ts` es opcional en cada evento (ISO o milisegundos); sin él se usa la hora de llegada. Se
aceptan hasta 5,000 eventos por petición. La respuesta dice cuáles se rechazaron y por qué.
Las puertas son A–H y las barras 1–6 porque coinciden con la maqueta 3D.

## Variables de entorno (todas opcionales)

Ver `.env.example`.

| Variable | Sin ella | Con ella |
|---|---|---|
| `INGEST_API_KEY` | `/api/ingest` responde 503 | Acepta datos con `x-api-key` |
| `CONSOLE_PASSWORD` | Consola pública | Pide contraseña (Basic Auth) en todo, excepto `/api/ingest` |
| `ANTHROPIC_API_KEY` | Copiloto por reglas (puertas, aforo, PC, acciones) | Preguntas libres respondidas por Claude (`claude-opus-5-5`, esfuerzo bajo, con fallback por defecto) usando el estado del minuto |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` (o `UPSTASH_REDIS_REST_*`) | Memoria del proceso | Upstash Redis: datos y decisiones compartidos y persistentes |

**Importante en Vercel:** sin Redis, cada instancia del servidor tiene su propia memoria y se
borra al reiniciar, así que las decisiones y la configuración pueden "olvidarse". Para cualquier
uso real conecta Upstash Redis desde Vercel → Storage → Marketplace. Crea las variables solo.

## Desplegar en Vercel

1. Importa el repo en Vercel y pon **Root Directory** = `ui/event-intelligence-console`. El
   framework se detecta como Next.js.
2. (Recomendado) Storage → Upstash Redis → conéctalo al proyecto.
3. Variables: `CONSOLE_PASSWORD`, `INGEST_API_KEY` y, si quieres el copiloto con IA,
   `ANTHROPIC_API_KEY`.
4. Deploy. Abre `/configuracion` para poner el evento real.

O desde la terminal, dentro de esta carpeta: `npx vercel` (y `npx vercel --prod`).

## Desarrollo

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # pruebas del motor (simulador, modo manual, datos reales, puertas sin datos)
npm run typecheck
npm run build
```

| Qué | Dónde |
|---|---|
| Motor (fila, espera, pronóstico, reglas, simulador) | `src/lib/engine.ts` |
| Tipos y configuración por defecto | `src/lib/types.ts`, `src/lib/defaults.ts` |
| Almacenamiento (memoria / Redis) | `src/lib/store.ts` |
| Copiloto (reglas y Claude) | `src/lib/copilot.ts` |
| Reporte y CSV | `src/lib/report.ts` |
| API | `src/app/api/*/route.ts` |
| Contraseña | `src/proxy.ts` |
| Maqueta 3D | `src/lib/stadium3d.ts`, `src/components/Venue3D.tsx` (copias de `event-intelligence-vision`) |
| Pantallas | `src/components/Console.tsx`, `ReportView.tsx`, `Settings.tsx` |

## Límites conocidos

- Un solo evento a la vez por despliegue. Para otro evento, cambia la configuración y reinicia.
- Las puertas (A–H), barras (1–6) y spots (1–5) son fijos porque coinciden con la maqueta 3D.
  Otro recinto necesita su propia maqueta.
- La contraseña es una sola para todos (Basic Auth). Usuarios y roles por área quedan para
  después.
- La consola se actualiza consultando cada 1.5 s (simulador) o 5 s (en vivo); no usa websockets.
