# Referencia para nuevas apps (lecciones de Correr · Dormir · Comer)

Este documento resume **cómo se construyó esta app, qué decisiones se tomaron y por qué, qué falló y cómo se arregló, y qué prefiere el usuario**. Úsalo como referencia para una app parecida: copia las ideas y los patrones que encajen, adapta el resto y **no copies el código a ciegas**.

Repo: `dvgamelab/correr-dormir-comer` · Web: https://dvgamelab.github.io/correr-dormir-comer/

---

## 1. Preferencias del usuario (respetarlas desde el principio)

- **Idioma:** todo en español de España: interfaz, textos, commits, README y respuestas.
- **App móvil en vertical.** Mobile-first de una sola columna. En ordenador se ve como una columna de teléfono centrada. Barra inferior de pestañas. Aviso "gira el móvil" si se pone en horizontal. En Android, `screenOrientation="portrait"`.
- **Quiere APK de Android** para instalar a mano. En iPhone, web instalable (PWA) desde Safari.
- **Diseño claro**, nada oscuro por defecto: el logo con fondo oscuro "no le pegaba". Modo oscuro solo si el sistema lo pide.
- **Nada se guarda sin que él lo pida.** Por ejemplo, un plan es un borrador hasta pulsar "Guardar plan". **Si sales con cambios sin guardar, se pregunta** (Guardar y salir / Salir sin guardar / Seguir editando).
- **Borrar con confirmación** (segundo toque) y **Deshacer** durante unos segundos.
- **El botón atrás del móvil tiene que funcionar bien**: cierra capas en orden, nunca saca de la app de golpe, y a la raíz pide "pulsa otra vez para salir".
- **Compartir = ficha en imagen** con lo importante, más un enlace/QR para importar en la app.
- Le gusta ver **opciones visuales para elegir** (logo, fondos) antes de aplicar cambios de identidad.
- **No monetiza, es uso personal**, y quiere **datos lo más completos posible** ("no te cortes con la extracción").
- Se prueba en su móvil real. Cada vez que cambia la app espera **una APK nueva que se instale encima** (misma firma, `versionCode` +1).

## 2. Arquitectura que funcionó

```
scraper/ (Python)  →  web/data/*.json  →  web/ (HTML+CSS+JS sin build)  →  GitHub Pages
                                                    ↘  mobile/ (Capacitor) → APK
.github/workflows/weekly.yml: cron semanal → recolecta → commit de datos → despliega Pages
```

- **Sin backend.** Datos estáticos JSON en Pages y el estado del usuario en `localStorage`. Compartir va **dentro del propio enlace** (JSON → `CompressionStream('deflate-raw')` → base64url → `?plan=`).
- **Web sin paso de build** (vanilla JS, un `app.js`, un `app.css`, Leaflet por CDN). Así se cambia rápido y es fácil de empaquetar.
- **La APK es la misma web dentro de Capacitor** (`mobile/prepare-web.mjs` copia `web/` a `www/`, activa `window.CDC_APP` y descarga las librerías para funcionar sin conexión). Al abrirse con internet descarga los datos semanales de Pages y, si falla, usa los incluidos. **Así los datos se actualizan sin reinstalar.**
- **Vista previa en Artifact de Claude** con `tools/build_artifact.py`: quita `<html>/<head>`, incrusta el CSS y marca `window.CDC_EMBED`. En el artifact no hay fetch externo, ni teselas, ni descargas, ni `?query`: la app se degrada sola (silueta de provincias en lugar de teselas, "código de plan" en lugar de enlace).

## 3. Recolección de datos (scraping)

- **Una fuente = un módulo** `sources/x.py` con `fetch(cache) -> [Race]`. Si una fuente falla, se reutiliza su último volcado (`data/raw/x.json`) y se marca en `status.json`. **Una fuente caída no tumba el resto.**
- **Busca siempre la vía estructurada antes de parsear HTML**: JSON-LD (`running.life`, `runnea`), APIs REST de WordPress (`/wp-json/wp/v2/...`, The Events Calendar `/wp-json/tribe/events/v1/events`), endpoints AJAX del propio sitio (Runedia `donaUrlFiltres`).
- **Caché persistente** en `data/cache/` (fichas de detalle, geocoding), que se sube al repo. La primera ejecución tardó unos 20 minutos; las semanales, unos 3.
- Fuentes descartadas y por qué: Cloudflare o captcha (ClubRunning, Ahotu, CarrerasPorMontaña), API con clave privada (RockTheSport, Sportmaniacs; no usar claves incrustadas de terceros), clave caducada (Carreiras Galegas). fororunners.**com** ya no existe; la buena es **fororunners.es**.
- Entorno de Claude: el proxy bloquea algunos dominios y Nominatim da **429** por IP compartida. **Photon** (Komoot) sirve para geocodificar pueblos.

## 4. Geografía

- **Provincia por polígono** (límites IGN de `es-atlas`, en `web/data/spain.geo.json`), no por el texto de cada web.
- **8.155 municipios con su centroide** (`web/data/municipios.json`) para buscar "cerca de" cualquier pueblo y recolocar carreras "aproximadas".
- Coordenadas: primero las de la fuente; si no hay, las del mismo pueblo en otra carrera, luego Photon y luego Nominatim. Como último recurso, el centroide de la provincia, marcado `approx` (punto gris discontinuo en el mapa).

## 5. Deduplicado entre fuentes (lo que más costó)

