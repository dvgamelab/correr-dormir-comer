# Correr · Dormir · Comer

Calendario de **todas las carreras de España que se pueden encontrar**: asfalto, trail, 5K, 10K, media, maratón y ultra. Cada semana se vuelve a recolectar y convierte cualquier carrera en un **plan de fin de semana**: correr, dormir y comer. El plan completo se comparte con un enlace.

Proyecto personal, sin monetización.

## Qué hace

**App móvil en vertical.** Se instala en el móvil desde el navegador ("Añadir a pantalla de inicio"), se abre a pantalla completa, está bloqueada en vertical y el botón *atrás* del móvil cierra pantallas. En ordenador se ve como una columna de teléfono.

- Barra inferior: **Carreras · Mapa · Favoritas · Planes**.
- Chips deslizables: este finde, asfalto/trail, 5K, 10K, media, maratón, ultra.
- Botón **Filtros** (hoja inferior): fechas, comunidad, provincia, cerca de un pueblo o de **tu ubicación GPS**, radio.

**Explorar**
- Lista agrupada por fin de semana ("Este finde", "Próximo finde"…) junto a un mapa de España con todas las carreras.
- Filtros: superficie (asfalto/trail), distancia (5K, 10K, media, maratón, ultra, otras), fecha (este finde, próximo, 30 días, 3 meses o fechas a medida), comunidad autónoma, "cerca de" un pueblo con radio (25–200 km), texto libre y favoritas.
- "Filtrar por zona del mapa": al mover el mapa, la lista enseña solo lo visible (como en Airbnb).
- Ficha de cada carrera con fecha, lugar, distancias, desnivel, web oficial o inscripción, y enlaces a las fuentes.

**Planificar (correr → dormir → comer)**
- **Correr**: distancia que corres, número de personas, desde dónde sales (km y tiempo aproximados, y ruta en Google Maps), fechas de llegada y vuelta.
- **Dormir**: busca hoteles, hostales, apartamentos, casas rurales, campings y refugios cerca de la salida (OpenStreetMap/Overpass) ordenados por distancia. También lleva a Booking, Airbnb y Google Hoteles con las fechas y personas ya puestas. Puedes añadir alojamientos a mano.
- **Comer**: cena de la víspera (pasta), desayuno y comida post-carrera, y puedes añadir más comidas. Sugiere sitios cercanos según lo que te apetezca (italiano, local/tapas, cafetería, vegetariano, asiático…).
- **Itinerario** por días, generado a partir de lo anterior y editable.
- **Mochila**: checklist, que suma material obligatorio si la carrera es de trail.
- **Presupuesto** total y por persona, y notas.
- Mapa del plan con la salida, el alojamiento y los restaurantes.

**Compartir**
- **Enlace** que lleva el plan completo comprimido dentro (`?plan=…`). No hace falta servidor ni cuenta. Quien lo abre lo ve y puede guardarlo en sus planes.
- Código QR, resumen en texto para WhatsApp o Telegram, calendario `.ics` con todos los eventos y exportar/importar en JSON.

Funciona como PWA: se puede instalar en el móvil y usar sin conexión con los datos de la última visita.

## De dónde salen los datos

`scraper/run.py` recolecta de varias fuentes, normaliza provincia y comunidad, geolocaliza y **fusiona duplicados** entre fuentes (misma fecha + nombre parecido + cercanía):

