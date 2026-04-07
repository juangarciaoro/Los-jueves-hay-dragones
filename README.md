# Mesa de Juego - Los Jueves Hay Dragones

> Una herramienta de gestion de campana para directores de juego y jugadores de rol, construida con fuego, pergamino y Firebase.

---

## Que es esto

**Mesa de Juego** es una aplicacion web pensada para grupos de rol que juegan partidas presenciales o semipresenciales. El Director de Juego tiene control total de la sesion desde un panel privado, mientras que los jugadores pueden seguir la partida en tiempo real desde sus propios dispositivos.

Todo sincronizado en tiempo real gracias a **Firebase Firestore**, sin necesidad de servidor propio.

---

## Funcionalidades

### Vista del Director de Juego
- Gestion de multiples **campanas** independientes
- **Diario de sesion** con notas publicas y privadas
- **Gestor de iniciativa** con tarjetas de combatientes, HP, condiciones y turnos
- Tooltip de ficha de enemigo al hacer hover
- **Eventos aleatorios** por categoria (Tension, Combate, Social, Entorno)
- **Actos narrativos** con contenido publico/privado
- Generador de **tiradas de dados** con historial y modo secreto
- Vista previa de como ve la sesion un jugador

### Vista del Jugador
- Acceso a la sesion activa en tiempo real
- Ficha de personaje personal (atributos, habilidades, mochila, notas)
- Notas privadas por sesion
- Seguimiento del orden de iniciativa

### Vista Espectador
- URL sin login para proyectar en pantalla durante la sesion
- Muestra el orden de iniciativa en tiempo real

### Mantenimiento
- Gestion de **personajes**, **enemigos**, **usuarios** y **sesiones**
- **Usuarios globales** transversales a todas las campanas
- Sistema de **estados de combate** personalizables
- Exportar / importar copia de seguridad en JSON

---

## Stack tecnico

| Capa | Tecnologia |
|------|------------|
| Frontend | HTML5 + CSS3 + JavaScript ES Modules (vanilla) |
| Base de datos | Firebase Firestore (tiempo real) |
| Autenticacion | Usuarios personalizados con hash de contrasenas |
| Tipografia | Cinzel · Cinzel Decorative · Crimson Text · UnifrakturMaguntia |
| Icono | SVG d20 dorado |

---

## Estructura del proyecto

```text
|- index.html      # Shell HTML de la aplicacion
|- app.js          # Logica principal: Firebase, estado, vistas y modales
|- styles.css      # Estilos: variables, layouts y componentes
|- favicon.svg     # Icono d20 dorado
|- ui-icons.js     # Catalogo de iconos SVG
\- svg/            # Iconos individuales
```

---

## Colecciones Firestore

```text
app/
  campaigns   -> Catalogo de campanas disponibles
  users       -> Usuarios globales compartidos entre campanas

campaigns/
  {campaignId} -> Estado completo de cada campana
```

---

## Ramas

| Rama | Estado |
|------|--------|
| `main` | Produccion estable |
| `multiCampaign` | Desarrollo con soporte multi-campana y usuarios globales |

---

## Iconografia

La app usa un catalogo local de SVGs en `svg/`.

- Los iconos utilitarios mantienen una linea compatible con librerias abiertas como **Lucide** (`ISC`).
- Los iconos tematicos de fantasia medieval se han redibujado localmente con una direccion visual inspirada en colecciones libres como **Game Icons** (`CC BY 3.0`).

La nota de procedencia y criterio para futuras incorporaciones esta en `svg/ATTRIBUTION.md`.

---

## Capturas

La aplicacion busca una estetica de pergamino medieval: fondo oscuro, tipografia Cinzel dorada, bordes ambarinos y detalles de manuscrito iluminado.

---

Hecho con cafe y demasiadas horas de jueves por la noche.
