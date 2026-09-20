export const TITULO = "Datos México — API del observatorio";
export const VERSION = "2.0.0";

export const DESCRIPCION = `
API pública del Observatorio Datos México.

Cada base de datos expuesta declara su fuente oficial, la edición o corte
más reciente que contiene y las verificaciones que se le hicieron contra la
publicación original. Lo que no está aquí, no lo tenemos: el catálogo dice
qué sí y qué no.

**Principios.** Las bases oficiales son de solo lectura: ninguna operación de
esta API modifica un dato publicado; cada carga es un script versionado que se
verifica contra la publicación original. Un posible error se reporta en
**Erratas** (registro público con autoría, revisión y edición en que se
corrigió). Los métodos de escritura existen solo donde son correctos: erratas,
la tabla pedagógica del curso de Bases de Datos y las operaciones de
recálculo de tablas derivadas, todos con autenticación.

**Observatorio hecho por estudiantes, egresados y colaboradores del ITAM.**
Sitio: [datosmexico.org](https://datosmexico.org) · Modelo institucional:
[datosmexico.org/modelo](https://datosmexico.org/modelo).
`;
