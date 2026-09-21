# Metodologías del INEGI reproducidas desde los microdatos

Exclusión 8 del traspaso (`docs/TRASPASO-INEGI.md` §2.8): tres cifras publicadas por el INEGI o el INSP que el
observatorio no reproducía desde los microdatos y, por la regla «no se publica lo que no cuadra», no publicaba.
Las tres se reproducen ahora exactas. Script: `scripts/metodologias_inegi.py` (subcomandos `ensanut`,
`envipe-prevalencia`, `envipe-2020`; `--cargar` carga en D1 solo si la verificación no tiene diferencias). Los
microdatos son los Parquet de R2 del catálogo `da_microdatos`; los CSV resultantes quedan en `data/metodologias/`.

| Cifra | Publicada | Obtenida antes | Obtenida ahora | Qué faltaba |
|---|---|---|---|---|
| ENSANUT 2018-19, adultos 20+: sobrepeso / obesidad | 39.1 % / 36.1 % | 37.7 / 37.8 | 39.11 / 36.07 (n = 16,579; N = 77,708,132) | sección de adultos mayores, depuración del INSP, factor F_ANTROP_INSP, sin embarazadas |
| ENVIPE, tasa de prevalencia delictiva 2025 (6200002197) | 23,472.5354647741 | 25,594.7 | 23,472.5354647741 (330/330 exactas 2016-2025 × 33 geografías) | el código 03 (vandalismo) de TMod_Vic no es delito |
| ENVIPE 2020, inseguridad en la colonia (6200118581) | 48.7372827584775 % | 42.93 (fac_ele) / 52.01 (fac_ele_am) | 48.7372827584775 % (33/33 exactas; población 35,919,641 = cuadro 5.4) | solo el levantamiento de marzo (TVivienda.PER = 1) |

## 1. ENSANUT 2018-19: sobrepeso y obesidad en adultos de 20 años y más

**Cifra y fuente.** «A nivel nacional, en 2018, el porcentaje de adultos de 20 años y más con sobrepeso y obesidad es de
75.2% (39.1% sobrepeso y 36.1% obesidad)»: INSP, *Encuesta Nacional de Salud y Nutrición 2018. Presentación de
resultados*, lámina «Sobrepeso y obesidad en población de 20 y más años» (p. 41 del PDF,
`ensanut.insp.mx/encuestas/ensanut2018/doctos/informes/ensanut_2018_presentacion_resultados.pdf`), y comunicado del
INEGI *La ENSANUT 2018 ofrece información…* (`saladeprensa/boletines/2019/especiales/ENSANUT19.pdf`, p. 3). Los
tabulados básicos del INEGI (`ensanut_2018_tabulados_basicos_pe.xlsx`) no traen el cuadro de IMC: es cifra del INSP.

**Metodología.** Barquera S., Hernández-Barrera L., Trejo-Valdivia B., Shamah T., Campos-Nonato I., Rivera-Dommarco J.,
«Obesidad en México, prevalencia y tendencias en adultos. Ensanut 2018-19», *Salud Pública de México* 62(6):682-692,
2020 (`ensanut.insp.mx/encuestas/ensanut2018/doctos/analiticos/obesidad.en.méxico.pdf`), sección «Antropometría»:
«Se consideraron como datos válidos todos aquellos valores de talla entre 1.3 y 2.0 m y los valores de índice de masa
corporal (IMC) entre 10 y 58 kg/m²», clasificación OMS (sobrepeso 25.0-29.9, obesidad ≥ 30.0), y cuadro I con
n = 16 579 y N = 77 708.1 mil adultos, por sexo y grupo de edad. La exclusión de embarazadas y el ponderador no
están escritos en el artículo: se encontraron probando.

**Reglas que reproducen el cuadro I** (tabla `CN_ANTROPOMETRIA` de la base «nueva versión»; descriptor
`ensanut_2018_nueva_version_fd_cn.xlsx`; cuestionario `ensanut_2018_antropometria_tension_arterial.pdf`):

1. Personas de 20 años y más (`EDAD`).
2. Peso y talla = promedio de las dos mediciones. En 20-59 años vienen en `PESO1_1/PESO1_2` y `TALLA4_1/TALLA4_2`;
   en 60 y más el cuestionario salta a la sección de adultos mayores y vienen en `PESO12_1/PESO12_2` y
   `TALLA15_1/TALLA15_2`. **Este era el error principal**: sin la sección de 60+ solo quedan 13,341 adultos (N = 62.8
   millones) y las prevalencias dan 37.7/37.8. Los códigos 222.222 (kg) y 222.2 (cm) son «no se pesó/no se midió».
3. Válidos: talla de 1.3 a 2.0 m e IMC de 10 a 58 kg/m² (quita 399 personas, casi todas talla 222.2).
4. Se excluyen las embarazadas: `P6` = 1 («está embarazada») o 3 («está embarazada y está dando pecho»); 206 mujeres.
5. Ponderador `F_ANTROP_INSP` («Factor Antropometría Instituto de Salud»), no `F_ANTROP`: 94 adultos traen 0 y quedan
   fuera; con él, n = 16,579 exacto y N = 77,708,132 (cuadro: 77 708.1 mil). Con `F_ANTROP` n = 16,673.