| Fuente | Qué aporta |
|---|---|
| [running.life](https://running.life/running-calendar/spain) y [gotrail.run](https://gotrail.run/trail-running-calendar/spain) | El calendario más amplio (unas 1.900 pruebas en España) con coordenadas GPS, distancias y web oficial |
| [Runedia (Mundo Deportivo)](https://runedia.mundodeportivo.com/calendario-carreras/) | Tipo de prueba (asfalto, montaña, cross…) y distancia exacta |
| [CarrerasPopulares.com](https://carreraspopulares.com/calendario_carreras) | Carreras populares, servicios y enlace de inscripción |
| [Runnea](https://www.runnea.com/carreras-populares/calendario/) | Grandes carreras verificadas (maratones, medias, trails de referencia) |
| [Corriendo Voy](https://corriendovoy.com/calendario-de-carreras/) | Calendario WordPress con hora de salida |
| [Foro Runners](https://www.fororunners.es/events/lista/) | API REST de su calendario: hora, precio y web oficial (muy completo en Madrid) |

- Se descarta lo que no es correr: BTT, ciclismo, triatlón, duatlón, natación, orientación, esquí, virtuales y marchas no competitivas.
- Coordenadas: las de la fuente si las trae. Si no, las de otra carrera del mismo pueblo, o se buscan en Photon (Komoot, OSM) con Nominatim de respaldo y caché en `data/cache/geocode.json`. Como último recurso se usa el centro de la provincia, y el mapa marca esas carreras como "ubicación aproximada".
- La provincia se calcula por polígono con los límites del IGN, así que no depende de cómo la escriba cada web.
- **Duplicados**: una misma carrera suele aparecer en 2-5 webs con nombres distintos ("XVI Carrera Solidaria de la Ilusión" / "Carrera Solidaria de la Ilusión"). Se unen automáticamente si coinciden fecha (o ±1 día con nombre casi idéntico), sitio (GPS a menos de 12 km, mismo pueblo o misma provincia si falta el dato) y alguna palabra distintiva del nombre. Las palabras que salen en muchas carreras ("San Silvestre", "Volta a Peu", "contra el Cáncer") se detectan solas y no cuentan. También se entienden variantes bilingües (Castelló/Castellón, Mitja/Media, Platja/Playa). Nunca se unen dos carreras con GPS separadas más de 25 km ni con distancias incompatibles.
- Cada ejecución deja `data/dedupe_report.json` con qué se ha unido y por qué, y `python tools/check_dupes.py` lista fusiones dudosas y posibles duplicados sin unir para revisarlos.
- Si una fuente falla, se reutiliza su último volcado (`data/raw/*.json`) y la app lo indica en el pie de la lista.

Fuentes que se probaron y no se usan todavía: Carreiras Galegas (su clave de búsqueda pública está caducada), ClubRunning, CarrerasPorMontaña y Ahotu tienen captcha o Cloudflare. Runnun guarda los datos dentro de su app. RockTheSport y Sportmaniacs exigen credenciales en su API, aunque muchas de sus carreras entran vía running.life. TrailRun.es no tiene calendario publicado. Se pueden añadir como un módulo más en `scraper/sources/`.

## Poner en marcha

### En local
```bash
pip install -r scraper/requirements.txt
python scraper/run.py            # ~20 min la 1ª vez (fichas de detalle); luego ~3 min gracias a la caché
cd web && python -m http.server 8000   # abre http://localhost:8000
```
Para refrescar solo una fuente: `python scraper/run.py --only runedia`.

### Publicado y actualizado cada semana (GitHub Pages)
1. Crea un repositorio en GitHub y sube esta carpeta.
2. En **Settings → Pages**, elige **Source: GitHub Actions**.
3. En **Actions**, lanza "Recolectar carreras (semanal) y publicar" con *Run workflow*.

A partir de ahí se ejecuta **cada lunes a las 04:00 UTC**: recolecta, guarda los datos en el repo y publica la web en `https://<usuario>.github.io/<repo>/`. Los enlaces de planes compartidos apuntan a esa URL.

## Estructura
```
scraper/
  run.py            orquestador: fuentes → normalizar → geolocalizar → fusionar → web/data/races.json
  common.py         modelo Race, parseo de distancias/desnivel, filtros de "no es running"
  geo.py            provincias, comunidades, centroides
  sources/*.py      un módulo por fuente (fetch(cache) -> [Race])
web/                app estática sin build (HTML + CSS + JS + Leaflet)
  data/races.json   datos generados
  data/spain.geo.json  provincias (IGN vía es-atlas) para el mapa sin conexión
tools/build_artifact.py  versión para vista previa en Claude
.github/workflows/weekly.yml  cron semanal + despliegue en Pages
```

## Inspiración (qué hay en el mercado)
- **Ahotu / Finishers / RaceRaves**: tarjetas con fecha destacada, chips de distancia y filtros rápidos. Aquí la fecha va como un dorsal y los chips muestran los km.
- **Runnun / Runedia**: calendario por provincias, favoritas, planificación de temporada.
- **Airbnb**: lista + mapa sincronizados y la opción de filtrar al mover el mapa.
- **Wanderlog / TripIt**: el plan como itinerario por días con mapa de los puntos, y compartir el plan entero con un enlace.

## Límites conocidos
- Las carreras sin coordenadas en la fuente pueden quedar en el centro de la provincia hasta que el geocoding las resuelva (mapa: punto gris discontinuo).
- Las sugerencias de alojamiento y restaurantes dependen de lo etiquetado en OpenStreetMap. Para precios y disponibilidad están los enlaces a Booking, Airbnb y Google.
- Revisa siempre fecha, hora y recorrido en la web oficial.
