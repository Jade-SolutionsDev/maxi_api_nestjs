# La memoria de la API: cómo se mira y cómo se saca una instantánea

Contexto: `MxH-0166`. La API se queda sin memoria y muere. El montón llega a
~4.050 MB —el techo por omisión de Node— y el recolector no libera nada, que
es la firma de una fuga. Producción cayó así el 8-oct-2026, tras 69 horas en
pie; staging aguanta entre 8 y 24.

## Lo que ya mide sola

Desde `MemoryWatchService`, la API escribe una línea por minuto:

```
[Memoria] heap_usado_mb=512 heap_total_mb=620 heap_limite_mb=4096 uso_pct=12 rss_mb=712 externa_mb=38 horas_en_pie=3.2
```

- Pasado el **75 %** del techo, la línea sale como aviso con `estado=alto`.
- Pasado el **90 %**, como error con `estado=critico`. Después de eso quedan
  minutos: lo siguiente es el `FATAL ERROR` y el reinicio, con las peticiones
  en vuelo perdidas.
- `MEMORY_WATCH_INTERVAL_MS` cambia el ritmo; `0` lo apaga.

En Grafana, sobre la fuente de Loki:

```logql
{container=~"api.*"} |= "[Memoria]" | pattern "<_> uso_pct=<uso_pct> <_>" | unwrap uso_pct
```

Y la misma línea sirve para responder la pregunta que decide el diagnóstico:
**si el montón sube monótono entre corridas o solo durante ellas.** Hasta
ahora no se podía saber, porque solo se veía el valor final, el del momento de
morir.

A demanda, sin esperar al minuto: `GET /api/health/memory` (admin o
superadmin).

## Lo que sigue haciendo falta: la instantánea

Saber **cuánto** crece no dice **qué** se retiene. Eso solo lo contesta una
instantánea del montón, y para eso hay que entrar al contenedor. Node lo trae
de serie, sin código:

1. En Dokploy, en la aplicación de la API, añadir:

   ```
   NODE_OPTIONS=--heapsnapshot-signal=SIGUSR2
   ```

   y volver a desplegar. **En staging primero.**

2. Dejarla correr hasta que `uso_pct` pase de 60 —ahí ya hay suficiente
   retenido para que se note quién lo retiene— y pedir la instantánea:

   ```bash
   docker kill -s SIGUSR2 <contenedor-de-la-api>
   ```

   Escribe un `Heap.<fecha>.heapsnapshot` en el directorio de trabajo del
   proceso. **Ocupa más o menos lo que ocupe el montón**, así que conviene
   mirar que haya disco antes.

3. Sacarlo y abrirlo:

   ```bash
   docker cp <contenedor>:/app/Heap.<fecha>.heapsnapshot .
   ```

   En Chrome: *DevTools → Memory → Load*. Ordenar por *Retained Size* y mirar
   quién encabeza.

4. **Dos instantáneas valen mucho más que una.** Una a los 10 minutos de
   arrancar y otra con el montón ya alto: la comparación (*Comparison* en
   DevTools) enseña lo que creció, que es la pregunta, en vez de lo que hay,
   que es casi todo legítimo.

Mientras tanto no hay diagnóstico, solo hipótesis. Van tres descartadas:
no es la pasarela, no es el límite del contenedor —ninguna aplicación tiene
`memoryLimit` puesto en Dokploy— y no es un acumulador a la vista en el
código.

## El atajo cuando no hay `docker`: el muestreo de asignaciones

La instantánea pide entrar al contenedor. El muestreo de asignaciones de V8 no: se pide desde
dentro del propio proceso, pesa kilobytes y devuelve **pilas de llamada con fichero y línea**.

```bash
# Encender en Dokploy, solo donde se vaya a mirar:
HEAP_PROFILE_ENABLED=true

# Con sesión de superadmin:
POST /api/health/heap-profile/start     # ?interval=65536 (bytes entre muestras)
GET  /api/health/heap-profile?top=25    # lo acumulado, sin detenerlo
POST /api/health/heap-profile/stop
```

**Qué mide y qué no.** Mide asignaciones vivas por muestreo, **no retención**: una función que
asigna mucho y lo suelta también sale arriba. Lo que convierte esto en una pista es **leerlo dos
veces**: lo que crece entre una lectura y otra mientras el montón sube es el sospechoso. La
prueba sigue siendo la instantánea; esto dice dónde mirar.

## Y el parche que no cierra la tarjeta

Poner `memoryLimit` en Dokploy y dejar que reinicie es un parche razonable
para que la caída sea ordenada, pero no arregla nada: el pedido que se está
creando en ese momento se pierde igual.