Una misma carrera aparece en 2-5 webs con nombres distintos. Reglas que acabaron funcionando (`scraper/run.py: pair_score/dedupe`):
- Misma fecha, o ±1 día solo si el nombre es casi idéntico.
- Sitio: GPS a <12 km, mismo pueblo, o misma provincia si falta el dato. **Nunca unir dos GPS fiables a >25 km.**
- Hace falta **alguna palabra distintiva compartida**. Las palabras genéricas se calculan solas por frecuencia (si aparecen en ≥9 nombres: "silvestre", "volta", "cancer"…) y **el nombre del pueblo no cuenta como distintivo**.
- Nombres solo genéricos ("Trail de Jalance") → se unen si coinciden pueblo o provincia y las distancias son compatibles (±12 %).
- Alias bilingües (Castelló/Castellón, Mitja/Media, Platja/Playa, Marathon/Maratón).
- Cuidado con la similitud por letras entre palabras cortas ("bestial" ≈ "festival" al 80 %): solo en nombres largos y con umbral alto.
- **Auditar siempre**: `data/dedupe_report.json` (qué se unió y por qué) y `tools/check_dupes.py` (fusiones dudosas y duplicados sin unir).

## 6. Fallos concretos y su arreglo (no repetirlos)

| Síntoma | Causa | Arreglo |
|---|---|---|
| Marcadores invisibles en el mapa | Dos canvas de Leaflet; el de fondo tapaba | Pane propio con `zIndex` bajo para la silueta |
| El mapa tapaba la ficha de detalle | Los panes de Leaflet (z 400-700) escapan del contenedor | `.views{isolation:isolate;z-index:0}` |
| "Mis planes" no se podía tocar | Pantalla superpuesta por encima del plan y de la barra | Convertirla en pestaña (z menor y `bottom` = alto de la barra) |
| El botón atrás de Android cerraba la app | Sin gestionar | `@capacitor/app` `backButton` → `handleBack()`; en web, entrada "guardia" en el historial |
| Tipografías sin aplicar (404) | `url()` relativa a `fonts.css` mal puesta | Rutas relativas al propio CSS; en el artifact se reescriben |
| Carteles rotos | URLs con `&amp;` sin descodificar | `html.unescape` en el scraper y limpieza en la app |
| QR ilegible | Módulos de 2 px | QR grande y módulos enteros; comprobar con **ZXing** (OpenCV falla con QR grandes) |
| La búsqueda de restaurantes no respondía | Overpass saturado, consultado en serie con 20 s cada uno | `Promise.any` a 3 servidores con 9 s y respaldo con Nominatim |
| Todo salía como "trail" | La ficha de running.life incluía categorías de "carreras cercanas" | Ignorar esas categorías y usar la lista de trail |
| Desbordamiento horizontal en móvil | Grid sin `minmax(0,1fr)` e inputs de fecha anchos | `grid-template-columns:minmax(0,1fr)` y `min-width:0` |
| Maven Central 429 al compilar | IP compartida | Espejo de Google en `~/.gradle/init.gradle` |
| Deploy de Pages fallaba | Repo privado y Pages sin activar | Repo público + Settings → Pages → Source: GitHub Actions (lo hace el usuario desde el navegador, no desde la app de GitHub) |

## 7. Android (APK)

- Capacitor 7 + JDK 21 + SDK 35. Plugins: `app` (atrás y enlaces), `share`, `filesystem` (compartir imagen/.ics), `browser` (enlaces externos).
- **Firma propia estable** (`mobile/cdc-release.keystore` + `keystore.properties`, fuera del repo). Si se pierde, las APK nuevas no se instalan encima.
- Enlaces: esquema `correrdormircomer://plan?c=…`. Desde la web en Android, botón "Abrir en la app" con `intent://`.
- Iconos: legacy + round + adaptativo (primer plano dentro de la zona segura de 66/108 dp) y splash, generados desde el SVG con Playwright.

## 8. UX que gustó (reutilizar)

- Lista agrupada por **fin de semana** ("Este finde", "Próximo finde") y **fecha como dorsal**.
- Chips deslizables y una **hoja inferior de filtros**.
- **Buscar por municipio**: primero "En X" (barra naranja), luego "Cerca de X" por distancia (gris y discontinuo, con la distancia destacada) y selector de radio.
- **Mapa**: tocar cerca de un punto (22 px) abre un panel inferior con la carrera, o la lista si hay varias.
- **Cartel** a pantalla completa con pellizco y doble toque.
- **Plan** con pestañas pegadas arriba (Correr/Dormir/Comer/Itinerario/Mochila/Gastos/Compartir) y barra fija abajo con "Guardar plan".
- **Ficha en imagen** (canvas 1080 px): dorsal, hora, lugar, hotel, restaurantes y QR.

## 9. Cómo trabajar con el usuario

- Dar **una APK nueva por cada cambio** (y actualizar la vista previa). Decir siempre qué se ha probado y cómo: móvil simulado con Playwright, no un Android real.
- Probar como usuario real: Playwright con `devices['Pixel 7']`, tocar, usar el botón atrás (`page.goBack()`) y comprobar **qué elemento queda encima** con `elementFromPoint`. Así aparecieron los fallos de capas.
- Pedirle solo lo que no se puede hacer desde aquí (ajustes de GitHub, cuentas de terceros) con pasos para hacerlo **desde el navegador del móvil**.
