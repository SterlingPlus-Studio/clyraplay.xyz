# ClyraPlay — versión de catálogo minimalista

## Estructura
- `index.html`: pantalla principal, catálogo y lector.
- `css/styles.css`: estilos de la plataforma.
- `js/main.js`: catálogo de cómics, búsqueda, Top 10 y lector.
- `js/adblock.js`: detección del bloqueador existente.
- `js/firebase.js`: métricas y presencia Firebase existentes.

## Cambios
- Estética de plataforma de streaming: fondo oscuro, navegación limpia, portadas verticales y carruseles.
- Cómics ordenados por géneros según las etiquetas disponibles en los datos.
- Sección Top 10 ordenada por el identificador de publicación más reciente; no representa métricas reales de popularidad.
- Buscador integrado en el catálogo; ya no depende de una página `Buscador.html` ausente del paquete.
- Se quitaron del sitio los apartados, fichas, datos y modales de juegos.
- Los scripts JavaScript se mantienen dentro de `js/` y el CSS dentro de `css/`; se eliminaron copias duplicadas de la raíz.

## Nota
La configuración Firebase y enlaces existentes se conservaron. La visualización de portadas y galerías depende de que sus direcciones externas sigan disponibles.

## Fuente y desplazamiento
- Toda la interfaz utiliza `fuente.ttf` desde `https://raw.githubusercontent.com/SterlingPlus-Studio/clyraplay.xyz/main/Fuente/fuente.ttf`, alojada en el repositorio indicado. Se utiliza `font-display: swap` para no bloquear el texto mientras carga.
- Las barras de desplazamiento de los carruseles de cómics, Top 10, géneros y lector quedan ocultas; el desplazamiento táctil, la rueda y el panel táctil continúan funcionando.

### Corrección de carruseles y sombras (23/10/2026)
- Los carruseles de todos los géneros usan el ancho completo del contenedor principal; se evita aplicar dos veces el margen de página a cada género.
- Se mantiene el desplazamiento horizontal con barras ocultas.
- Se añadió una sombra interior uniforme en todo el perímetro de las portadas, incluidas las esquinas, con un realce sutil al pasar el cursor.


## Corrección adicional de géneros y sombras
- Los géneros se ordenan por cantidad total de cómics, del más numeroso al menos numeroso; los empates se ordenan alfabéticamente.
- Las portadas conservan un límite de 18 por carrusel para evitar una carga excesiva del navegador. El orden se calcula con todo el catálogo.
- Las tarjetas reciben una sombra exterior más visible y una viñeta interior que cubre toda la superficie, no solo una línea en los bordes.
- Se amplió el relleno de los carruseles para que el área de desplazamiento no recorte la sombra en los extremos.


### Acento visual en géneros
- Cada título de género incluye una línea vertical roja de acento a su izquierda, con extremos redondeados y un brillo sutil. El estilo se limita a los títulos generados dentro de `#genre-sections`; no altera los títulos de “Recién llegados” ni del Top 10.


### Tu próxima obsesión y navegación
- Las tres tarjetas de “Tu próxima obsesión” toman portadas aleatorias del catálogo en cada carga de la página, sin repetir portada dentro de la misma selección.
- Se retiró el botón “Cómics” de la navegación superior; la biblioteca sigue siendo accesible desde los botones “Explorar biblioteca” y “Ver biblioteca”.

## Navegación activa
- El botón **Buscar** queda resaltado cuando se abre la biblioteca/buscador.
- El botón **Inicio** recupera el resaltado al volver a la página principal.
- El estado activo tiene fondo rojo translúcido y una línea roja inferior, y se anuncia mediante `aria-current`.



Actualización de navegación (23/10/2026): las opciones Inicio y Buscar quedan alineadas inmediatamente a la izquierda del botón Descargar en la barra superior, manteniendo el resaltado de la sección activa y el diseño adaptable a móvil.