6. OMS: bajo peso < 18.5, normal 18.5-24.9, sobrepeso 25.0-29.9, obesidad ≥ 30.0.

**Resultado** (`scripts/metodologias_inegi.py ensanut`):

| Celda | n | N (miles) | normal | sobrepeso | obesidad | Cuadro I |
|---|---|---|---|---|---|---|
| Total | 16,579 | 77,708.1 | 23.55 | 39.11 | 36.07 | 16 579 · 77 708.1 · 23.5 · 39.1 · 36.1 |
| Mujeres | 9,375 | 44,569.6 | 21.77 | 36.59 | 40.24 | 9 375 · 44 569.6 · 21.8 · 36.6 · 40.2 |
| Hombres | 7,204 | 33,138.5 | 25.94 | 42.49 | 30.46 | 7 204 · 33 138.5 · 25.9 · 42.5 · 30.5 |
| 20-29 … 80+ | exactos | exactos | | | | 7 grupos: n y N exactos, % al decimal salvo una celda |

Las 10 filas del cuadro I cuadran en n (exacto), N (±0.05 mil) y porcentajes al decimal publicado; la única celda
que no redondea igual es sobrepeso en 40-49 años (38.96 obtenido, 38.9 publicado; 0.06 puntos). El cuadro I tiene
erratas visibles (repite la N de 30-39 como 16 616.3 y la de 50-59 como 16 368), así que se toma como límite de
precisión del papel, no de los datos. El «sin reglas» de la bitácora (37.7/37.8) se debía a las tres cosas juntas:
faltaban los adultos mayores, no se quitaban las tallas 222.2 ni las embarazadas y se usaba `F_ANTROP`.

**Salida.** `data/metodologias/ensanut_2018_imc.csv` (edición, entidad, sexo, grupo de edad, n, personas y las
cuatro categorías de IMC; 448 filas) → con `--cargar`, tabla `ensanut_imc` en D1 `datosmexico-api-encuestas`; cubo
`ensanut-imc` (tema nuevo «salud», `src/cubos/definiciones/ensanut.ts`). Las celdas por entidad son muestras chicas: el
cubo expone `n` junto a cada porcentaje.

## 2. ENVIPE: tasa de prevalencia delictiva por cada cien mil habitantes de 18 años y más

**Cifra y fuente.** Indicador 6200002197 del Banco de Indicadores («Tasa de prevalencia delictiva por cada cien mil
habitantes de 18 años y más»; 2025 = 23,472.5354647741, 2024 = 24,134.9420611221, …, 2016 = 28,788.2807829826) =
cuadro 1.1 de los tabulados básicos «I. Nivel de victimización y delincuencia» de cada edición
(`inegi.org.mx/contenidos/programas/envipe/2026/tabulados/I_nivel_victimizacion_2026_est.xlsx`; comunicado 50/26:
«Hubo 23 473 víctimas de delito por cada 100 mil habitantes»). El indicador se publica por año de referencia (el
anterior a la edición).

**Definición oficial.** Nota 2 del cuadro 1.1: «La tasa se calcula dividiendo el total de víctimas en la entidad
federativa entre la población de 18 años y más residente en ésta, multiplicada por 100 000 habitantes». Nota 2 del
cuadro 1.4: los delitos del hogar (robo total de vehículo, robo de accesorios y robo en casa habitación) se estiman «a
partir del factor de expansión del hogar» *en las tasas por tipo de delito*. Descriptor de archivos (`fd_envipe2026.pdf`,
tabla TMod_Vic, «Códigos para delitos» `BPCOD`): 01 robo total de vehículo, 02 robo de accesorios, **03 pinta de
barda o grafiti, rayones o daños intencionales en su vehículo u otro tipo de vandalismo**, 04 robo en casa
habitación, 05 robo o asalto en calle o transporte público, 06 robo en forma distinta, 07 fraude bancario, 08 fraude
al consumidor, 09 extorsión, 10 amenazas, 11 lesiones, 12 secuestro, 13 hostigamiento, manoseo, exhibicionismo o
intento de violación, 14 violación, 15 otros. El cuadro 1.4 («según tipo de delito») lista nueve delitos y **no lista
el 03**: la encuesta lo capta en la tarjeta pero no lo cuenta como delito.

**Regla que reproduce el indicador.** Víctima = persona elegida (TPer_Vic1) con al menos un registro en TMod_Vic con
`BPCOD` ≠ 03. Numerador Σ `FAC_ELE` de las víctimas; denominador Σ `FAC_ELE` de todas las elegidas; entidad =
`CVE_ENT` de residencia. En la tasa total los delitos del hogar cuentan a la persona elegida con su propio factor
(aunque TMod_Vic los pondere con `FAC_HOG`, que es lo que usa el INEGI en la tasa *por tipo* de delito: en la edición
2026, `FAC_DEL` = `FAC_HOG` en el 99-100 % de los registros con códigos 01-04 y = `FAC_ELE` en el 96-100 % de los 05-15).

