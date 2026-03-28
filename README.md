# ⚔ Mesa de Juego — Los Jueves Hay Dragones

> *Una herramienta de gestión de campaña para directores de juego y jugadores de rol, construida con fuego, pergamino y Firebase.*

---

## ¿Qué es esto?

**Mesa de Juego** es una aplicación web pensada para grupos de rol que juegan partidas presenciales o semipresenciales. El Director de Juego tiene control total de la sesión desde un panel privado, mientras que los jugadores pueden seguir la partida en tiempo real desde sus propios dispositivos.

Todo sincronizado en tiempo real gracias a **Firebase Firestore**, sin necesidad de servidor propio.

---

## Funcionalidades

### 🎭 Vista del Director de Juego
- Gestión de múltiples **campañas** independientes
- **Diario de sesión** con notas públicas y privadas
- **Gestor de iniciativa** con tarjetas de combatientes, HP, condiciones y turnos
  - Tooltip de ficha de enemigo al hacer hover (✦ nuevo)
- **Eventos aleatorios** por categoría (Tensión, Combate, Social, Entorno)
- **Actos narrativos** con contenido público/privado
- Generador de **tiradas de dados** con historial y modo secreto
- Vista previa de cómo ve la sesión un jugador

### 🧙 Vista del Jugador
- Acceso a la sesión activa en tiempo real
- Ficha de personaje personal (atributos, habilidades, mochila, notas)
- Notas privadas por sesión (solo visibles para el jugador)
- Seguimiento del orden de iniciativa (sin ver los PV enemigos)

### 🖥 Vista Espectador
- URL sin login para proyectar en pantalla durante la sesión
- Muestra el orden de iniciativa en tiempo real

### 🛠 Mantenimiento
- Gestión de **personajes**, **enemigos**, **usuarios**, **sesiones**
- **Usuarios globales** transversales a todas las campañas
- Sistema de **estados de combate** personalizables
- Exportar / importar copia de seguridad en JSON

---

## Stack técnico

| Capa | Tecnología |
|------|-----------|
| Frontend | HTML5 + CSS3 + JavaScript ES Modules (vanilla) |
| Base de datos | Firebase Firestore (tiempo real) |
| Autenticación | Usuarios personalizados con hash de contraseña |
| Tipografía | Cinzel · Cinzel Decorative · Crimson Text · UnifrakturMaguntia |
| Icono | SVG d20 dorado |

---

## Estructura del proyecto

```
├── index.html      # Shell HTML de la aplicación
├── app.js          # Toda la lógica: Firebase, estado, vistas, modales
├── styles.css      # Estilos (variables CSS, layouts, componentes)
├── favicon.svg     # Icono d20 dorado
└── README.md
```

---

## Colecciones Firestore

```
app/
  campaigns   → Catálogo de campañas disponibles
  users       → Usuarios globales (compartidos entre campañas)

campaigns/
  {campaignId} → Estado completo de cada campaña
                  (sesiones, personajes, enemigos, actos, eventos…)
```

---

## Ramas

| Rama | Estado |
|------|--------|
| `main` | Producción estable |
| `multiCampaign` | Desarrollo — soporte multi-campaña y usuarios globales |

---

## Capturas

*La aplicación tiene una estética de pergamino medieval: fondo oscuro, tipografía Cinzel dorada, bordes ambarinos y detalles de manuscrito iluminado.*

---

*Hecho con ☕ y demasiadas horas de jueves por la noche.*