**Verificación** (`scripts/metodologias_inegi.py envipe-prevalencia`): diez ediciones 2017-2026 (años 2016-2025) × 33
geografías = **330 comparaciones iguales** contra 6200002197 con diferencia < 0.01 por 100 mil (la peor, 0.00000; los
factores son enteros y el cociente se calcula igual). 2025: 23,472.5354647741 exacto. Contar también el código 03 da
25,594.68 en 2025 (la «más cercana, cualquier delito» de la bitácora del 21-sep): esa era la única diferencia. Por sexo, 2025 da 22,539.32 (mujeres) y 24,555.04 (hombres), iguales al cuadro 1.1.

**Salida.** `data/metodologias/envipe_prevalencia.csv` (edición, entidad, sexo, personas, víctimas; 640 filas) →
con `--cargar`, tabla `envipe_prevalencia` en D1 `datosmexico-api-seguridad` (DDL agregado a
`data/seguridad/schema.sqlite.sql`); cubo `envipe-prevalencia` en `src/cubos/definiciones/seguridad.ts` con la tasa
por 100 mil, el año de referencia y la edición.

## 3. ENVIPE 2020: percepción de inseguridad en la colonia (48.74 %)

**Cifra y fuente.** Indicador 6200118581, 2020 = 48.7372827584775 %; comunicado 636/20 del INEGI (10 de diciembre
de 2020): «48.7% de la población de 18 años y más que se siente insegura en su […] colonia o localidad», con
«Nota 2: Debido a la contingencia sanitaria generada por el virus SARS-CoV2 […], el levantamiento de la información se
realizó del 17 al 31 de marzo y del 27 de julio al 04 de septiembre». Cuadro 5.4 de los tabulados «V. Percepción
sobre la seguridad pública» 2020 (`v_percepcion_seguridad_2020_est.xlsx`): «marzo de 2020», población de 18 y más
35,919,641, inseguro 17,506,257 (48.7372827584775), y **«Nota 3: Las estimaciones presentadas corresponden al periodo de
levantamiento del 17 al 31 de marzo»**. En los reportes posteriores: «El nivel de percepción sobre seguridad pública
representa el periodo marzo y abril de 2013 a 2019 y de 2021 a 2025. En 2020 se refiere al mes de marzo».

**Qué cambió en 2020.** Ni el factor ni el universo: la pandemia partió el levantamiento en dos periodos y el INEGI
publica la percepción (que se pregunta «en este momento») solo con el primero. El descriptor `fd_envipe2020.pdf`
documenta en TVivienda la variable **`PER`**: 1 = «Primer periodo de levantamiento, del 17 al 31 de marzo», 2 =
«Segundo periodo de levantamiento, del 27 de julio al 04 de septiembre» (33,772 y 54,864 viviendas). La
victimización (año 2019) sí usa los dos periodos: el indicador 6200002197 de 2019 (24,849.04) se reproduce con todos
los elegidos.

**Regla.** TPer_Vic1 2020 unida a TVivienda 2020 por `ID_VIV`, `PER` = 1 (34,499 elegidos), ponderador `FAC_ELE`,
inseguro = `AP4_3_1` = 2 sobre toda la población (incluido «no sabe»), igual que las demás ediciones.

**Verificación** (`scripts/metodologias_inegi.py envipe-2020`): 33/33 geografías iguales a 6200118581 (±0.005 pp);
población nacional 35,919,641 exacta contra el cuadro 5.4. Con todos los elegidos: 42.93 %; solo julio-septiembre:
39.07 %.

**Salida.** `data/metodologias/envipe_2020_percepcion.csv` (192 filas con los tres ámbitos) → con `--cargar`,
`DELETE … WHERE anio = 2020` + INSERT en `envipe_percepcion` (D1 `datosmexico-api-seguridad`). `scripts/seguridad_d1.py`
ya aplica la misma regla en 2020 (importa `marzo_2020` de `metodologias_inegi.py`), así que una recarga completa
conserva la edición; las notas del cubo `envipe-percepcion` quedan actualizadas.

## Pendientes para publicar

1. `data/.venv/bin/python scripts/metodologias_inegi.py ensanut --cargar`, `… envipe-prevalencia --cargar`,
   `… envipe-2020 --cargar` (cada uno verifica antes de cargar y se detiene si algo no cuadra).
2. Desplegar el worker con los cubos `envipe-prevalencia` y `ensanut-imc` (tema «salud») y comprobar en el
   verificador: 2025 → 23,472.5; 2020 colonia → 48.74; ENSANUT total → 39.1/36.1.
3. Bitácora y traspaso (§2.8 ya marcado como resuelto).
